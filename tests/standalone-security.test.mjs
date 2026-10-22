import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { createServer as createTcpServer, Server } from 'node:net';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root = await mkdtemp(join(tmpdir(), 'modisign-standalone-'));
process.env.MODISIGN_CONFIG_DIR = root;
const { cacheDir } = await import('../dist/settings.js');
const { prepareStandaloneRender } = await import('../dist/standalone-render.js');
const get = (server, path, secret = server.userAgent, method = 'GET') => new Promise((resolve, reject) => {
  const headers = secret === null ? {} : { 'User-Agent': secret };
  const req = request(server.proxyUrl, { path, headers, method }, res => {
    let body = ''; res.on('data', chunk => body += chunk);
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('connect', (res, socket) => { socket.destroy(); resolve({ status: res.statusCode }); });
  req.on('error', reject); req.end();
});

test('standalone isolation pins cache files before compilation and exposes only authenticated routes', async t => {
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(cacheDir, { recursive: true });
  async function fixture(t) {
    const directory = await mkdtemp(join(cacheDir, 'composition-'));
    const work = await mkdtemp(join(root, 'work-'));
    await mkdir(join(directory, 'assets'));
    await writeFile(join(directory, 'index.html'), 'private overlay text');
    await writeFile(join(directory, 'assets', 'cached.js'), 'original asset');
    await writeFile(join(directory, 'complete.json'), 'not allowlisted');
    t.after(() => Promise.all([rm(directory, { recursive: true, force: true }), rm(work, { recursive: true, force: true })]));
    return { directory, work };
  }
  await t.test('missing/wrong secrets, extra files, traversal, queries, origins and tunnels fail', async t => {
    const { directory, work } = await fixture(t);
    const render = await prepareStandaloneRender(directory, work);
    t.after(render.close);
    await mkdir(join(work, 'compiled'));
    await writeFile(join(work, 'compiled', 'index.html'), 'compiled private text');
    const server = await render.serve(render.directory, join(work, 'compiled'), html => `<html>${html}</html>`);
    for (const secret of [null, 'wrong']) {
      for (const path of ['/index.html', '/assets/cached.js', '/complete.json']) {
        assert.deepEqual(await get(server, path, secret), { status: 403, body: '' });
      }
    }
    assert.deepEqual(await get(server, `${server.url}/index.html`), { status: 200, body: '<html>compiled private text</html>' });
    assert.deepEqual(await get(server, '/assets/cached.js'), { status: 200, body: 'original asset' });
    for (const path of ['/complete.json', '/index.html?text=secret', '/assets/../index.html', '/assets/%2e%2e/index.html', '/assets/%63ached.js', `${server.url}/assets/../index.html`, 'https://example.com/index.html', 'http://127.0.0.1:1/index.html', `${server.url}/index.html#fragment`]) assert.equal((await get(server, path)).status, 403);
    assert.equal((await get(server, '/index.html', server.userAgent, 'POST')).status, 403);
    assert.equal((await get(server, 'example.com:443', server.userAgent, 'CONNECT')).status, 403);
    assert.throws(() => server.allowNavigation('http://localhost:1/index.html'), /Blocked/);
    server.allowNavigation(`${server.url}/index.html`);
  });
  await t.test('pre-existing symlinks and non-regular cache entries fail before serving', async t => {
    for (const name of ['index.html', 'assets/cached.js', 'assets']) {
      const { directory, work } = await fixture(t);
      const target = join(root, `outside-${name.replaceAll('/', '-')}`);
      if (name === 'assets') await mkdir(target); else await writeFile(target, 'unrequested private bytes');
      const path = join(directory, name);
      await rm(path, { recursive: true }); await symlink(target, path);
      await assert.rejects(prepareStandaloneRender(directory, work), /symlink|outside/);
    }
    const { directory, work } = await fixture(t);
    await mkdir(join(directory, 'assets', 'not-a-file'));
    await assert.rejects(prepareStandaloneRender(directory, work), /regular file/);
    const outside = await mkdtemp(join(root, 'outside-'));
    await mkdir(join(outside, 'assets')); await writeFile(join(outside, 'index.html'), 'outside');
    await assert.rejects(prepareStandaloneRender(outside, work), /inside/);
    const escaped = join(cacheDir, 'escaped'); await symlink(outside, escaped);
    await assert.rejects(prepareStandaloneRender(escaped, work), /inside/);
  });
  await t.test('a symlinked output directory (macOS /tmp) serves, while escapes and symlinked compiled directories still fail', async t => {
    const { directory, work } = await fixture(t);
    const alias = `${work}-alias`;
    await symlink(work, alias);
    t.after(() => rm(alias, { force: true }));
    const render = await prepareStandaloneRender(directory, await realpath(work));
    t.after(render.close);
    await mkdir(join(work, 'compiled'));
    await writeFile(join(work, 'compiled', 'index.html'), 'compiled private text');
    const server = await render.serve(render.directory, join(alias, 'compiled'), html => html);
    assert.deepEqual(await get(server, '/index.html'), { status: 200, body: 'compiled private text' });
    server.close();
    const outside = await mkdtemp(join(root, 'outside-'));
    await mkdir(join(outside, 'compiled')); await writeFile(join(outside, 'compiled', 'index.html'), 'outside');
    const escaped = join(work, 'escaped'); await symlink(outside, escaped);
    await assert.rejects(render.serve(render.directory, join(escaped, 'compiled'), html => html), /inside/);
    await rm(join(work, 'compiled'), { recursive: true }); await symlink(join(outside, 'compiled'), join(work, 'compiled'));
    await assert.rejects(render.serve(render.directory, join(alias, 'compiled'), html => html), /inside|Unexpected/);
  });
  await t.test('an unpatched upstream cannot open an HTTP or TCP listener', async t => {
    const { directory, work } = await fixture(t);
    const render = await prepareStandaloneRender(directory, work);
    t.after(render.close);
    const listen = Server.prototype.listen;
    t.after(() => { Server.prototype.listen = listen; });
    render.restrictListeners();
    assert.throws(() => createServer().listen(0, '127.0.0.1'), /unauthenticated render listener/);
    assert.throws(() => createTcpServer().listen(0, '127.0.0.1'), /unauthenticated render listener/);
    await mkdir(join(work, 'compiled'));
    await writeFile(join(work, 'compiled', 'index.html'), 'compiled');
    const server = await render.serve(render.directory, join(work, 'compiled'), html => html);
    assert.equal((await get(server, '/index.html')).status, 200);
  });
  await t.test('post-validation and post-launch symlink swaps preserve pinned bytes across parallel reads', async t => {
    const { directory, work } = await fixture(t);
    const render = await prepareStandaloneRender(directory, work);
    t.after(render.close);
    const outside = join(root, 'private-target'); await writeFile(outside, 'unrequested private bytes');
    const index = join(directory, 'index.html');
    await rename(index, `${index}.original`); await symlink(outside, index);
    assert.equal(await readFile(join(render.directory, 'index.html'), 'utf8'), 'private overlay text');
    await mkdir(join(work, 'compiled'));
    const compiled = join(work, 'compiled', 'index.html');
    await writeFile(compiled, await readFile(join(render.directory, 'index.html')));
    const server = await render.serve(render.directory, join(work, 'compiled'), html => html);
    const asset = join(directory, 'assets', 'cached.js');
    await rename(asset, `${asset}.original`); await symlink(outside, asset);
    await rename(compiled, `${compiled}.original`); await symlink(outside, compiled);
    for (const result of await Promise.all(Array.from({ length: 20 }, () => get(server, `${server.url}/assets/cached.js`)))) assert.deepEqual(result, { status: 200, body: 'original asset' });
    assert.deepEqual(await get(server, '/index.html'), { status: 200, body: 'private overlay text' });
    server.close(); await Promise.all([render.close(), render.close()]);
    await assert.rejects(get(server, '/index.html'), /ECONNREFUSED/);
  });
});
