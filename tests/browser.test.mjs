import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { browserSelection, browserStatus, hyperframesCli } from '../dist/processes.js';

const source = await fs.readFile(join(dirname(hyperframesCli), '..', 'dist', 'cli.js'), 'utf8');
const version = source.match(/\bCHROME_VERSION = "([\d.]+)"/)[1];
const home = '/test-home';
for (const [os, arch, platform, folder, executable] of [
  ['darwin', 'arm64', 'mac_arm', 'mac-arm64', 'chrome-headless-shell'],
  ['darwin', 'x64', 'mac', 'mac-x64', 'chrome-headless-shell'],
  ['win32', 'x64', 'win64', 'win64', 'chrome-headless-shell.exe'],
  ['linux', 'x64', 'linux', 'linux64', 'chrome-headless-shell'],
]) {
  test(`${os}-${arch} selects the pinned managed headless shell`, () => {
    assert.deepEqual(browserSelection(source, os, arch, '24.0.0', home), {
      kind: 'managed', version,
      binary: join(home, '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell', `${platform}-${version}`, `chrome-headless-shell-${folder}`, executable),
    });
  });
}
test('linux-arm64 selects system Chromium in HyperFrames lookup order', () => {
  assert.deepEqual(browserSelection(source, 'linux', 'arm64', '6.0.0', home), {
    kind: 'system',
    paths: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
    commands: ['google-chrome', 'chromium'],
  });
});
test('managed selection preserves the macOS ceiling and Windows ARM emulation rule', () => {
  const oldVersion = source.match(/MACOS_12_CHROME_VERSION = "([\d.]+)"/)[1];
  assert.equal(browserSelection(source, 'darwin', 'arm64', '21.6.0', home).version, oldVersion);
  assert.match(browserSelection(source, 'win32', 'arm64', '10.0.22000', home).binary, /win64/);
  assert.match(browserSelection(source, 'win32', 'arm64', '10.0.19045', home).binary, /win32/);
  assert.throws(() => browserSelection(source, 'freebsd', 'x64', '14.0.0', home), /Unsupported/);
});

function systemBrowser(t, paths, commands, versionWorks = true) {
  const calls = [];
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const arch = Object.getOwnPropertyDescriptor(process, 'arch');
  Object.defineProperty(process, 'platform', { value: 'linux' });
  Object.defineProperty(process, 'arch', { value: 'arm64' });
  t.mock.method(fs, 'access', async (path) => {
    calls.push(['access', path]);
    if (!paths.includes(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  });
  t.mock.method(childProcess, 'spawn', (binary, args) => {
    calls.push([binary, ...args]);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      const output = binary === 'which' ? commands[args[0]] : versionWorks ? 'Chromium 120.0.0.0' : undefined;
      if (output !== undefined) child.stdout.write(output);
      child.emit('close', output === undefined ? 1 : 0);
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    Object.defineProperty(process, 'platform', platform);
    Object.defineProperty(process, 'arch', arch);
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return calls;
}
test('Linux ARM64 readiness accepts the first system browser without requiring a pinned version', async (t) => {
  const calls = systemBrowser(t, ['/usr/bin/chromium', '/usr/bin/chromium-browser'], {});
  assert.deepEqual(await browserStatus(), { kind: 'system', present: true, binary: '/usr/bin/chromium', message: 'Chromium is ready.' });
  assert.deepEqual(calls.at(-1), ['/usr/bin/chromium', '--version']);
  assert.equal(calls.some(([binary]) => binary === 'which'), false);
});
test('Linux ARM64 readiness checks PATH after fixed paths in HyperFrames order', async (t) => {
  const calls = systemBrowser(t, [], { chromium: '/custom/chromium\n' });
  assert.equal((await browserStatus()).present, true);
  assert.deepEqual(calls.slice(-3), [['which', 'google-chrome'], ['which', 'chromium'], ['/custom/chromium', '--version']]);
});
test('Linux ARM64 without Chromium reports an install command instead of a managed download', async (t) => {
  const calls = systemBrowser(t, [], {});
  const status = await browserStatus();
  assert.equal(status.kind, 'system');
  assert.equal(status.present, false);
  assert.match(status.message, /sudo apt install chromium/);
  assert.equal(calls.some((call) => call.join(' ').includes('headless-shell')), false);
});
test('Linux ARM64 reports an unusable system browser and preserves cancellation', async (t) => {
  systemBrowser(t, ['/usr/bin/chromium'], {}, false);
  assert.equal((await browserStatus()).present, false);
  await assert.rejects(browserStatus(AbortSignal.abort(new Error('canceled'))), /canceled/);
});
