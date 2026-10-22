import assert from 'node:assert/strict';
import test from 'node:test';
import { mapClips, mapTexts, validateEdit, editDocument, applyRapidIntro, checkRapidIntroStructure } from '../dist/studio-request.js';

const video = duration => ({ kind: 'video', duration, width: 1080, height: 1920 });
const photo = { kind: 'photo', duration: 3, width: 800, height: 600 };
const input = (clips, extra = {}) => ({ clips, aspect: '9x16', ...extra });
const v1 = (name, extra = {}) => ({ path: `/${name}.mp4`, track: 'v1', ...extra });
const media = (count, duration = 180) => Array.from({ length: count }, (_, index) => ({ id: `media-${index}`, kind: 'video', source: { ...video(duration), file: new File([], `${index}.mp4`), url: `blob:${index}` }, poster: '', hasAudio: true }));
const DEFAULT_STYLE = { font: 'sans', weight: 800, italic: false, fill: '#ffffff', size: 'm', x: 0.5, y: 0.5, backing: false };
const seven = Array.from({ length: 7 }, (_, index) => v1(`clip-${index}`));
const withV2 = [...seven, { path: '/reference.mp4', track: 'v2', start: 1 }];
const field = name => error => error.details.field === name;

test('three-frame minimum: video trims and photo durations accept 0.1 s and reject 0.09 s, naming the shared label', () => {
  assert.equal(mapClips(input([v1('a', { in: 1, out: 1.1 })]), [video(3)])[0].outPoint, 1.1);
  assert.throws(() => mapClips(input([v1('a', { in: 1, out: 1.09 })]), [video(3)]), error => error.details.field === 'clips.0' && /3 frames \(0\.1 seconds\)/.test(error.message));
  assert.equal(mapClips(input([{ path: '/a.png', track: 'v1', out: 0.1 }]), [photo])[0].duration, 0.1);
  assert.equal(mapClips(input([{ path: '/a.png', track: 'v1', out: 30 }]), [photo])[0].duration, 30);
  for (const out of [0.09, 30.01]) assert.throws(() => mapClips(input([{ path: '/a.png', track: 'v1', out }]), [photo]), error => error.details.field === 'clips.0' && /0\.1–30 seconds/.test(error.message));
});

test('titles take defaults only from the shared style, validate every field and bind to v1 request indices', () => {
  const ok = [
    [{ text: 'Hi', start: 0, duration: 2 }, { ...DEFAULT_STYLE, text: 'Hi', timing: { start: 0, duration: 2 } }],
    [{ text: 'Hook', clip: 0 }, { ...DEFAULT_STYLE, text: 'Hook', timing: { clipId: 'clip-0' } }],
    [{ text: '', clip: 0, timestamp: 'source' }, { ...DEFAULT_STYLE, text: '', timestamp: 'source', timing: { clipId: 'clip-0' } }],
    [{ text: 'a'.repeat(120), clip: 0, timestamp: 'timeline', font: 'serif', weight: 400, italic: true, fill: '#FFD60A', size: 'xl', x: 0, y: 1, backing: true },
      { font: 'serif', weight: 400, italic: true, fill: '#FFD60A', size: 'xl', x: 0, y: 1, backing: true, text: 'a'.repeat(120), timestamp: 'timeline', timing: { clipId: 'clip-0' } }],
    [{ text: 'min', start: 0, duration: 0.1 }, { ...DEFAULT_STYLE, text: 'min', timing: { start: 0, duration: 0.1 } }],
    [{ text: 'max', start: 1, duration: 180 }, { ...DEFAULT_STYLE, text: 'max', timing: { start: 1, duration: 180 } }],
    [{ text: 'mono', start: 0, duration: 1, font: 'mono', weight: 700 }, { ...DEFAULT_STYLE, font: 'mono', weight: 700, text: 'mono', timing: { start: 0, duration: 1 } }],
  ];
  for (const [request, expected] of ok) {
    const edit = input([v1('a'), v1('b')], { texts: [request] });
    assert.doesNotThrow(() => validateEdit(edit), JSON.stringify(request));
    const [title] = mapTexts(edit, mapClips(edit, [video(3), video(3)]));
    const { id, ...rest } = title;
    assert.equal(id, 'text-0');
    assert.deepEqual(rest, expected);
  }
  const interleaved = input([{ path: '/ref.mp4', track: 'v2', start: 0 }, v1('a')], { texts: [{ text: 'On a', clip: 1 }] });
  const clips = mapClips(interleaved, [video(3), video(3)]);
  assert.equal(mapTexts(interleaved, clips)[0].timing.clipId, 'clip-1');
  assert.ok(clips.some(clip => clip.id === 'clip-1'));
  const bad = [
    [{ text: 'a', start: 0, duration: 1, color: 'red' }, 'texts.0'],
    [{ text: 1, start: 0, duration: 1 }, 'texts.0.text'],
    [{ text: '', start: 0, duration: 1 }, 'texts.0.text'],
    [{ text: 'a'.repeat(121), start: 0, duration: 1 }, 'texts.0.text'],
    [{ text: 'a', timestamp: 'none', clip: 0 }, 'texts.0.timestamp'],
    [{ text: 'a', timestamp: 'source', start: 0, duration: 1 }, 'texts.0.timestamp'],
    [{ text: 'a', clip: 2 }, 'texts.0.clip'],
    [{ text: 'a', clip: -1 }, 'texts.0.clip'],
    [{ text: 'a', clip: 0.5 }, 'texts.0.clip'],
    [{ text: 'a', clip: '0' }, 'texts.0.clip'],
    [{ text: 'a', clip: 0, start: 0 }, 'texts.0.start'],
    [{ text: 'a', clip: 0, duration: 1 }, 'texts.0.duration'],
    [{ text: 'a' }, 'texts.0.start'],
    [{ text: 'a', start: -1, duration: 1 }, 'texts.0.start'],
    [{ text: 'a', start: NaN, duration: 1 }, 'texts.0.start'],
    [{ text: 'a', start: 0 }, 'texts.0.duration'],
    [{ text: 'a', start: 0, duration: 0.09 }, 'texts.0.duration'],
    [{ text: 'a', start: 0, duration: 180.1 }, 'texts.0.duration'],
    [{ text: 'a', clip: 0, font: 'comic' }, 'texts.0.font'],
    [{ text: 'a', clip: 0, font: 'serif' }, 'texts.0.font'],
    [{ text: 'a', clip: 0, weight: 400 }, 'texts.0.weight'],
    [{ text: 'a', clip: 0, weight: 800.5 }, 'texts.0.weight'],
    [{ text: 'a', clip: 0, font: 'mono', weight: 700, italic: true }, 'texts.0.font'],
    [{ text: 'a', clip: 0, italic: true }, 'texts.0.italic'],
    [{ text: 'a', clip: 0, fill: 'red' }, 'texts.0.fill'],
    [{ text: 'a', clip: 0, size: 'xxl' }, 'texts.0.size'],
    [{ text: 'a', clip: 0, x: 1.01 }, 'texts.0.x'],
    [{ text: 'a', clip: 0, y: -0.01 }, 'texts.0.y'],
    [{ text: 'a', clip: 0, backing: 'yes' }, 'texts.0.backing'],
  ];
  for (const [request, name] of bad) assert.throws(() => validateEdit(input([v1('a'), { path: '/ref.mp4', track: 'v2', start: 0 }], { texts: [request] })), field(name), JSON.stringify(request));
  assert.throws(() => validateEdit(input([v1('a')], { texts: Array.from({ length: 101 }, () => ({ text: 'a', clip: 0 })) })), field('texts'));
  assert.throws(() => validateEdit(input([v1('a')], { texts: {} })), field('texts'));
  assert.doesNotThrow(() => validateEdit(input([v1('a')], { texts: Array.from({ length: 100 }, () => ({ text: 'a', clip: 0 })) })));
});

test('title reveals are stored complete from the shared default and fail by request field before any I/O', () => {
  const FULL = { x: 0, y: 0, width: 1, height: 1 };
  const DEFAULT_REVEAL = { rect: FULL, direction: 'up', start: 0, duration: 0.4, easing: 'ease-out' };
  const ok = [
    [{}, DEFAULT_REVEAL],
    [{ direction: 'right' }, { ...DEFAULT_REVEAL, direction: 'right' }],
    [{ rect: { x: 0.5, width: 0.5 } }, { ...DEFAULT_REVEAL, rect: { x: 0.5, y: 0, width: 0.5, height: 1 } }],
    [{ rect: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, direction: 'left', start: 0.5, duration: 1.5, easing: [0.1, 0.2, 0.3, 0.4] },
      { rect: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, direction: 'left', start: 0.5, duration: 1.5, easing: [0.1, 0.2, 0.3, 0.4] }],
    [{ direction: 'down', start: 180, duration: 10, easing: 'hold', rect: { width: 0.01, height: 0.01 } }, { ...DEFAULT_REVEAL, direction: 'down', start: 180, duration: 10, easing: 'hold', rect: { x: 0, y: 0, width: 0.01, height: 0.01 } }],
    [{ duration: 1 / 30 }, { ...DEFAULT_REVEAL, duration: 1 / 30 }],
  ];
  for (const [reveal, expected] of ok) {
    const edit = input([v1('a')], { texts: [{ text: 'Hi', clip: 0, reveal }] });
    assert.doesNotThrow(() => validateEdit(edit), JSON.stringify(reveal));
    const [title] = mapTexts(edit, mapClips(edit, [video(3)]));
    assert.deepEqual(title.reveal, expected, JSON.stringify(reveal));
    assert.equal(Object.hasOwn(title, 'animationOffset'), false);
  }
  const plain = input([v1('a')], { texts: [{ text: 'Hi', clip: 0 }] });
  assert.equal(Object.hasOwn(mapTexts(plain, mapClips(plain, [video(3)]))[0], 'reveal'), false);
  const bad = [
    ['wipe', 'texts.0.reveal'], [null, 'texts.0.reveal'], [[], 'texts.0.reveal'], [{ phase: 1 }, 'texts.0.reveal'], [{ animationOffset: 1 }, 'texts.0.reveal'],
    [{ rect: 5 }, 'texts.0.reveal.rect'], [{ rect: { z: 1 } }, 'texts.0.reveal.rect'], [{ rect: { x: 0.6, width: 0.6 } }, 'texts.0.reveal.rect'], [{ rect: { y: 0.5, height: 0.6 } }, 'texts.0.reveal.rect'],
    [{ rect: { width: 0.005 } }, 'texts.0.reveal.rect'], [{ rect: { height: 0 } }, 'texts.0.reveal.rect'], [{ rect: { x: -0.1 } }, 'texts.0.reveal.rect'], [{ rect: { y: '0' } }, 'texts.0.reveal.rect'],
    [{ direction: 'diagonal' }, 'texts.0.reveal.direction'], [{ direction: 1 }, 'texts.0.reveal.direction'],
    [{ start: -0.1 }, 'texts.0.reveal.start'], [{ start: 180.1 }, 'texts.0.reveal.start'], [{ start: NaN }, 'texts.0.reveal.start'],
    [{ duration: 0 }, 'texts.0.reveal.duration'], [{ duration: 0.03 }, 'texts.0.reveal.duration'], [{ duration: 10.01 }, 'texts.0.reveal.duration'], [{ duration: '1' }, 'texts.0.reveal.duration'],
    [{ easing: 'bounce' }, 'texts.0.reveal.easing'], [{ easing: [1, 2, 3, 4] }, 'texts.0.reveal.easing'], [{ easing: [0, 0, 0] }, 'texts.0.reveal.easing'],
  ];
  for (const [reveal, name] of bad) assert.throws(() => validateEdit(input([v1('a')], { texts: [{ text: 'Hi', clip: 0, reveal }] })), field(name), JSON.stringify(reveal));
  assert.throws(() => validateEdit(input([v1('a')], { texts: [{ text: 'Hi', clip: 0 }, { text: 'Hi', start: 0, duration: 1, reveal: { duration: 0 } }] })), field('texts.1.reveal.duration'));
});

const keyRows = (...keys) => keys.map(([at, value, easing = 'linear']) => ({ at, value, easing }));
const FADE_IN = { opacity: keyRows([0, 0, 'ease-out'], [0.5, 1]) };
const OVERLAY_URL = '/overlays/hook-title?setup=Hello';
const keyRun = count => Array.from({ length: count }, (_, index) => ({ at: index * 0.5, value: 0.5, easing: 'linear' }));

test('title and overlay motion keeps local-second rows, has no phase field and fails by request field', () => {
  const slide = { x: keyRows([0, 0], [1, -0.15, [0.25, 0.1, 0.25, 1]]) };
  const edit = input([v1('a'), v1('b')], { texts: [{ text: 'Watch this', start: 0, duration: 4, motion: FADE_IN }, { text: 'Bound', clip: 1, motion: slide }, { text: 'Still', clip: 0 }], overlays: [{ configuration: OVERLAY_URL, start: 0, motion: FADE_IN }] });
  const [explicit, bound, still] = mapTexts(edit, mapClips(edit, [video(4), video(4)]));
  assert.deepEqual([explicit.motion, bound.motion], [FADE_IN, slide]);
  for (const title of [explicit, bound, still]) assert.equal(Object.hasOwn(title, 'animationOffset'), false);
  assert.equal(Object.hasOwn(still, 'motion'), false);
  assert.deepEqual(editDocument(edit, media(2, 4)).texts.map(title => Object.hasOwn(title, 'motion')), [true, true, false]);
  const places = {
    texts: motion => input([v1('a')], { texts: [{ text: 'a', clip: 0 }, { text: 'b', start: 0, duration: 1, motion }] }),
    overlays: motion => input([v1('a')], { overlays: [{ configuration: OVERLAY_URL, start: 0 }, { configuration: OVERLAY_URL, start: 0, motion }] }),
  };
  const later = 'Motion scale[1].at must be later than the previous key';
  const table = [
    [null, 'Motion must be an object of channels'], [{}, 'Motion needs at least one channel'], [{ blur: keyRows([0, 1]) }, 'Motion has no blur channel. Use x, y, scale, rotation, opacity'],
    [{ scale: keyRows([0, 1], [1, 6]) }, 'Motion scale[1].value must be between 0.1 and 5'], [{ opacity: keyRows([0, -0.1]) }, 'Motion opacity[0].value must be between 0 and 1'],
    [{ opacity: keyRows([181, 1]) }, 'Motion opacity[0].at must be between 0 and 180 seconds'], [{ opacity: keyRows([-0.5, 1]) }, 'Motion opacity[0].at must be between 0 and 180 seconds'],
    [{ scale: keyRows([1, 1], [1, 1.2]) }, later], [{ scale: keyRows([2, 1], [1, 1.2]) }, later], [{ scale: keyRows([1, 1], [1.0000005, 1.2]) }, later],
    [{ x: [{ at: 0, value: 0, easing: 'bounce' }] }, 'Motion x[0].easing must be hold, linear, ease-in, ease-out, ease-in-out or four numbers between 0 and 1'], [{ x: [{ at: 0, value: 0 }] }, 'Motion x[0] needs exactly at, value and easing'],
    [{ rotation: keyRun(61) }, 'Motion rotation has at most 60 keys'],
  ];
  for (const [name, build] of Object.entries(places)) {
    for (const [motion, reason] of table) assert.throws(() => validateEdit(build(motion)), error => error.details.field === `${name}.1.motion` && error.message === `Invalid ${name}.1.motion: ${reason}.`, `${name} ${JSON.stringify(motion)}`);
    for (const at of [0, 180]) assert.doesNotThrow(() => validateEdit(build({ opacity: keyRows([at, 1]) })));
  }
  // The phase offset is saved structure created by edits, never a request field.
  assert.throws(() => validateEdit(input([v1('a')], { texts: [{ text: 'a', clip: 0, motion: FADE_IN, animationOffset: 1 }] })), field('texts.0'));
  assert.throws(() => validateEdit(input([v1('a')], { overlays: [{ configuration: OVERLAY_URL, start: 0, motion: FADE_IN, animationOffset: 1 }] })), field('overlays'));
  // One request holds at most 1000 keys across clips, titles and overlays.
  const counted = overlayKeys => input([v1('a')], { texts: Array.from({ length: 16 }, () => ({ text: 'a', clip: 0, motion: { x: keyRun(60) } })), overlays: [{ configuration: OVERLAY_URL, start: 0, motion: { y: keyRun(overlayKeys) } }] });
  assert.doesNotThrow(() => validateEdit(counted(40)));
  assert.throws(() => validateEdit(counted(41)), field('motion'));
});

test('titles are checked against the mapped timeline: photos have no source stamp and explicit starts stay inside', () => {
  const rows = [
    [{ text: 'a', clip: 1, timestamp: 'source' }, false],
    [{ text: 'a', clip: 1, timestamp: 'timeline' }, true],
    [{ text: 'a', start: 4.99, duration: 1 }, true],
    [{ text: 'a', start: 5, duration: 1 }, false],
  ];
  for (const [title, valid] of rows) {
    const edit = input([v1('a', { out: 2 }), { path: '/p.png', track: 'v1', out: 3 }], { texts: [title] });
    const clips = mapClips(edit, [video(3), photo]);
    if (valid) assert.doesNotThrow(() => mapTexts(edit, clips), JSON.stringify(title));
    else assert.throws(() => mapTexts(edit, clips), field('texts.0'), JSON.stringify(title));
  }
});

test('rapid intro requests are validated strictly before any media is read', () => {
  const label = clip => ({ clip, text: `Label ${clip}` });
  const intro = (extra = {}, chosen = [0, 1, 2, 3, 4]) => ({ clips: chosen, labels: chosen.map(label), ...extra });
  const ok = [
    intro(), intro({}, [0, 1, 2, 3, 4, 5, 6]), intro({}, [4, 2, 0, 6, 1]), intro({ labels: [4, 3, 2, 1, 0].map(label) }),
    ...[3, 4, 5, 6].map(frames_per_clip => intro({ frames_per_clip })),
    intro({ timestamp: 'none' }), intro({ timestamp: 'timeline', labels: [0, 1, 2, 3, 4].map(clip => ({ clip, text: '' })) }), intro({ mute_teasers: false }),
    intro({ labels: [0, 1, 2, 3, 4].map(clip => ({ clip, text: 'a'.repeat(120) })) }),
  ];
  for (const rapid_intro of ok) assert.doesNotThrow(() => validateEdit(input(withV2, { rapid_intro })), JSON.stringify(rapid_intro).slice(0, 100));
  const bad = [
    [intro({}, [0, 1, 2, 3]), 'rapid_intro.clips'],
    [intro({}, [0, 1, 2, 3, 4, 5, 6, 7]), 'rapid_intro.clips'],
    [intro({}, [0, 1, 2, 3, 3]), 'rapid_intro.clips'],
    [intro({}, [0, 1, 2, 3, 7]), 'rapid_intro.clips'],
    [intro({}, [0, 1, 2, 3, 8]), 'rapid_intro.clips'],
    [intro({}, [0, 1, 2, 3, -1]), 'rapid_intro.clips'],
    [intro({}, [0, 1, 2, 3, 0.5]), 'rapid_intro.clips'],
    [{ ...intro(), clips: 'all' }, 'rapid_intro.clips'],
    [intro({ frames_per_clip: 2 }), 'rapid_intro.frames_per_clip'],
    [intro({ frames_per_clip: 7 }), 'rapid_intro.frames_per_clip'],
    [intro({ frames_per_clip: 5.5 }), 'rapid_intro.frames_per_clip'],
    [intro({ frames_per_clip: '5' }), 'rapid_intro.frames_per_clip'],
    [intro({ timestamp: 'output' }), 'rapid_intro.timestamp'],
    [intro({ mute_teasers: 'yes' }), 'rapid_intro.mute_teasers'],
    [intro({ extra: 1 }), 'rapid_intro'],
    [{ clips: [0, 1, 2, 3, 4] }, 'rapid_intro.labels'],
    [intro({ labels: [0, 1, 2, 3].map(label) }), 'rapid_intro.labels'],
    [intro({ labels: [0, 1, 2, 3, 4, 5].map(label) }), 'rapid_intro.labels'],
    [intro({ labels: [0, 1, 2, 3, 5].map(label) }), 'rapid_intro.labels.4.clip'],
    [intro({ labels: [0, 1, 2, 3, 3].map(label) }), 'rapid_intro.labels.4.clip'],
    [intro({ labels: [0, 1, 2, 3, 4].map(clip => clip === 2 ? { clip, text: 'a'.repeat(121) } : label(clip)) }), 'rapid_intro.labels.2.text'],
    [intro({ labels: [0, 1, 2, 3, 4].map(clip => clip === 1 ? { clip, text: 5 } : label(clip)) }), 'rapid_intro.labels.1.text'],
    [intro({ timestamp: 'none', labels: [0, 1, 2, 3, 4].map(clip => clip === 3 ? { clip, text: '' } : label(clip)) }), 'rapid_intro.labels.3.text'],
    [intro({ labels: [0, 1, 2, 3, 4].map(clip => ({ ...label(clip), extra: 1 })) }), 'rapid_intro.labels.0'],
  ];
  for (const [rapid_intro, name] of bad) assert.throws(() => validateEdit(input(withV2, { rapid_intro })), field(name), JSON.stringify(rapid_intro).slice(0, 100));
  assert.throws(() => validateEdit(input(withV2, { rapid_intro: 'yes' })), field('rapid_intro'));
});

// "Make a five-frame rapid intro from grind.mp4, pour.mp4, stir.mp4, steam.mp4 and serve.mp4, then replay them with source timestamps and the labels …, in 9:16."
const PROMPT_NAMES = ['grind', 'pour', 'stir', 'steam', 'serve'];
const PROMPT_LABELS = ['Grind beans', 'Pour water', 'Stir', 'Steam milk', 'Serve'];
const PROMPT_IN = [5, 65, 12, 0, 125];
const prompt = (extra = {}) => input([...PROMPT_NAMES.map((name, index) => v1(name, { in: PROMPT_IN[index], out: PROMPT_IN[index] + 4 })), { path: '/reference.mp4', track: 'v2', start: 3, out: 4 }],
  { rapid_intro: { clips: [0, 1, 2, 3, 4], frames_per_clip: 5, timestamp: 'source', labels: PROMPT_LABELS.map((text, clip) => ({ clip, text })) }, texts: [{ text: 'Coffee', start: 1, duration: 2, y: 0.2 }], ...extra });

test('the one-line rapid intro prompt builds teasers, a labelled untouched body and shifted absolute times in one edit', () => {
  const edit = prompt();
  const state = editDocument(edit, media(6));
  const next = applyRapidIntro(state, edit.rapid_intro);
  const v1Clips = next.clips.filter(clip => clip.track === 'v1');
  const teasers = v1Clips.slice(0, 5);
  const body = v1Clips.slice(5);
  assert.equal(teasers.length, 5);
  assert.deepEqual(teasers.map(clip => clip.mediaId), [0, 1, 2, 3, 4].map(index => `media-${index}`), 'one teaser per chosen clip, in teaser order, reusing the same media');
  for (const [index, clip] of teasers.entries()) {
    assert.equal(clip.inPoint, PROMPT_IN[index]);
    assert.ok(Math.abs(clip.outPoint - clip.inPoint - 5 / 30) < 1e-9, `${index} lasts exactly five frames`);
    assert.equal(clip.settings.muted, true);
    assert.equal(clip.transition, undefined);
    assert.equal(clip.punchIns, undefined);
    assert.ok(!body.some(item => item.id === clip.id));
  }
  assert.equal(new Set(next.clips.map(clip => clip.id)).size, next.clips.length);
  assert.deepEqual(body.map(clip => [clip.id, clip.inPoint, clip.outPoint, clip.settings.muted]), [0, 1, 2, 3, 4].map(index => [`clip-${index}`, PROMPT_IN[index], PROMPT_IN[index] + 4, false]));
  const reference = next.clips.find(clip => clip.track === 'v2');
  assert.ok(Math.abs(reference.start - (3 + 25 / 30)) < 1e-9, 'V2 moves later by the teaser total');
  const labels = next.texts.filter(title => 'clipId' in title.timing);
  assert.deepEqual(labels.map(title => [title.text, title.timestamp, title.timing.clipId]), PROMPT_LABELS.map((text, index) => [text, 'source', `clip-${index}`]));
  const explicit = next.texts.find(title => title.text === 'Coffee');
  assert.ok(Math.abs(explicit.timing.start - (1 + 25 / 30)) < 1e-9 && explicit.timing.duration === 2, 'explicit titles move with the intro');
  assert.equal(state.clips.length, 6, 'the input document is untouched');
  assert.equal(next.texts.length, 6);
});

test('rapid intro options: frames, timeline stamps, unmuted teasers and wordless timestamp labels', () => {
  const edit = prompt();
  for (const frames of [3, 4, 5, 6]) {
    const next = applyRapidIntro(editDocument(edit, media(6)), { ...edit.rapid_intro, frames_per_clip: frames });
    const [first] = next.clips;
    assert.ok(Math.abs(first.outPoint - first.inPoint - frames / 30) < 1e-9);
  }
  const defaults = applyRapidIntro(editDocument(edit, media(6)), { clips: edit.rapid_intro.clips, labels: edit.rapid_intro.labels });
  assert.ok(Math.abs(defaults.clips[0].outPoint - defaults.clips[0].inPoint - 5 / 30) < 1e-9, 'default is five frames');
  assert.equal(defaults.clips[0].settings.muted, true, 'default is muted teasers');
  assert.equal(defaults.texts.filter(title => title.timestamp === 'source').length, 5, 'default stamp is source');
  const unmuted = applyRapidIntro(editDocument(edit, media(6)), { ...edit.rapid_intro, mute_teasers: false, timestamp: 'timeline' });
  assert.equal(unmuted.clips[0].settings.muted, false);
  assert.equal(unmuted.texts.filter(title => title.timestamp === 'timeline').length, 5);
  const none = applyRapidIntro(editDocument(edit, media(6)), { ...edit.rapid_intro, timestamp: 'none' });
  assert.equal(none.texts.filter(title => title.timestamp !== undefined).length, 0);
  const bare = applyRapidIntro(editDocument(edit, media(6)), { ...edit.rapid_intro, labels: edit.rapid_intro.labels.map(({ clip }) => ({ clip, text: '' })) });
  assert.deepEqual(bare.texts.filter(title => title.text === '' && title.timestamp === 'source').length, 5);
});

test('a refused rapid intro names the cause and leaves the document unchanged', () => {
  const short = prompt();
  short.clips[2].out = short.clips[2].in + 0.1;
  const shortState = editDocument(short, media(6));
  assert.throws(() => applyRapidIntro(shortState, short.rapid_intro), error => error.details.field === 'rapid_intro' && /Rapid intro was not built: .*shorter than 5 frames/.test(error.message));
  assert.equal(applyRapidIntro(shortState, { ...short.rapid_intro, frames_per_clip: 3 }).clips.length, 11, 'the same clip is long enough for a three-frame teaser');

  const photoEdit = input([...PROMPT_NAMES.slice(0, 4).map(name => v1(name, { out: 4 })), { path: '/p.png', track: 'v1', out: 3 }], { rapid_intro: { clips: [0, 1, 2, 3, 4], labels: PROMPT_LABELS.map((text, clip) => ({ clip, text })) } });
  const photoMedia = [...media(4), { id: 'media-4', kind: 'photo', source: { width: 800, height: 600 }, poster: '', hasAudio: false }];
  const photoState = editDocument(photoEdit, photoMedia);
  assert.throws(() => applyRapidIntro(photoState, photoEdit.rapid_intro), error => /photo has no source timestamp/.test(error.message));
  assert.equal(applyRapidIntro(photoState, { ...photoEdit.rapid_intro, timestamp: 'timeline' }).clips.length, 10, 'timeline stamps work for photos');

  const long = input(PROMPT_NAMES.map(name => v1(name, { in: 0, out: 35.9 })), { rapid_intro: { clips: [0, 1, 2, 3, 4], labels: PROMPT_LABELS.map((text, clip) => ({ clip, text })) } });
  const longState = editDocument(long, media(5));
  assert.throws(() => applyRapidIntro(longState, long.rapid_intro), error => /at most 180 seconds/.test(error.message));

  const crowded = input(Array.from({ length: 296 }, (_, index) => v1(`c${index}`, { out: 0.5 })), { rapid_intro: { clips: [0, 1, 2, 3, 4], labels: PROMPT_LABELS.map((text, clip) => ({ clip, text })) } });
  assert.throws(() => applyRapidIntro(editDocument(crowded, media(296, 4)), crowded.rapid_intro), error => /at most 300 clips/.test(error.message));

  const heavy = input(Array.from({ length: 250 }, (_, index) => v1(`${'long-name-'.repeat(20)}${index}`, { out: 0.5 })), { rapid_intro: { clips: [0, 1, 2, 3, 4], labels: PROMPT_LABELS.map((text, clip) => ({ clip, text })) } });
  const heavyState = editDocument(heavy, media(250, 4));
  assert.throws(() => applyRapidIntro(heavyState, heavy.rapid_intro), error => /64 KiB/.test(error.message));
});

test('the structural intro check runs before silence removal and a clip with no footage left is named', () => {
  const photoEdit = input([...PROMPT_NAMES.slice(0, 4).map(name => v1(name, { out: 4 })), { path: '/p.png', track: 'v1', out: 3 }], { rapid_intro: { clips: [0, 1, 2, 3, 4], labels: PROMPT_LABELS.map((text, clip) => ({ clip, text })) } });
  const state = editDocument(photoEdit, [...media(4), { id: 'media-4', kind: 'photo', source: { width: 800, height: 600 }, poster: '', hasAudio: false }]);
  assert.throws(() => checkRapidIntroStructure(photoEdit.rapid_intro, state.clips), error => error.details.field === 'rapid_intro.timestamp' && /photo has no source timestamp/.test(error.message));
  assert.doesNotThrow(() => checkRapidIntroStructure({ ...photoEdit.rapid_intro, timestamp: 'timeline' }, state.clips));
  const long = input(PROMPT_NAMES.map(name => v1(name, { in: 0, out: 35.9 })), { rapid_intro: { clips: [0, 1, 2, 3, 4], labels: PROMPT_LABELS.map((text, clip) => ({ clip, text })) } });
  assert.doesNotThrow(() => checkRapidIntroStructure(long.rapid_intro, editDocument(long, media(5)).clips), 'duration is judged on the edited result, not here');
  const gone = editDocument(long, media(5));
  gone.clips = gone.clips.filter(clip => clip.id !== 'clip-2');
  assert.throws(() => applyRapidIntro(gone, long.rapid_intro), error => error.details.field === 'rapid_intro.clips' && /clip 2 has no footage left after silence removal/.test(error.message));
});

test('rapid intro teasers start without motion while the body clips and titles keep their curves', () => {
  const motion = { scale: keyRows([0, 1], [2, 1.2]) };
  const edit = prompt({ texts: [{ text: 'Coffee', start: 1, duration: 2, motion: FADE_IN }] });
  edit.clips[0] = { ...edit.clips[0], motion };
  const next = applyRapidIntro(editDocument(edit, media(6)), edit.rapid_intro);
  const v1Clips = next.clips.filter(clip => clip.track === 'v1');
  for (const teaser of v1Clips.slice(0, 5)) assert.equal(teaser.motion, undefined);
  assert.deepEqual(v1Clips[5].motion, motion);
  const explicit = next.texts.find(title => title.text === 'Coffee');
  assert.deepEqual(explicit.motion, FADE_IN);
  assert.equal(explicit.animationOffset, undefined);
});

test('behind-person titles map request indices (v1, v2, photo), fixed model and shared defaults, and fail by field', () => {
  const DEFAULT_OCCLUSION = { model: 'people-v1', threshold: 0.5, feather: 1, smoothing: 0.2 };
  const clips = [{ path: '/ref.mp4', track: 'v2', start: 4 }, v1('a'), v1('b'), { path: '/still.png', track: 'v1', out: 2 }];
  const sources = [video(3), video(3), video(3), photo];
  const occluded = title => input(clips, { texts: [title] });
  const mapped = title => mapTexts(occluded(title), mapClips(occluded(title), sources))[0];
  const ok = [
    [{ text: 'a', start: 0, duration: 1, occlusion: { clip: 1 } }, { clipId: 'clip-1', ...DEFAULT_OCCLUSION }],
    [{ text: 'a', start: 4.5, duration: 1, occlusion: { clip: 0, threshold: 0.9, feather: 0, smoothing: 0.5 } }, { clipId: 'clip-0', model: 'people-v1', threshold: 0.9, feather: 0, smoothing: 0.5 }],
    [{ text: 'a', start: 6.5, duration: 1, occlusion: { clip: 3, feather: 4 } }, { clipId: 'clip-3', ...DEFAULT_OCCLUSION, feather: 4 }],
    [{ text: 'a', clip: 2, occlusion: {} }, { clipId: 'clip-2', ...DEFAULT_OCCLUSION }],
    [{ text: 'a', clip: 2, occlusion: { clip: 2, threshold: 0.1 } }, { clipId: 'clip-2', ...DEFAULT_OCCLUSION, threshold: 0.1 }],
    [{ text: 'a', clip: 0, timestamp: 'timeline', occlusion: {} }, { clipId: 'clip-0', ...DEFAULT_OCCLUSION }],
  ];
  for (const [request, expected] of ok) {
    assert.doesNotThrow(() => validateEdit(occluded(request)), JSON.stringify(request));
    const title = mapped(request);
    assert.deepEqual(title.occlusion, expected, JSON.stringify(request));
    assert.equal(Object.hasOwn(title, 'animationOffset'), false);
  }
  assert.equal(mapped({ text: 'a', clip: 0 }).timing.clipId, 'clip-0', 'a title may now bind to a v2 clip');
  assert.equal(Object.hasOwn(mapped({ text: 'plain', start: 0, duration: 1 }), 'occlusion'), false);
  const canonical = mapClips(occluded(ok[0][0]), sources);
  assert.deepEqual(canonical.map(clip => clip.id), ['clip-1', 'clip-2', 'clip-3', 'clip-0'], 'owners are request indices, not canonical positions');
  const bad = [
    ['person', 'texts.0.occlusion'], [null, 'texts.0.occlusion'], [[], 'texts.0.occlusion'], [{ clip: 1, model: 'people-v1' }, 'texts.0.occlusion'], [{ clip: 1, mode: 'person' }, 'texts.0.occlusion'], [{ clip: 1, animationOffset: 1 }, 'texts.0.occlusion'],
    [{}, 'texts.0.occlusion.clip'], [{ clip: -1 }, 'texts.0.occlusion.clip'], [{ clip: 4 }, 'texts.0.occlusion.clip'], [{ clip: 0.5 }, 'texts.0.occlusion.clip'], [{ clip: '1' }, 'texts.0.occlusion.clip'],
    [{ clip: 1, threshold: 0.09 }, 'texts.0.occlusion.threshold'], [{ clip: 1, threshold: 0.91 }, 'texts.0.occlusion.threshold'], [{ clip: 1, threshold: '0.5' }, 'texts.0.occlusion.threshold'],
    [{ clip: 1, feather: -0.1 }, 'texts.0.occlusion.feather'], [{ clip: 1, feather: 4.1 }, 'texts.0.occlusion.feather'], [{ clip: 1, feather: NaN }, 'texts.0.occlusion.feather'],
    [{ clip: 1, smoothing: -0.1 }, 'texts.0.occlusion.smoothing'], [{ clip: 1, smoothing: 0.51 }, 'texts.0.occlusion.smoothing'],
  ];
  for (const [occlusion, name] of bad) assert.throws(() => validateEdit(occluded({ text: 'a', start: 0, duration: 1, occlusion })), field(name), JSON.stringify(occlusion));
  for (const occlusion of [{ clip: 1 }, { clip: 0 }]) assert.throws(() => validateEdit(occluded({ text: 'a', clip: 2, occlusion })), field('texts.0.occlusion.clip'), 'a bound title keeps its own clip');
  assert.throws(() => validateEdit(occluded({ text: 'a', clip: 2, occlusion: { threshold: 2 } })), field('texts.0.occlusion.threshold'));
  assert.throws(() => validateEdit(input([v1('a')], { texts: [{ text: 'ok', clip: 0 }, { text: 'b', start: 0, duration: 1, occlusion: { feather: 9, clip: 0 } }] })), field('texts.1.occlusion.feather'));
  // An explicit title that never shares time with its owner is refused once the media timeline is known.
  const apart = (start, clip) => { const edit = occluded({ text: 'a', start, duration: 1, occlusion: { clip } }); return () => mapTexts(edit, mapClips(edit, sources)); };
  assert.throws(apart(0, 2), field('texts.0.occlusion.clip'), 'b plays from 3 s');
  assert.throws(apart(7.5, 0), field('texts.0.occlusion.clip'), 'the v2 clip ends at 7 s');
  assert.doesNotThrow(apart(2.5, 2));
  assert.doesNotThrow(apart(6.5, 0));
});

test('person owners follow the shared reducer through the rapid intro and shift only absolute times', () => {
  const edit = prompt({ texts: [{ text: 'Behind', start: 2.5, duration: 2, occlusion: { clip: 5 } }, { text: 'Bound', clip: 2, occlusion: {} }, { text: 'On ref', clip: 5 }] });
  assert.doesNotThrow(() => validateEdit(edit));
  const state = editDocument(edit, media(6));
  const next = applyRapidIntro(state, edit.rapid_intro);
  const [behind, bound, onReference] = next.texts.filter(title => ['Behind', 'Bound', 'On ref'].includes(title.text));
  assert.equal(behind.occlusion.clipId, 'clip-5');
  assert.ok(Math.abs(behind.timing.start - (2.5 + 25 / 30)) < 1e-9, 'the explicit title moves with the intro');
  assert.deepEqual([bound.timing.clipId, bound.occlusion.clipId], ['clip-2', 'clip-2']);
  assert.equal(onReference.timing.clipId, 'clip-5');
  assert.equal(next.clips.some(clip => clip.id === 'clip-5' && clip.track === 'v2'), true);
});
