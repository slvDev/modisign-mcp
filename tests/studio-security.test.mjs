import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import puppeteer from 'puppeteer-core';
import { hyperframesCli } from '../dist/processes.js';
import { studioBrowser } from '../dist/studio-browser.js';

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
