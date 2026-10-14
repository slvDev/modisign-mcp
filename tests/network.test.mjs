import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import test from 'node:test';
import { renderProxy } from '../dist/render-isolation.js';

test('render proxy allows only the host-selected server and cached routes, without redirects or tunnels', async () => {
  let requests = 0;
  const upstream = createServer((incoming, outgoing) => {
    requests++;
    if (incoming.url === '/assets/cached.js') outgoing.writeHead(302, { Location: 'https://example.com/leak' }).end();
    else outgoing.end('injected runtime');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const origin = `http://localhost:${upstream.address().port}`;
  const proxy = await renderProxy(['/index.html', '/assets/cached.js']);
  function get(url, method = 'GET') {
    return new Promise((resolve, reject) => {
      const req = request(proxy.url, { path: url, method, headers: { 'User-Agent': proxy.userAgent } }, response => {
        let body = '';
        response.on('data', chunk => body += chunk);
        response.on('end', () => resolve({ status: response.statusCode, body }));
      });
      req.on('connect', (response, socket) => { socket.destroy(); resolve({ status: response.statusCode }); });
      req.on('error', reject);
      req.end();
    });
  }
  try {
    assert.equal((await get(`${origin}/index.html`)).status, 403);
    proxy.allowNavigation(`${origin}/index.html`);
    assert.equal(await new Promise((resolve, reject) => { const req = request(proxy.url, { path: `${origin}/index.html` }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end(); }), 403);
    assert.deepEqual(await get(`${origin}/index.html`), { status: 200, body: 'injected runtime' });
    for (const url of [
      `${origin}/credentials.json`, `${origin}/assets/not-cached.js`, `${origin}/index.html?text=secret`,
      `${origin}/assets/%2e%2e/credentials.json`, 'http://127.0.0.1:1/index.html', 'https://example.com/leak',
    ]) assert.equal((await get(url)).status, 403);
    assert.equal((await get(`${origin}/index.html`, 'POST')).status, 403);
    assert.equal((await get('example.com:443', 'CONNECT')).status, 403);
    assert.equal(requests, 1);
    assert.equal((await get(`${origin}/assets/cached.js`)).status, 403);
    assert.equal(requests, 2);
    assert.throws(() => proxy.allowNavigation('http://localhost:1/index.html'), /server change/);
    assert.throws(() => proxy.allowNavigation('https://example.com/index.html'), /Blocked/);
  } finally {
    proxy.close(); upstream.closeAllConnections(); upstream.close();
  }
});

test('Studio proxy serves only exact host-named media and model files', async () => {
  let requests = 0;
  const upstream = createServer((_incoming, outgoing) => { requests++; outgoing.end('local'); });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const origin = `http://localhost:${upstream.address().port}`;
  const proxy = await renderProxy(['/index.html', '/media/0', '/models/pinned/config.json']);
  const get = path => new Promise((resolve, reject) => {
    const req = request(proxy.url, { path, headers: { 'User-Agent': proxy.userAgent } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    req.on('error', reject); req.end();
  });
  try {
    proxy.allowNavigation(`${origin}/index.html`);
    assert.equal(await new Promise((resolve, reject) => { const req = request(proxy.url, { path: `${origin}/index.html` }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end(); }), 403);
    assert.equal(await get(`${origin}/media/0`), 200);
    assert.equal(await get(`${origin}/models/pinned/config.json`), 200);
    for (const path of ['/media/1', '/media/0?path=/etc/passwd', '/models/other/config.json', '/media/../credentials.json', '/media/%30']) assert.equal(await get(`${origin}${path}`), 403);
    assert.equal(requests, 2);
  } finally { proxy.close(); upstream.closeAllConnections(); upstream.close(); }
});
