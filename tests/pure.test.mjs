import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { destination, numberedOutput, publishFile, inputFile } from '../dist/files.js';
import { ApiError, denied, errorResult } from '../dist/errors.js';
import { compositeArguments, renderArguments, videoInfo } from '../dist/render.js';
import { outputConfiguration } from '../dist/overlays.js';
import { configDirectory } from '../dist/settings.js';
import { failureCause, installFfmpeg, rendererEnv } from '../dist/processes.js';
import { jobSummary } from '../dist/jobs.js';
import { closestVideoAspect, overlayStartLimit } from '../dist/own-video.js';
import { windowsPrivacyArguments } from '../dist/credentials-privacy.js';
import { isolatedBrowserArguments } from '../dist/render-isolation.js';

test('output naming retains the final extension and increments collisions', () => {
  assert.equal(numberedOutput('/videos/a.b.mp4', 1), '/videos/a.b.mp4');
  assert.equal(numberedOutput('/videos/a.b.mp4', 3), '/videos/a.b-3.mp4');
  assert.equal(destination('hook-title', 'mov', '/videos'), '/videos/hook-title.mov');
  assert.throws(() => destination('hook-title', 'mp4', '/videos', '/videos/file.mov'));
});
test('atomic publication preserves existing files and rejects missing/non-file inputs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'modisign-test-'));
  try {
    const target = join(dir, 'clip.mp4');
    await writeFile(target, 'existing');
    const sources = [join(dir, 'a'), join(dir, 'b')];
    await Promise.all(sources.map((source) => writeFile(source, 'new')));
    const paths = await Promise.all(sources.map((source) => publishFile(source, target)));
    assert.equal(new Set(paths).size, 2);
    assert.equal(await readFile(target, 'utf8'), 'existing');
    assert.deepEqual(paths.sort(), [join(dir, 'clip-2.mp4'), join(dir, 'clip-3.mp4')]);
    await assert.rejects(inputFile(dir), /regular file/);
    await assert.rejects(inputFile(join(dir, 'missing')), /does not exist/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('renderer arguments pass variables by file and preserve path literals', () => {
  const args = renderArguments('/tmp/a $(echo hi)', '/tmp/vars.json', '/tmp/out.mov', 'mov');
  assert.equal(args[args.indexOf('render') + 1], '/tmp/a $(echo hi)');
  assert.equal(args[0], '--import');
  assert.match(args[1], /render-preload\.js$/);
  assert.ok(args.includes('--strict-variables'));
  assert.equal(args[args.indexOf('--format') + 1], 'mov');
  assert.equal(args.includes('--width'), false);
  assert.equal(rendererEnv.HYPERFRAMES_NO_TELEMETRY, '1');
  assert.equal(rendererEnv.DO_NOT_TRACK, '1');
});
test('own-video rules match the website aspect distance, tie order and tenth-second start limit', () => {
  const aspects = ['9x16', '4x5', '1x1', '16x9'];
  assert.equal(closestVideoAspect({ width: 1280, height: 720 }, aspects), '16x9');
  assert.equal(closestVideoAspect({ width: 1080, height: 1920 }, aspects), '9x16');
  assert.equal(closestVideoAspect({ width: 1200, height: 1000 }, aspects), '1x1');
  assert.equal(closestVideoAspect({ width: 1000, height: 1000 }, ['1x1', '2x2']), '1x1');
  assert.throws(() => closestVideoAspect({ width: 1, height: 1 }, []), /no supported/);
  assert.throws(() => closestVideoAspect({ width: 1, height: 1 }, ['bogus', '1x1']), /Invalid/);
  assert.equal(overlayStartLimit(6, 3.5), 2.5);
  assert.equal(overlayStartLimit(6.09, 3.5), 2.5);
  assert.equal(overlayStartLimit(2, 3.5), 0);
});
test('Windows privacy uses encoded PowerShell argument arrays and verifies current-user-only DACLs', () => {
  const path = "C:\\Users\\a';& $(whoami)\\credentials.json";
  for (const kind of ['directory', 'file']) for (const action of ['protect', 'create', 'verify']) {
    const args = windowsPrivacyArguments(path, kind, action);
    assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
    assert.equal(args.length, 5);
    const script = Buffer.from(args[4], 'base64').toString('utf16le');
    assert.ok(!script.includes(path));
    assert.ok(script.includes(Buffer.from(path).toString('base64')));
    assert.match(script, /SetAccessRuleProtection\(\$true, \$false\)/);
    assert.match(script, /WindowsIdentity\]::GetCurrent\(\)\.User/);
    assert.match(script, /\$rules\.Count -ne 1/);
    assert.match(script, /\$rule\.IsInherited/);
    assert.match(script, /CreateNew/);
  }
});
test('browser proxy has no loopback bypass, direct DNS or QUIC path', () => {
  const args = isolatedBrowserArguments('http://127.0.0.1:1234');
  assert.ok(args.includes('--proxy-server=http://127.0.0.1:1234'));
  assert.ok(args.includes('--proxy-bypass-list=<-loopback>'));
  assert.ok(args.includes('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'));
  assert.ok(args.includes('--disable-quic'));
  assert.ok(args.includes('--force-webrtc-ip-handling-policy=disable_non_proxied_udp'));
});
test('composite keeps audio, bounds duration and uses a delayed alpha overlay', () => {
  const args = compositeArguments('/a clip.mp4', '/overlay.mov', '/output.mp4', { duration: 6, width: 1280, height: 720 }, 1, 3.5);
  assert.ok(args.includes('0:a:0?'));
  assert.ok(args.includes('-n'));
  assert.equal(args[args.indexOf('-t') + 1], '6');
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
  assert.match(args[args.indexOf('-filter_complex') + 1], /PTS-STARTPTS\+1\/TB/);
  assert.match(args[args.indexOf('-filter_complex') + 1], /repeatlast=0/);
  assert.match(args[args.indexOf('-filter_complex') + 1], /scale=1280:-2/);
  assert.match(args[args.indexOf('-filter_complex') + 1], /y=\(H-h\)\/2/);
});
test('source dimensions handle portrait rotation and the 1920 cap', () => {
  const metadata = { streams: [{ codec_type: 'video', width: 3840, height: 2160, side_data_list: [{ rotation: -90 }] }], format: { duration: '6' } };
  assert.deepEqual(videoInfo(metadata), { width: 1080, height: 1920, duration: 6 });
  metadata.format.duration = '60.1';
  assert.throws(() => videoInfo(metadata), /Studio/);
  assert.throws(() => videoInfo({ streams: [], format: { duration: 'NaN' } }), /known positive duration/);
  assert.deepEqual(videoInfo({ streams: [{ codec_type: 'video', width: 1279, height: 719 }], format: { duration: '6' } }), { width: 1280, height: 720, duration: 6 });
});
test('output background changes do not change overlay content', () => {
  const config = '/overlays/hook-title?aspect=16x9&look=cyan-underline&setup=hello';
  const mov = outputConfiguration(config, 'mov');
  assert.match(mov, /setup=hello/);
  assert.match(mov, /background=transparent/);
  assert.match(outputConfiguration(mov, 'mp4'), /background=green/);
});
test('API errors preserve field errors, auth guidance distinguishes sign-in and Pro', () => {
  const fields = [{ field: 'values.setup', allowed: { maxLength: 44 } }];
  assert.deepEqual(errorResult(new ApiError(400, { error: 'Invalid MCP input', fields })).fields, fields);
  assert.equal(errorResult(denied('sign_in', 'This overlay configuration')).reason, 'sign_in');
  assert.equal(errorResult(denied('pro', 'This overlay configuration')).upgrade_url, 'https://modisign.app/pricing');
  assert.equal(errorResult(new Error('secret-token')).error.includes('secret-token'), false);
});
test('OS install and config paths are explicit', () => {
  assert.equal(installFfmpeg('darwin'), 'brew install ffmpeg');
  assert.equal(installFfmpeg('win32'), 'winget install Gyan.FFmpeg');
  assert.equal(installFfmpeg('linux'), 'sudo apt install ffmpeg');
  assert.equal(configDirectory('linux', '/home/user'), '/home/user/.config/modisign');
  assert.equal(configDirectory('win32', '/unused', '/appdata'), '/appdata/modisign');
  assert.throws(() => configDirectory('win32', '/unused', undefined), /APPDATA/);
});
test('failed renderer jobs keep a path-free cause and never point at a missing file', () => {
  const failed = (...lines) => ['◆ Rendering', '✗  Render failed', '', ...lines.map(line => `   ${line}`)].join('\n');
  for (const [output, cause] of [
    [failed('Render files must stay inside their cache or staging directory.', 'Try --docker for containerized rendering'), 'Render files must stay inside their cache or staging directory.'],
    [failed('Cannot read /Users/jane doe/Movies/Modisign/.modisign-x/overlay.mp4 for output'), 'Cannot read <path>'],
    [failed("Cannot read /Users/o'brien/Movies/Modisign/x.html for output"), 'Cannot read <path>'],
    [failed('Cannot read "/Users/jane doe/it\'s here/x.html" now'), 'Cannot read "<path>'],
    [failed('Cannot read C:\\Users\\John Doe\\Movies\\x.mp4'), 'Cannot read <path>'],
    [failed('Cannot read \\\\server\\share\\John Doe\\x.mp4'), 'Cannot read <path>'],
    [failed('Cannot read ~/Movies/x.mp4 and/or retry'), 'Cannot read <path>'],
    [failed('Use either/or, then 1 / 2 steps'), 'Use either/or, then 1 / 2 steps'],
    [failed('Try --docker for containerized rendering'), undefined],
    ['no failure banner', undefined],
  ]) assert.equal(failureCause(output), cause);
  const base = { job_id: 'j1', progress: 0.3 };
  assert.equal(jobSummary({ ...base, state: 'failed', error: { error: 'The renderer failed (exit 1): Out of memory.' } }), 'Video job j1 failed: The renderer failed (exit 1): Out of memory.');
  assert.equal(jobSummary({ ...base, state: 'done', artifact: { path: '/out/a.mp4' } }), 'Video job j1 done. Saved /out/a.mp4.');
  assert.equal(jobSummary({ ...base, state: 'done', artifact: { path: '/out/a.mp4' }, warnings: ['Added 1 automatic sound.', 'Added ugc-pop-01 for Title "Hi" (title appears) at 0.50 s.'] }), 'Video job j1 done. Saved /out/a.mp4. Added 1 automatic sound. Added ugc-pop-01 for Title "Hi" (title appears) at 0.50 s.');
  assert.match(jobSummary({ ...base, state: 'canceled' }), /No file was produced/);
  assert.match(jobSummary({ ...base, state: 'rendering' }), /rendering\. Use job_status/);
  for (const state of ['failed', 'canceled']) assert.doesNotMatch(jobSummary({ ...base, state, error: { error: 'x' } }), /retrieve the local file|local file/);
});
