import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sfxPackSource } from '../scripts/studio-assets.mjs';
import { promisify } from 'node:util';
import test from 'node:test';
import { applyAutoSfx, applyRapidIntro, checkRequestedSfx, editDocument, mapClips, mapSfx, mapTexts, validateEdit } from '../dist/studio-request.js';

const video = duration => ({ kind: 'video', duration, width: 1080, height: 1920 });
const input = (clips, extra = {}) => ({ clips, aspect: '9x16', ...extra });
const v1 = (name, extra = {}) => ({ path: `/${name}.mp4`, track: 'v1', ...extra });
const media = (count, duration = 4) => Array.from({ length: count }, (_, index) => ({ id: `media-${index}`, kind: 'video', source: { ...video(duration), file: new File([], `${index}.mp4`), url: `blob:${index}` }, poster: '', hasAudio: true }));
const field = name => error => error.details.field === name;
const root = fileURLToPath(new URL('../', import.meta.url));
// The monorepo's website pack, or the mirror's own copy.
const canonical = sfxPackSource(root);
const monorepo = existsSync(join(root, '..', 'web', 'src', 'lib'));
const manifest = JSON.parse(await readFile(join(canonical, 'manifest.json'), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const listing = async (directory, prefix = '') => (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory() ? listing(join(directory, entry.name), join(prefix, entry.name)) : [join(prefix, entry.name)]))).flat().sort();
const yt = { id: 'yt-subscribe', name: 'Subscribe', supported_aspects: ['9x16'], default_duration: 4, looks: [], freeConfigs: [],
  variables: [{ id: 'style', label: 'Style', role: 'style', type: 'enum', default: 'card', options: [{ value: 'card', label: 'Card' }, { value: 'pill', label: 'Pill' }] }],
  cues: [{ id: 'subscribe-card', kind: 'cta-tap', at: 2, when: [{ style: ['card'] }] }, { id: 'subscribe-pill', kind: 'cta-tap', at: 2.2, when: [{ style: ['pill'] }] }] };
const overlay = (index, start, style = 'card', duration = 4) => ({ id: `overlay-${index}`, start, clamped: false, family: yt, preset: { id: 'free', family: 'yt-subscribe', href: '/overlays/yt-subscribe' }, config: { aspect: '9x16', look: 'default', duration, values: { style } } });
const owners = (request, sources, overlays = []) => { const clips = mapClips(request, sources); return { clips, texts: mapTexts(request, clips), overlays }; };

test('pack bytes, notices and registry agree in the source build, a generated mirror and the packed tarball', { timeout: 120_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'modisign-sfx-pack-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const expected = await listing(canonical);
  assert.deepEqual(expected.filter(name => name.endsWith('.wav')), manifest.sounds.map(sound => sound.file).sort());
  for (const sound of manifest.sounds) assert.equal(sha256(await readFile(join(canonical, sound.file))), sound.sha256, sound.id);
  assert.ok(expected.includes('NOTICE.txt') && expected.some(name => name.startsWith('licenses/')));
  const compare = async (directoryPath, label) => {
    assert.deepEqual(await listing(directoryPath), expected, label);
    for (const name of expected) assert.ok((await readFile(join(directoryPath, name))).equals(await readFile(join(canonical, name))), `${label}: ${name}`);
  };
  await compare(fileURLToPath(new URL('../dist/studio/sfx/ugc-1/', import.meta.url)), 'build output');
  if (monorepo) {
    const mirror = join(directory, 'mirror');
    const generated = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/mirror-source.mjs', import.meta.url)), '--output', mirror], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    await compare(join(mirror, 'browser', 'sfx', 'ugc-1'), 'mirror browser tree');
  }
  const packed = join(directory, 'packed');
  const pack = spawnSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], { cwd: root, encoding: 'utf8' });
  assert.equal(pack.status, 0, pack.stderr);
  const tarball = join(directory, JSON.parse(pack.stdout)[0].filename);
  await mkdir(packed);
  assert.equal(spawnSync('tar', ['-xzf', tarball, '-C', packed], { encoding: 'utf8' }).status, 0);
  await compare(join(packed, 'package', 'dist', 'studio', 'sfx', 'ugc-1'), 'packed install');
  assert.equal((await listing(join(packed, 'package'))).some(name => name.startsWith('browser/sfx') || name.startsWith('vendor/')), false, 'the npm package ships dist only, not mirror trees');
});

test('sound requests validate every field with defaults only from the shared registry', () => {
  const base = { asset: 'ugc-click-01', start: 1 };
  const edit = sfx => input([v1('a'), v1('b')], { sfx, transitions: [{ after_clip: 0, type: 'crossfade', duration: 0.4 }], texts: [{ text: 'Hi', start: 0, duration: 2 }], overlays: [{ configuration: '/overlays/yt-subscribe?a=1', start: 0 }] });
  const ok = [
    base,
    { ...base, in: 0.01, out: 0.05, gain: 2, mute: true, fade_in: 0.01, fade_out: 0.02 },
    { asset: 'ugc-typing-01', start: 0, fade_in: 2, fade_out: 1.5 },
    { asset: 'ugc-pop-01', anchor: { kind: 'title-enter', text: 0 } },
    { asset: 'ugc-whoosh-01', anchor: { kind: 'transition', after_clip: 0 }, offset: -2 },
    { asset: 'ugc-sparkle-02', anchor: { kind: 'overlay-cue', overlay: 0, cue: 'subscribe-card' }, offset: 2 },
  ];
  for (const sound of ok) assert.doesNotThrow(() => validateEdit(edit([sound])), JSON.stringify(sound));
  const bad = [
    [{ ...base, extra: 1 }, 'sfx.0'], [{ start: 1 }, 'sfx.0.asset'], [{ asset: 'ugc-click-99', start: 1 }, 'sfx.0.asset'], [{ asset: 'https://example.com/a.wav', start: 1 }, 'sfx.0.asset'], [{ asset: 'ugc-click-01' }, 'sfx.0'],
    [{ ...base, anchor: { kind: 'title-enter', text: 0 } }, 'sfx.0'], [{ ...base, offset: 0 }, 'sfx.0.offset'], [{ asset: 'ugc-click-01', anchor: { kind: 'title-enter', text: 0 }, offset: 2.1 }, 'sfx.0.offset'],
    [{ asset: 'ugc-click-01', anchor: { kind: 'title-enter', text: 0 }, offset: Number.NaN }, 'sfx.0.offset'],
    [{ asset: 'ugc-click-01', start: -0.1 }, 'sfx.0.start'], [{ asset: 'ugc-click-01', start: 181 }, 'sfx.0.start'], [{ asset: 'ugc-click-01', start: '1' }, 'sfx.0.start'],
    [{ ...base, in: -1 }, 'sfx.0.in'], [{ ...base, in: 0.05, out: 0.05 }, 'sfx.0.in'], [{ ...base, out: 9 }, 'sfx.0.in'], [{ ...base, in: 0.2, out: 0.1 }, 'sfx.0.in'],
    [{ ...base, gain: 2.1 }, 'sfx.0.gain'], [{ ...base, gain: -1 }, 'sfx.0.gain'], [{ ...base, mute: 'yes' }, 'sfx.0.mute'],
    [{ ...base, fade_in: 2.1 }, 'sfx.0.fade_in'], [{ ...base, fade_in: 0.06, out: 0.05 }, 'sfx.0.fade_in'], [{ ...base, fade_in: 0.05, fade_out: 0.05, out: 0.09 }, 'sfx.0.fade_in'],
    [{ asset: 'ugc-pop-01', anchor: { kind: 'title-enter', text: 1 } }, 'sfx.0.anchor.text'], [{ asset: 'ugc-pop-01', anchor: { kind: 'title-enter' } }, 'sfx.0.anchor.text'],
    [{ asset: 'ugc-pop-01', anchor: { kind: 'transition', after_clip: 1 } }, 'sfx.0.anchor.after_clip'], [{ asset: 'ugc-pop-01', anchor: { kind: 'transition', after_clip: 0, extra: 1 } }, 'sfx.0.anchor'],
    [{ asset: 'ugc-pop-01', anchor: { kind: 'overlay-cue', overlay: 1, cue: 'subscribe-card' } }, 'sfx.0.anchor.overlay'], [{ asset: 'ugc-pop-01', anchor: { kind: 'overlay-cue', overlay: 0, cue: 'Not A Slug' } }, 'sfx.0.anchor.cue'],
    [{ asset: 'ugc-pop-01', anchor: { kind: 'overlay-cue', overlay: 0 } }, 'sfx.0.anchor.cue'], [{ asset: 'ugc-pop-01', anchor: { kind: 'file', path: '/a.wav' } }, 'sfx.0.anchor.kind'], [{ asset: 'ugc-pop-01', anchor: 'title' }, 'sfx.0.anchor'],
    [{ asset: 'ugc-pop-01', start: 1, audio_path: '/music.mp3' }, 'sfx.0'], [{ asset: 'ugc-pop-01', start: 1, url: 'https://freesound.org/a.wav' }, 'sfx.0'],
  ];
  for (const [sound, name] of bad) assert.throws(() => validateEdit(edit([sound])), field(name), JSON.stringify(sound));
  assert.throws(() => validateEdit(edit(Array.from({ length: 101 }, () => base))), field('sfx'));
  assert.throws(() => validateEdit(input([v1('a')], { sfx: [{ asset: 'ugc-pop-01', anchor: { kind: 'transition', after_clip: 0 } }] })), field('sfx.0.anchor.after_clip'));
  const autoBad = [[{ events: [] }, 'events'], [{ events: ['title', 'title'] }, 'events'], [{ events: ['click'] }, 'events'], [{ seed: -1 }, 'seed'], [{ seed: 1.5 }, 'seed'], [{ seed: 2 ** 32 }, 'seed'], [{ intensity: 'loud' }, 'intensity'], [{ title_sound: 'whoosh' }, 'title_sound'], [{ audio: 'x' }, '']];
  for (const [auto, name] of autoBad) assert.throws(() => validateEdit(input([v1('a')], { auto_sfx: auto })), field(`auto_sfx${name === '' ? '' : `.${name}`}`), JSON.stringify(auto));
  for (const auto of [{}, { events: ['title', 'transition', 'cta-tap'], seed: 4294967295, intensity: 'subtle', title_sound: 'sparkle' }]) assert.doesNotThrow(() => validateEdit(input([v1('a')], { auto_sfx: auto })));
});

test('manual sounds take complete registry defaults once and keep request-index anchors through V1/V2 sorting', () => {
  const request = input([{ path: '/ref.mp4', track: 'v2', start: 0 }, v1('a'), { path: '/over.mp4', track: 'v2', start: 5 }, v1('b'), v1('c')], {
    transitions: [{ after_clip: 3, type: 'dip', duration: 0.4 }, { after_clip: 1, type: 'crossfade', duration: 0.4 }],
    texts: [{ text: 'One', start: 0, duration: 1 }, { text: 'Two', clip: 3 }], overlays: [{ configuration: '/overlays/yt-subscribe?a=1', start: 1 }],
    sfx: [{ asset: 'ugc-click-02', start: 1.5 }, { asset: 'ugc-pop-02', anchor: { kind: 'title-enter', text: 1 }, offset: 0.25, gain: 0.5 },
      { asset: 'ugc-whoosh-02', anchor: { kind: 'transition', after_clip: 1 } }, { asset: 'ugc-whoosh-01', anchor: { kind: 'transition', after_clip: 3 }, out: 0.2, fade_out: 0.1 },
      { asset: 'ugc-sparkle-01', anchor: { kind: 'overlay-cue', overlay: 0, cue: 'subscribe-card' }, mute: true }] });
  const sources = Array.from({ length: 5 }, () => video(3));
  const sounds = mapSfx(request, owners(request, sources, [overlay(0, 1)]));
  assert.deepEqual(sounds.map(sound => sound.id), ['sfx-0', 'sfx-1', 'sfx-2', 'sfx-3', 'sfx-4']);
  assert.deepEqual(sounds[0], { id: 'sfx-0', asset: 'ugc-click-02', inPoint: 0, outPoint: 2711 / 48000, gain: 0.35, muted: false, fadeIn: 0, fadeOut: 0, timing: { start: 1.5 } });
  assert.deepEqual(sounds[1].timing, { anchor: { kind: 'title-enter', textId: 'text-1' }, offset: 0.25 });
  assert.equal(sounds[1].gain, 0.5);
  assert.deepEqual(sounds[2].timing, { anchor: { kind: 'transition', fromClipId: 'clip-1', toClipId: 'clip-3' }, offset: 0 });
  assert.deepEqual(sounds[3].timing, { anchor: { kind: 'transition', fromClipId: 'clip-3', toClipId: 'clip-4' }, offset: 0 });
  assert.equal(sounds[3].outPoint, 0.2); assert.equal(sounds[3].fadeOut, 0.1);
  assert.deepEqual(sounds[4].timing, { anchor: { kind: 'overlay-cue', overlayId: 'overlay-0', cue: 'subscribe-card' }, offset: 0 });
  assert.equal(sounds[4].muted, true);
});

test('owners and cues that cannot exist, and starts outside the edit, are field errors', () => {
  const request = sfx => input([v1('a'), v1('b')], { sfx, transitions: [{ after_clip: 0, type: 'crossfade', duration: 0.4 }, { after_clip: 1, type: 'dip', duration: 0.4 }].slice(0, 1), overlays: [{ configuration: '/overlays/yt-subscribe?a=1', start: 0 }, { configuration: '/overlays/yt-subscribe?a=2', start: 0 }], texts: [{ text: 'Hi', start: 0, duration: 1 }] });
  const sources = [video(2), video(2)];
  const rows = [
    [{ asset: 'ugc-click-01', start: 3.6 }, 'sfx.0.start'], [{ asset: 'ugc-click-01', start: 100 }, 'sfx.0.start'],
    [{ asset: 'ugc-pop-01', anchor: { kind: 'overlay-cue', overlay: 0, cue: 'subscribe-pill' } }, 'sfx.0.anchor'],
    [{ asset: 'ugc-pop-01', anchor: { kind: 'overlay-cue', overlay: 0, cue: 'no-such-cue' } }, 'sfx.0.anchor'],
    [{ asset: 'ugc-pop-01', anchor: { kind: 'overlay-cue', overlay: 1, cue: 'subscribe-card' } }, 'sfx.0.anchor'],
  ];
  const requested = request([rows[0][0]]);
  const clips = mapClips(requested, sources);
  assert.ok(Math.abs(clips.reduce((sum, clip) => sum + (clip.outPoint - clip.inPoint), 0) - 4) < 1e-9);
  for (const [sound, name] of rows) {
    const edit = request([sound]);
    assert.throws(() => mapSfx(edit, owners(edit, sources, [overlay(0, 0), overlay(1, 0, 'card', 1.5)])), field(name), JSON.stringify(sound));
  }
  const shortCue = request([{ asset: 'ugc-pop-01', anchor: { kind: 'overlay-cue', overlay: 1, cue: 'subscribe-card' } }]);
  assert.throws(() => mapSfx(shortCue, owners(shortCue, sources, [overlay(0, 0), overlay(1, 0, 'card', 1.5)])), error => error.details.field === 'sfx.0.anchor' && /tap/i.test(error.message));
  const hardCut = input([v1('a'), v1('b')], { transitions: [{ after_clip: 0, type: 'crossfade', duration: 0.4 }], sfx: [{ asset: 'ugc-whoosh-01', anchor: { kind: 'transition', after_clip: 0 } }] });
  hardCut.clips[0].out = 0.2;
  assert.throws(() => mapSfx(hardCut, owners(hardCut, sources)), field('sfx.0.anchor'), 'a crossfade clamped away leaves no transition to follow');
  const state = { ...editDocument(request([{ asset: 'ugc-click-01', start: 1 }]), media(2, 2)), sfx: [] };
  assert.throws(() => checkRequestedSfx(state, request([{ asset: 'ugc-click-01', start: 1 }])), field('sfx.0'));
});

test('the rapid intro shifts absolute sounds by the teaser total and linked sounds follow their owners', () => {
  const clips = Array.from({ length: 5 }, (_, index) => v1(`c${index}`, { out: 1 }));
  const request = input(clips, { texts: [{ text: 'Bound', clip: 2 }], transitions: [{ after_clip: 2, type: 'crossfade', duration: 0.4 }],
    sfx: [{ asset: 'ugc-click-01', start: 1.2 }, { asset: 'ugc-pop-01', anchor: { kind: 'title-enter', text: 0 }, offset: 0.1 }, { asset: 'ugc-whoosh-01', anchor: { kind: 'transition', after_clip: 2 } }],
    rapid_intro: { clips: [0, 1, 2, 3, 4], labels: ['a', 'b', 'c', 'd', 'e'].map((text, clip) => ({ clip, text })), frames_per_clip: 5 } });
  const document = editDocument(request, media(5, 1));
  const before = { ...document, sfx: mapSfx(request, document) };
  const after = applyRapidIntro(before, request.rapid_intro);
  assert.ok(Math.abs(after.sfx[0].timing.start - (1.2 + 25 / 30)) < 1e-9, 'absolute start shifted by five 5-frame teasers');
  assert.deepEqual(after.sfx[1].timing, before.sfx[1].timing, 'a title-linked sound keeps its title');
  assert.deepEqual(after.sfx[2].timing, before.sfx[2].timing, 'a transition-linked sound keeps its clips');
  assert.equal(after.sfx.length, 3, 'teasers do not copy sounds');
  assert.equal(after.sfx.every(sound => sound.auto === undefined), true);
});

test('automatic sounds use the final structure, the default plan and report what was skipped by owner', () => {
  const request = input([v1('a', { out: 2 }), v1('b', { out: 2 }), v1('c', { out: 2 })], { transitions: [{ after_clip: 0, type: 'crossfade', duration: 0.4 }, { after_clip: 1, type: 'dip', duration: 0.4 }], texts: [{ text: 'Hello', start: 0.5, duration: 1 }], sfx: [{ asset: 'ugc-click-01', start: 3 }] });
  const document = editDocument(request, media(3, 2));
  const state = { ...document, sfx: mapSfx(request, document) };
  const first = applyAutoSfx(state, { events: ['transition'], intensity: 'subtle', seed: 7 });
  assert.equal(first.state.sfx.length, 3);
  assert.equal(first.state.sfx[0], state.sfx[0], 'manual rows are untouched');
  assert.deepEqual(first.state.sfx.slice(1).map(sound => [sound.auto, 'anchor' in sound.timing && sound.timing.anchor.kind]), [['ugc-1', 'transition'], ['ugc-1', 'transition']]);
  assert.match(first.notes[0], /^Added 2 automatic sounds/);
  const added = first.notes.filter(note => note.startsWith('Added ') && !note.startsWith('Added 2'));
  assert.equal(added.length, 2, 'one line per added sound');
  for (const [line, sound] of added.map((line, index) => [line, first.state.sfx[index + 1]])) assert.match(line, new RegExp(`^Added ${sound.asset} for (Crossfade|Dip to black), .+ to .+ \\((crossfade midpoint|dip cut point)\\) at \\d+\\.\\d{2} s\\.$`));
  assert.deepEqual(applyAutoSfx(state, { events: ['transition'], intensity: 'subtle', seed: 7 }).state.sfx, first.state.sfx, 'the same request gives the same rows');
  const loud = applyAutoSfx(state, { events: ['transition'], intensity: 'normal', seed: 7 }).state.sfx;
  assert.ok(loud[1].gain > first.state.sfx[1].gain, 'subtle plays quieter');
  const none = applyAutoSfx(state, { events: ['cta-tap'] });
  assert.equal(none.state, state);
  assert.match(none.notes[0], /No eligible events/);
  const everything = applyAutoSfx(state, {});
  assert.ok(everything.state.sfx.some(sound => 'anchor' in sound.timing && sound.timing.anchor.kind === 'title-enter'));
});

// Real encoded renders: the page runner exports the MP4, ffmpeg decodes the AAC and the onsets are read back from the samples.
const run = promisify(execFile);
const RATE = 48_000;
const FRAME = 1 / 30;
async function lab(t) {
  const { assetRoutes, studioBrowser } = await import('../dist/studio-browser.js');
  const directory = await mkdtemp(join(tmpdir(), 'modisign-sfx-render-'));
  const tone = join(directory, 'tone.mp4');
  const photo = join(directory, 'photo.png');
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=24:d=2', '-f', 'lavfi', '-i', 'aevalsrc=if(lt(t\\,0.6)+gte(t\\,1.4)\\,0.5*sin(2*PI*440*t)\\,0):s=48000:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', tone]);
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:d=1', '-frames:v', '1', photo]);
  const chunks = [];
  const routes = await assetRoutes();
  routes.set('/media/tone', tone); routes.set('/media/photo', photo);
  const runner = await studioBrowser(routes, new AbortController().signal, () => {});
  await runner.page.exposeFunction('studioProgress', () => {});
  await runner.page.exposeFunction('studioWrite', base64 => { chunks.push(Buffer.from(base64, 'base64')); });
  t.after(async () => { await runner.close(); await rm(directory, { recursive: true, force: true }); });
  let count = 0;
  return {
    tone, photo,
    // `kinds` lists the media for each request clip: 'tone' (2 s video with a pause), or 'photo'.
    async render(edit, kinds) {
      chunks.length = 0;
      const sources = kinds.map(kind => kind === 'photo' ? { url: '/media/photo', name: 'photo.png', type: 'image/png', kind: 'photo' } : { url: '/media/tone', name: 'tone.mp4', type: 'video/mp4', kind: 'video' });
      const result = await runner.page.evaluate(request => window.runStudio(request), { input: { quality: '720p', ...edit }, media: sources, overlays: [], transcriptOnly: false });
      if (result.error !== undefined) return { result };
      const file = join(directory, `out-${count++}.mp4`);
      await writeFile(file, Buffer.concat(chunks));
      const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])).stdout);
      const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-f', 'f32le', '-ac', '2', '-ar', String(RATE), '-'], { encoding: 'buffer', maxBuffer: 1 << 28 });
      const pcm = new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength - (stdout.byteLength % 8)));
      return { result, file, probe, pcm };
    },
  };
}
// First time at or after `from` seconds where either channel passes the threshold; null if never.
function onsetAfter(pcm, from, threshold = 0.004) {
  for (let sample = Math.floor(from * RATE); sample < pcm.length / 2; sample++) if (Math.abs(pcm[sample * 2]) > threshold || Math.abs(pcm[sample * 2 + 1]) > threshold) return sample / RATE;
  return null;
}
const loudness = (pcm, from, to) => { let peak = 0; for (let sample = Math.floor(from * RATE); sample < Math.min(pcm.length / 2, Math.floor(to * RATE)); sample++) peak = Math.max(peak, Math.abs(pcm[sample * 2]), Math.abs(pcm[sample * 2 + 1])); return peak; };
const attack = id => manifest.sounds.find(sound => sound.id === id).onsetSample / RATE;

const tones = (count, extra = {}) => Array.from({ length: count }, () => ({ path: '/tone.mp4', track: 'v1', mute: true, ...extra }));
const hasStreams = probe => { const [first, second] = probe.streams; return [first, second].map(stream => stream.codec_name + (stream.codec_type === 'audio' ? `/${stream.channels}/${stream.sample_rate}` : '')); };

test('a manual sound lands on its requested time in a real H.264 and stereo 48 kHz AAC export', { timeout: 180_000 }, async t => {
  const { render } = await lab(t);
  const { result, probe, pcm } = await render({ aspect: '9x16', clips: [{ path: '/photo.png', track: 'v1', out: 3 }], texts: [{ text: 'Hi', start: 1.8, duration: 1 }],
    sfx: [{ asset: 'ugc-click-01', start: 1.2, gain: 1 }, { asset: 'ugc-click-01', anchor: { kind: 'title-enter', text: 0 }, offset: 0.1, gain: 1 }] }, ['photo']);
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.deepEqual(hasStreams(probe), ['h264', 'aac/2/48000']);
  assert.ok(Math.abs(Number(probe.format.duration) - 3) < 0.1);
  const first = onsetAfter(pcm, 0);
  assert.ok(Math.abs(first - (1.2 + attack('ugc-click-01'))) < FRAME, `first click at ${first}`);
  const second = onsetAfter(pcm, 1.5);
  assert.ok(Math.abs(second - 1.9) < FRAME, `title-linked click at ${second}`);
  assert.ok(loudness(pcm, 0, 1.1) < 0.004 && loudness(pcm, 2.2, 3) < 0.004, 'nothing but the two clicks');
});

test('interspersed V2, pause removal and the rapid intro move requested sounds with the edit', { timeout: 240_000 }, async t => {
  const { render } = await lab(t);
  await t.test('a transition anchor counts request indices, not the sorted tracks', async () => {
    const edit = { aspect: '9x16', clips: [{ path: '/tone.mp4', track: 'v2', start: 0, mute: true, out: 1 }, ...tones(2, { out: 1.5 })], transitions: [{ after_clip: 1, type: 'crossfade', duration: 0.4 }],
      sfx: [{ asset: 'ugc-click-01', anchor: { kind: 'transition', after_clip: 1 }, gain: 1 }] };
    const { result, pcm } = await render(edit, ['tone', 'tone', 'tone']);
    assert.equal(result.error, undefined, JSON.stringify(result));
    // The second V1 clip starts at 1.5 - 0.4; the crossfade's event is the middle of that overlap.
    const onset = onsetAfter(pcm, 0);
    assert.ok(Math.abs(onset - 1.3) < FRAME, `crossfade event at ${onset}`);
  });
  await t.test('a sound that runs past the end is cut there and never extends the output', async () => {
    const { result, probe, pcm } = await render({ aspect: '9x16', clips: [{ path: '/photo.png', track: 'v1', out: 3 }], sfx: [{ asset: 'ugc-typing-01', start: 2.5, gain: 1 }] }, ['photo']);
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.ok(Math.abs(result.duration - 3) < 1e-6);
    assert.ok(Math.abs(Number(probe.format.duration) - 3) < 0.1);
    assert.ok(Math.abs(pcm.length / 2 / RATE - 3) < 0.1);
    assert.ok(loudness(pcm, 2.5, 3) > 0.004);
  });
  await t.test('pause removal warps an absolute start by the time removed before it', async () => {
    const edit = { aspect: '9x16', clips: tones(1), remove_silences: { sensitivity: 'normal', shortest_pause: 0.5 }, sfx: [{ asset: 'ugc-click-01', start: 1.8, gain: 1 }] };
    const { result, pcm } = await render(edit, ['tone']);
    assert.equal(result.error, undefined, JSON.stringify(result));
    const removed = 2 - result.duration;
    assert.ok(removed > 0.3, `a pause was removed (${removed})`);
    const onset = onsetAfter(pcm, 0);
    assert.ok(Math.abs(onset - (1.8 - removed + attack('ugc-click-01'))) < FRAME, `moved to ${onset}, expected ${1.8 - removed}`);
  });
  await t.test('the rapid intro shifts absolute starts by the teasers and keeps title-linked sounds on their clip', async () => {
    const edit = { aspect: '9x16', clips: tones(5, { out: 0.5 }), texts: [{ text: 'Bound', clip: 2 }],
      rapid_intro: { clips: [0, 1, 2, 3, 4], labels: ['a', 'b', 'c', 'd', 'e'].map((text, clip) => ({ clip, text })), frames_per_clip: 5 },
      sfx: [{ asset: 'ugc-click-01', start: 0.3, gain: 1 }, { asset: 'ugc-click-01', anchor: { kind: 'title-enter', text: 0 }, gain: 1 }] };
    const { result, pcm } = await render(edit, ['tone', 'tone', 'tone', 'tone', 'tone']);
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.ok(Math.abs(result.duration - (2.5 + 25 / 30)) < 1e-6);
    const first = onsetAfter(pcm, 0);
    assert.ok(Math.abs(first - (0.3 + 25 / 30)) < FRAME, `absolute start at ${first}`);
    const second = onsetAfter(pcm, first + 0.3);
    assert.ok(Math.abs(second - (25 / 30 + 1)) < FRAME, `title-linked sound at ${second}`);
  });
});

test('manual and automatic sound requests share the engine: the same rows give the same audio', { timeout: 180_000 }, async t => {
  const { render } = await lab(t);
  const base = { aspect: '9x16', clips: tones(2, { out: 1.5 }), transitions: [{ after_clip: 0, type: 'crossfade', duration: 0.4 }], texts: [{ text: 'Hello', start: 0.1, duration: 1 }] };
  const document = editDocument(base, media(2, 2));
  const plan = applyAutoSfx({ ...document, sfx: [] }, { events: ['title', 'transition'], seed: 11, intensity: 'subtle', title_sound: 'sparkle' });
  assert.equal(plan.state.sfx.length, 2, plan.notes.join(' '));
  const manual = plan.state.sfx.map(row => ({ asset: row.asset, gain: row.gain, offset: row.timing.offset,
    anchor: row.timing.anchor.kind === 'title-enter' ? { kind: 'title-enter', text: 0 } : { kind: 'transition', after_clip: 0 } }));
  const kinds = ['tone', 'tone'];
  const automatic = await render({ ...base, auto_sfx: { events: ['title', 'transition'], seed: 11, intensity: 'subtle', title_sound: 'sparkle' } }, kinds);
  const explicit = await render({ ...base, sfx: manual }, kinds);
  const silent = await render(base, kinds);
  assert.equal(automatic.result.error, undefined, JSON.stringify(automatic.result));
  assert.match(automatic.result.warnings[0], /^Added 2 automatic sounds/);
  assert.deepEqual(explicit.result.warnings, []);
  assert.equal(automatic.pcm.length, explicit.pcm.length);
  let difference = 0;
  for (let index = 0; index < automatic.pcm.length; index++) difference = Math.max(difference, Math.abs(automatic.pcm[index] - explicit.pcm[index]));
  assert.ok(difference < 1e-4, `the two requests decode to the same audio (max difference ${difference})`);
  assert.ok(loudness(automatic.pcm, 0, 3) > 0.004, 'the sounds are audible');
  assert.ok(loudness(silent.pcm, 0, 3) < 0.004, 'the same request without sounds is silent');
  const none = await render({ ...base, auto_sfx: { events: ['cta-tap'] } }, kinds);
  assert.match(none.result.warnings[0], /No eligible events/);
  assert.ok(loudness(none.pcm, 0, 3) < 0.004);
});

test('a requested owner that pause removal deletes fails with a named error and writes nothing', { timeout: 120_000 }, async t => {
  const { render } = await lab(t);
  const refused = await render({ aspect: '9x16', clips: [{ path: '/tone.mp4', track: 'v1', mute: true, in: 0.6, out: 1.4 }, ...tones(1)], remove_silences: { sensitivity: 'normal', shortest_pause: 0.5 },
    texts: [{ text: 'Gone', clip: 0 }], sfx: [{ asset: 'ugc-pop-01', anchor: { kind: 'title-enter', text: 0 } }] }, ['tone', 'tone']);
  assert.match(refused.result.error, /Invalid sfx\.0: its title, transition or overlay no longer exists after pause removal/);
  assert.equal(refused.result.details.field, 'sfx.0');
  assert.equal(refused.file, undefined);
});
