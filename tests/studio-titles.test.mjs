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
    [{ text: 'a', clip: 1 }, 'texts.0.clip'],
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
