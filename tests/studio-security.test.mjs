import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { personRuntimeScript, studioWebRoot, sfxPackSource } from '../scripts/studio-assets.mjs';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import puppeteer from 'puppeteer-core';
import { hyperframesCli } from '../dist/processes.js';
import { assetRoutes, personRoutes, studioBrowser } from '../dist/studio-browser.js';

const chromeVersion = (await fs.readFile(join(dirname(hyperframesCli), '..', 'dist', 'cli.js'), 'utf8')).match(/\bCHROME_VERSION = "([\d.]+)"/)[1];
const get = (url, headers = {}, proxy) => new Promise((resolve, reject) => {
  const req = proxy === undefined ? request(url, { headers }, receive) : request(proxy, { path: url, headers }, receive);
  function receive(res) { let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body })); }
  req.on('error', reject); req.end();
});
async function fixture(t, launch) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'modisign-security-'));
  const pageFile = join(directory, 'index.html');
  const media = join(directory, 'named.mp4');
  await fs.writeFile(pageFile, 'runner'); await fs.writeFile(media, 'named media');
  t.mock.method(fs, 'access', async () => {});
  t.mock.method(childProcess, 'spawn', () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    queueMicrotask(() => { child.stdout.write(`Chrome ${chromeVersion}`); child.emit('close', 0); });
    return child;
  });
  syncBuiltinESMExports();
  t.mock.method(puppeteer, 'launch', launch);
  t.after(async () => { t.mock.restoreAll(); syncBuiltinESMExports(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, media, routes: new Map([['/index.html', pageFile], ['/media/0', media]]) };
}
function fakeBrowser(goto = async () => {}) {
  let closes = 0; let pages = 0;
  const browser = { newPage: async () => { pages++; return { setUserAgent: async value => { if (browser.setUserAgent !== undefined) await browser.setUserAgent(value); }, setDefaultTimeout() {}, goto, waitForFunction: async () => {} }; }, close: async () => { closes++; }, get closes() { return closes; }, get pages() { return pages; } };
  return browser;
}
test('render secret protects both servers; pinned descriptors defeat swaps and parallel reads', async t => {
  let options; let origin; let userAgent;
  const browser = fakeBrowser(async url => { origin = new URL(url).origin; });
  browser.setUserAgent = async value => { userAgent = value; };
  const { directory, media, routes } = await fixture(t, async input => { options = input; return browser; });
  const runner = await studioBrowser(routes, new AbortController().signal, () => {});
  try {
    assert.equal(options.pipe, true);
    assert.equal(options.args.some(arg => arg.startsWith('--remote-debugging-port')), false);
    assert.equal(options.args.some(arg => arg.startsWith('--user-agent=')), false);
    assert.match(userAgent, /^Modisign\/[a-f0-9]{64}$/);
    const headers = { 'User-Agent': userAgent };
    const proxy = options.args.find(arg => arg.startsWith('--proxy-server=')).slice('--proxy-server='.length);
    assert.equal((await get(`${origin}/media/0`)).status, 403);
    assert.equal((await get(`${origin}/media/0`, {}, proxy)).status, 403);
    assert.equal((await get(`${origin}/media/0`, { 'User-Agent': 'wrong' }, proxy)).status, 403);
    assert.equal((await get(`${origin}/json/version`, headers)).status, 403);
    const unrequested = join(directory, 'private.txt'); await fs.writeFile(unrequested, 'unrequested secret');
    await fs.rename(media, `${media}.original`); await fs.symlink(unrequested, media);
    const results = await Promise.all(Array.from({ length: 4 }, () => get(`${origin}/media/0`, headers, proxy)));
    for (const result of results) assert.deepEqual(result, { status: 200, body: 'named media' });
    await assert.rejects(studioBrowser(routes, new AbortController().signal, () => {}), /symlink/);
  } finally { await Promise.all([runner.close(), runner.close()]); }
  assert.equal(browser.closes, 1);
  await assert.rejects(get(`${origin}/media/0`), error => ['ECONNREFUSED', 'ECONNRESET'].includes(error.code));
});
test('non-regular media is rejected before browser launch', async t => {
  let launches = 0;
  const { directory, routes } = await fixture(t, async () => { launches++; return fakeBrowser(); });
  routes.set('/media/0', directory);
  await assert.rejects(studioBrowser(routes, new AbortController().signal, () => {}), /regular file/);
  assert.equal(launches, 0);
});
test('abort before launch opens no browser', async t => {
  let launches = 0;
  const { routes } = await fixture(t, async () => { launches++; return fakeBrowser(); });
  await assert.rejects(studioBrowser(routes, AbortSignal.abort(new Error('canceled')), () => {}), /canceled/);
  assert.equal(launches, 0);
});
test('abort during launch closes the late browser once without creating a page', async t => {
  const controller = new AbortController();
  const browser = fakeBrowser();
  let release; let started;
  const launched = new Promise(resolve => { started = resolve; });
  const { routes } = await fixture(t, () => { started(); return new Promise(resolve => { release = resolve; }); });
  const pending = studioBrowser(routes, controller.signal, () => {});
  await launched; controller.abort(new Error('canceled')); release(browser);
  await assert.rejects(pending, /canceled/);
  assert.equal(browser.closes, 1); assert.equal(browser.pages, 0);
});
test('abort during navigation cleans up and returns cancellation', async t => {
  const controller = new AbortController();
  const browser = fakeBrowser(async () => controller.abort(new Error('canceled')));
  const { routes } = await fixture(t, async () => browser);
  await assert.rejects(studioBrowser(routes, controller.signal, () => {}), /canceled/);
  assert.equal(browser.closes, 1);
});
test('abort after startup and repeated close share cleanup', async t => {
  const controller = new AbortController(); const browser = fakeBrowser();
  const { routes } = await fixture(t, async () => browser);
  const runner = await studioBrowser(routes, controller.signal, () => {});
  controller.abort(); await Promise.all([runner.close(), runner.close()]);
  assert.equal(browser.closes, 1);
});
test('launch rejection closes servers and preserves cancellation', async t => {
  const controller = new AbortController();
  const { routes } = await fixture(t, async () => { controller.abort(new Error('canceled')); throw new Error('launch failed'); });
  await assert.rejects(studioBrowser(routes, controller.signal, () => {}), /canceled/);
});

const wire = (url, { headers = {}, method = 'GET', proxy } = {}) => new Promise((resolve, reject) => {
  const receive = res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); };
  const req = proxy === undefined ? request(url, { headers, method }, receive) : request(proxy, { path: url, headers, method }, receive);
  req.on('error', reject); req.end();
});
test('sound pack routes are exact files with their types behind the render secret', async t => {
  const pack = sfxPackSource(fileURLToPath(new URL('../', import.meta.url)));
  const manifest = JSON.parse(await fs.readFile(join(pack, 'manifest.json'), 'utf8'));
  const licenses = await fs.readdir(join(pack, 'licenses'));
  const all = await assetRoutes();
  const sounds = [...all].filter(([route]) => route.startsWith('/sfx/'));
  const expected = [...manifest.sounds.map(sound => sound.file), 'manifest.json', 'NOTICE.txt', ...licenses.map(name => `licenses/${name}`)].map(name => `/sfx/ugc-1/${name}`);
  assert.deepEqual(sounds.map(([route]) => route).sort(), expected.sort(), 'only the registry sounds and the notices');
  for (const [, file] of sounds) assert.equal((await fs.stat(file)).isFile(), true);
  let options; let origin; let userAgent;
  const browser = fakeBrowser(async url => { origin = new URL(url).origin; });
  browser.setUserAgent = async value => { userAgent = value; };
  const { routes } = await fixture(t, async input => { options = input; return browser; });
  for (const [route, file] of sounds) routes.set(route, file);
  const runner = await studioBrowser(routes, new AbortController().signal, () => {});
  try {
    const headers = { 'User-Agent': userAgent };
    const proxy = options.args.find(arg => arg.startsWith('--proxy-server=')).slice('--proxy-server='.length);
    for (const sound of manifest.sounds) {
      const response = await wire(`${origin}/sfx/ugc-1/${sound.file}`, { headers, proxy });
      assert.equal(response.status, 200, sound.id);
      assert.equal(response.headers['content-type'], 'audio/wav');
      assert.equal(Number(response.headers['content-length']), sound.bytes);
      assert.equal(createHash('sha256').update(response.body).digest('hex'), sound.sha256, sound.id);
    }
    for (const [name, type] of [['manifest.json', 'application/json'], ['NOTICE.txt', 'text/plain'], [`licenses/${licenses[0]}`, 'text/plain']]) {
      const response = await wire(`${origin}/sfx/ugc-1/${name}`, { headers, proxy });
      assert.equal(response.status, 200, name);
      assert.equal(response.headers['content-type'], type);
      assert.ok(response.body.equals(await fs.readFile(join(pack, name))));
    }
    const first = manifest.sounds[0].file;
    for (const path of ['/sfx/ugc-1/ugc-click-01.00000000.wav', '/sfx/ugc-1/../index.html', '/sfx/ugc-1/%2e%2e/index.html', '/sfx/ugc-1/', '/sfx/ugc-1', '/sfx/', '/sfx/ugc-1/licenses', '/sfx/ugc-2/' + first, `/sfx/ugc-1/${first}?x=1`, `/sfx/ugc-1/${first}/`]) {
      assert.equal((await wire(`${origin}${path}`, { headers, proxy })).status, 403, path);
    }
    const url = `${origin}/sfx/ugc-1/${first}`;
    for (const [label, extra] of [['no secret', { proxy }], ['wrong secret', { headers: { 'User-Agent': 'wrong' }, proxy }], ['direct without proxy and secret', {}], ['POST', { headers, proxy, method: 'POST' }], ['HEAD', { headers, proxy, method: 'HEAD' }]]) {
      assert.equal((await wire(url, extra)).status, 403, label);
    }
  } finally { await runner.close(); }
});

test('person model and worker routes remain inside the exact loopback allowlist', async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { personManifest } = await import(pathToFileURL(personRuntimeScript(root)).href);
  const { runtime, model, probe } = await personManifest(studioWebRoot(root));
  const verified = [runtime.simd.loader, runtime.simd.wasm, runtime.noSimd.loader, runtime.noSimd.wasm].map(asset => [runtime.directory + asset.file, asset]).concat([[model.directory + model.file, model], [model.directory + probe.file, probe]]);
  const expected = [runtime.directory + runtime.worker, ...verified.map(([route]) => route)];
  const person = personRoutes();
  assert.deepEqual([...person.keys()].sort(), expected.sort(), 'only the worker, one loader/wasm pair each, the model and the probe');
  assert.equal([...await assetRoutes()].some(([route]) => route.startsWith('/person-')), false, 'a request without a person title serves none of it');
  for (const [, file] of person) assert.equal((await fs.stat(file)).isFile(), true);
  let options; let origin; let userAgent;
  const browser = fakeBrowser(async url => { origin = new URL(url).origin; });
  browser.setUserAgent = async value => { userAgent = value; };
  const { routes } = await fixture(t, async input => { options = input; return browser; });
  for (const [route, file] of person) routes.set(route, file);
  const runner = await studioBrowser(routes, new AbortController().signal, () => {});
  try {
    const headers = { 'User-Agent': userAgent };
    const proxy = options.args.find(arg => arg.startsWith('--proxy-server=')).slice('--proxy-server='.length);
    const types = { js: 'text/javascript', wasm: 'application/wasm', tflite: 'application/octet-stream', png: 'image/png' };
    for (const [route, asset] of verified) {
      const response = await wire(`${origin}${route}`, { headers, proxy });
      assert.equal(response.status, 200, route);
      assert.equal(response.headers['content-type'], types[route.split('.').at(-1)], route);
      assert.equal(Number(response.headers['content-length']), asset.bytes, route);
      assert.equal(createHash('sha256').update(response.body).digest('hex'), asset.sha256, route);
    }
    const worker = await wire(`${origin}${runtime.directory}${runtime.worker}`, { headers, proxy });
    assert.equal(worker.status, 200);
    assert.equal(worker.headers['content-type'], 'text/javascript');
    assert.ok(worker.body.length > 0);
    const file = model.directory + model.file;
    for (const path of [`${runtime.directory}NOTICE.txt`, `${model.directory}NOTICE.txt`, `${runtime.directory}licenses/Apache-2.0.txt`, runtime.directory, runtime.directory.replace(/[^/]+\/$/, ''), model.directory, '/person-runtime/9.9.9/' + runtime.worker, `${runtime.directory}../${runtime.worker}`,
      `${runtime.directory}%2e%2e/index.html`, `${runtime.directory}${runtime.simd.wasm.file}?x=1`, `${runtime.directory}${runtime.simd.wasm.file}/`, '/person-models/people-v2/' + model.file, `${file}.bak`, '/index.html/../person-models']) {
      assert.equal((await wire(`${origin}${path}`, { headers, proxy })).status, 403, path);
    }
    for (const [label, extra] of [['no secret', { proxy }], ['wrong secret', { headers: { 'User-Agent': 'wrong' }, proxy }], ['direct without proxy and secret', {}], ['POST', { headers, proxy, method: 'POST' }], ['HEAD', { headers, proxy, method: 'HEAD' }]]) {
      assert.equal((await wire(`${origin}${file}`, extra)).status, 403, label);
    }
  } finally { await runner.close(); }
});
