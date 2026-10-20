import assert from 'node:assert/strict';
import test from 'node:test';
import { mapClips, validateEdit, editDocument, correctTranscript, applyWordStyles, selectorsCustomized } from '../dist/studio-request.js';

const video = duration => ({ kind: 'video', duration, width: 1920, height: 1080 });
const input = clips => ({ clips, aspect: '9x16' });
test('Studio mapping preserves trims, settings and source punch-ins and clamps crossfades', () => {
  const request = { ...input([{ track: 'v1', path: '/a.mp4', in: 1, out: 2, zoom: 2, pan_x: 0, volume: 0.5, fade_out: 0.8, punch_ins: [{ at: 1.2, length: 0.5, zoom: 125 }] }, { track: 'v1', path: '/b.mp4', out: 1 }]), transitions: [{ after_clip: 0, type: 'crossfade', duration: 1 }] };
  const clips = mapClips(request, [video(4), video(4)]);
  assert.equal(clips[0].inPoint, 1);
  assert.equal(clips[0].settings.volume, 0.5);
  assert.equal(clips[0].settings.fadeOut, 0.8);
  assert.ok(clips[0].settings.centerX > 0);
  assert.deepEqual(clips[0].punchIns, [{ start: 1.2, length: 0.5, zoom: 1.25 }]);
  assert.deepEqual(clips[0].transition, { type: 'crossfade', duration: 0.45, to: clips[1].id });
});
test('Studio validates post-overlap length, counts, source bounds and transition adjacency', () => {
  assert.equal(mapClips({ ...input([{ track: 'v1', path: '/a' }, { track: 'v1', path: '/b' }]), transitions: [{ after_clip: 0, type: 'crossfade', duration: 0.6 }] }, [video(90.3), video(90.3)]).length, 2);
  assert.throws(() => mapClips(input([{ track: 'v1', path: '/a' }, { track: 'v1', path: '/b' }]), [video(100), video(81)]));
  assert.throws(() => mapClips(input([{ track: 'v1', path: '/a', out: 3 }]), [video(2)]));
  assert.throws(() => mapClips(input([{ track: 'v1', path: '/a', in: 1, out: 1.09 }]), [video(2)]), error => error.details.field === 'clips.0' && /3 frames \(0\.1 seconds\)/.test(error.message));
  assert.equal(mapClips(input([{ track: 'v1', path: '/a', in: 1, out: 1.1 }]), [video(2)])[0].outPoint, 1.1);
  assert.throws(() => validateEdit(input(Array.from({ length: 301 }, () => ({ track: 'v1', path: '/a' })))));
  assert.throws(() => mapClips({ ...input([{ track: 'v1', path: '/a' }]), transitions: [{ after_clip: 0, type: 'dip', duration: 0.4 }] }, [video(2)]));
});
test('Studio photo duration, virtual timing and audio constraints share Studio validation', () => {
  const photo = { kind: 'photo', duration: 3, width: 100, height: 100 };
  const clip = mapClips(input([{ track: 'v1', path: '/a.png', in: 1, out: 5, fit: 'fit', slow_zoom: true }]), [photo])[0];
  assert.equal(clip.duration, 4); assert.equal(clip.sourceStart, 1); assert.equal(clip.inPoint, 0);
  assert.equal(clip.settings.slowZoom, true);
  assert.throws(() => mapClips(input([{ track: 'v1', path: '/a.png', out: 31 }]), [photo]));
  assert.throws(() => mapClips(input([{ track: 'v1', path: '/a.png', volume: 1 }]), [photo]));
  assert.throws(() => mapClips(input([{ track: 'v1', path: '/a.mp4', slow_zoom: true }]), [video(2)]));
});
test('Studio rejects malformed caption/silence requests and overlapping or off-grid punch-ins', () => {
  assert.throws(() => validateEdit({ ...input([{ track: 'v1', path: '/a' }]), captions: { style: 'clean', position: 'bottom', size: 'm' } }));
  assert.throws(() => validateEdit({ ...input([{ track: 'v1', path: '/a' }]), remove_silences: { sensitivity: 'normal', shortest_pause: 0.4 } }));
  for (const rows of [[{ at: 0, length: 0.51, zoom: 125 }], [{ at: 0, length: 1, zoom: 125 }, { at: 0.5, length: 1, zoom: 110 }], [{ at: 0, length: 1, zoom: 120 }]]) assert.throws(() => mapClips(input([{ track: 'v1', path: '/a', punch_ins: rows }]), [video(3)]));
});
test('document mapping retains local media and transcript corrections preserve source times', () => {
  const media = [{ id: 'media-0', kind: 'video', source: { file: {}, url: 'blob:local', ...video(3) }, poster: '', hasAudio: true }];
  const document = editDocument(input([{ track: 'v1', path: '/a' }]), media);
  assert.equal(document.media, media); assert.equal(document.clips[0].mediaId, media[0].id);
  const words = [{ id: '0', text: 'John', start: 0, end: 0.3 }, { id: '1', text: 'Smith', start: 0.3, end: 1 }, { id: '2', text: 'speaks', start: 1, end: 2 }];
  const corrected = correctTranscript(words, [{ from: 'john smith', to: 'Jane Doe' }]);
  assert.deepEqual(corrected.map(word => word.text), ['Jane', 'Doe', 'speaks']);
  assert.equal(corrected[0].start, 0); assert.equal(corrected[1].end, 1); assert.equal(corrected[2], words[2]);
});

test('Studio accepts every caption style and rejects unknown styles', () => {
  for (const style of ['clean', 'boxed', 'minimal', 'karaoke', 'bold-keyword', 'word-pop', 'highlight-box', 'neon', 'pop-up', 'typewriter', 'outline', 'editorial', 'gradient']) {
    const request = { ...input([{ track: 'v1', path: '/speech.mp4' }]), captions: { style, position: 'lower', size: 'm' } };
    assert.doesNotThrow(() => validateEdit(request));
    assert.deepEqual(editDocument(request, [{ id: 'media-0', kind: 'video', source: { ...video(2), file: new File([], 'speech.mp4'), url: 'blob:speech' }, poster: '', hasAudio: true }]).captions, request.captions);
  }
  assert.throws(() => validateEdit({ ...input([{ track: 'v1', path: '/speech.mp4' }]), captions: { style: 'unknown', position: 'lower', size: 'm' } }));
});

test('explicit tracks canonicalize V2 without changing V1 transitions or media ids', () => {
  const clips = mapClips({ ...input([
    { path: '/reference-late.mp4', track: 'v2', start: 4 },
    { path: '/a.mp4', track: 'v1' },
    { path: '/reference-early.png', track: 'v2', start: 0, out: 4, place: { mode: 'top' } },
    { path: '/b.mp4', track: 'v1' },
  ]), transitions: [{ after_clip: 1, type: 'crossfade', duration: 0.4 }] }, [video(2), video(2), { kind: 'photo', duration: 3, width: 800, height: 600 }, video(3)]);
  assert.deepEqual(clips.map(clip => [clip.id, clip.mediaId]), [['clip-1', 'media-1'], ['clip-3', 'media-3'], ['clip-2', 'media-2'], ['clip-0', 'media-0']]);
  assert.deepEqual(clips[0].transition, { type: 'crossfade', duration: 0.4, to: 'clip-3' });
  for (const clip of clips.slice(0, 2)) {
    assert.equal(Object.hasOwn(clip, 'start'), false);
    assert.deepEqual(clip.crop, { top: 0, right: 0, bottom: 0, left: 0 });
    assert.deepEqual(clip.place, { mode: 'full' });
  }
  assert.notEqual(clips[0].crop, clips[1].crop);
  assert.equal(clips[2].kind, 'photo');
  assert.deepEqual(clips[2].place, { mode: 'top' });
});

test('track, spatial, trim and schedule errors identify request fields before enqueue', () => {
  const check = (clips, field, extra = {}, sources = clips.map(() => video(3))) => assert.throws(() => mapClips({ ...input(clips), ...extra }, sources), error => error.details.field === field);
  for (const track of [undefined, null, 'v3']) check([{ path: '/a', track }], 'clips.0.track');
  for (const start of [undefined, null, -1, NaN, Infinity, '0']) check([{ path: '/a', track: 'v2', start }], 'clips.0.start');
  for (const start of [0, undefined]) check([{ path: '/a', track: 'v1', start }], 'clips.0.start');
  for (const crop of [null, {}, { top: 0, right: 0, bottom: 0, left: 0, extra: 1 }, { top: NaN, right: 0, bottom: 0, left: 0 }, { top: 0, right: 96, bottom: 0, left: 0 }, { top: 50, right: 0, bottom: 46, left: 0 }, { top: 0, right: 50, bottom: 0, left: 46 }]) check([{ path: '/a', track: 'v1', crop }], 'clips.0.crop');
  for (const place of [null, { mode: 'middle' }, { mode: 'top', x: 0 }, { mode: 'custom', x: 0, y: 0, width: 0.04, height: 1 }, { mode: 'custom', x: 0.5, y: 0, width: 0.6, height: 1 }, { mode: 'custom', x: -0.1, y: 0, width: 1, height: 1 }, { mode: 'custom', x: 0, y: 0, width: 1, height: Infinity }]) check([{ path: '/a', track: 'v1', place }], 'clips.0.place');
  check([{ path: '/a', track: 'v2', start: 1 }, { path: '/b', track: 'v2', start: 0 }], 'clips.0.start');
  check([{ path: '/a', track: 'v2', start: 178 }], 'clips');
  check([{ path: '/a', track: 'v1', out: 4 }], 'clips.0');
  const clips = [{ path: '/a', track: 'v1' }, { path: '/ref', track: 'v2', start: 0 }, { path: '/b', track: 'v1' }];
  for (const after_clip of [1, 2, -1, 0.5]) check(clips, 'transitions.0.after_clip', { transitions: [{ after_clip, type: 'dip', duration: 0.4 }] });
  check(clips, 'transitions.1.after_clip', { transitions: [0, 0].map(after_clip => ({ after_clip, type: 'dip', duration: 0.4 })) });
});

test('crop and placement share geometry bounds and V2 alone can extend the output', () => {
  const clip = mapClips(input([{ path: '/a', track: 'v2', start: 177, pan_x: 0, pan_y: 1, crop: { top: 10.01, right: 5, bottom: 0, left: 5 }, place: { mode: 'custom', x: 0, y: 0, width: 0.5, height: 0.5 } }]), [video(3)])[0];
  assert.equal(clip.start, 177);
  assert.equal(clip.crop.top, 10.01);
  assert.ok(clip.settings.centerX > 0 && clip.settings.centerY < 1);
  for (const mode of ['full', 'top', 'bottom', 'left', 'right', 'pip-top-left', 'pip-top-right', 'pip-bottom-left', 'pip-bottom-right']) assert.doesNotThrow(() => validateEdit(input([{ path: '/a', track: 'v1', place: { mode } }])));
});

test('browser silence rejection stops export; successful transition repair returns a warning', { timeout: 120_000 }, async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { assetRoutes, studioBrowser } = await import('../dist/studio-browser.js');
  const directory = await mkdtemp(join(tmpdir(), 'modisign-silence-rejection-'));
  let runner;
  try {
    const media = join(directory, 's.mp4');
    await promisify(execFile)('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=24:d=2', '-f', 'lavfi', '-i', 'aevalsrc=if(lt(t\\,0.6)+gte(t\\,1.4)\\,0.5*sin(2*PI*440*t)\\,0):s=48000:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', media]);
    const routes = await assetRoutes(); routes.set('/media/0', media);
    runner = await studioBrowser(routes, new AbortController().signal, () => {});
    let writes = 0;
    await runner.page.exposeFunction('studioProgress', () => {});
    await runner.page.exposeFunction('studioWrite', () => { writes++; });
    const source = { url: '/media/0', name: 's.mp4', type: 'video/mp4', kind: 'video' };
    const request = clips => ({ input: { ...input(clips), remove_silences: { sensitivity: 'normal', shortest_pause: 0.5 }, quality: '720p' }, media: clips.map(() => source), overlays: [], transcriptOnly: false });
    const overflow = request(Array.from({ length: 300 }, (_, index) => ({ track: 'v1', path: media, out: index === 0 ? 2 : 0.5 })));
    assert.deepEqual(await runner.page.evaluate(request => window.runStudio(request), overflow), { error: 'Projects can have at most 300 clips.', details: {} });
    assert.equal(writes, 0, 'Rejected edit wrote export bytes');
    const repaired = request([{ track: 'v1', path: media, out: 1.6 }, { track: 'v1', path: media, out: 0.5 }]);
    repaired.input.transitions = [{ after_clip: 0, type: 'crossfade', duration: 0.2 }];
    const result = await runner.page.evaluate(request => window.runStudio(request), repaired);
    assert.deepEqual(result.warnings, ['Transition removed: clip too short']);
    assert.ok(result.duration < 2.1); assert.ok(writes > 0);
    writes = 0;
    const synchronized = request([{ path: media, track: 'v1' }, { path: media, track: 'v2', start: 0, mute: true, place: { mode: 'top' } }]);
    const aligned = await runner.page.evaluate(request => window.runStudio(request), synchronized);
    assert.ok(aligned.duration < 2 && aligned.duration > 1.2);
    assert.deepEqual(aligned.warnings, []);
    assert.ok(writes > 0);
    writes = 0;
    const conflict = request([{ path: media, track: 'v1', out: 1.2 }, { path: media, track: 'v2', start: 0 }, { path: media, track: 'v1', in: 0, out: 1 }]);
    conflict.input.transitions = [{ after_clip: 0, type: 'crossfade', duration: 0.4 }];
    assert.deepEqual(await runner.page.evaluate(request => window.runStudio(request), conflict), { error: 'Remove the V1 transition after “s.mp4” before removing these silences.', details: {} });
    assert.equal(writes, 0, 'Transition conflict wrote export bytes');
    const rapid = (trim, frames) => ({ input: { ...input(Array.from({ length: 5 }, () => ({ track: 'v1', path: media, out: trim }))), quality: '720p', rapid_intro: { clips: [0, 1, 2, 3, 4], frames_per_clip: frames, timestamp: 'source', labels: ['a', 'b', 'c', 'd', 'e'].map((text, clip) => ({ clip, text })) },
      texts: [{ text: 'Title', start: 0, duration: 1 }] }, media: Array.from({ length: 5 }, () => source), overlays: [], transcriptOnly: false });
    writes = 0;
    assert.deepEqual(await runner.page.evaluate(request => window.runStudio(request), rapid(0.1, 5)), { error: 'Rapid intro was not built: “s.mp4” is shorter than 5 frames. Choose a shorter teaser.', details: { field: 'rapid_intro' } });
    assert.equal(writes, 0, 'Refused rapid intro wrote export bytes');
    const intro = await runner.page.evaluate(request => window.runStudio(request), rapid(0.5, 5));
    assert.ok(Math.abs(intro.duration - (2.5 + 25 / 30)) < 1e-6, `body plus five five-frame teasers, got ${intro.duration}`);
    assert.ok(writes > 0);
    // The opening pause of every chosen clip is removed first; the intro still finds each clip's surviving first fragment.
    const paused = request(Array.from({ length: 5 }, () => ({ track: 'v1', path: media, in: 0.6, out: 2 })));
    paused.input.rapid_intro = rapid(0.5, 5).input.rapid_intro;
    writes = 0;
    const afterPause = await runner.page.evaluate(request => window.runStudio(request), paused);
    assert.equal(afterPause.error, undefined, JSON.stringify(afterPause));
    assert.ok(afterPause.duration > 25 / 30 + 3 && afterPause.duration < 25 / 30 + 5 * 1.4, `five trimmed clips plus the teasers, got ${afterPause.duration}`);
    assert.ok(writes > 0);
  } finally {
    if (runner !== undefined) await runner.close();
    await rm(directory, { recursive: true, force: true });
  }
});

const speechMedia = (count = 1) => Array.from({ length: count }, (_, index) => ({ id: `media-${index}`, kind: 'video', source: { ...video(4), file: new File([], 'speech.mp4'), url: 'blob:speech' }, poster: '', hasAudio: true }));
test('mixed captions take the default or an explicit recipe and never leak into other styles', () => {
  const request = captions => ({ ...input([{ track: 'v1', path: '/speech.mp4' }]), captions: { position: 'lower', size: 'm', ...captions } });
  const placement = { position: 'lower', size: 'm' };
  const rows = [
    [{ style: 'mixed' }, { style: 'mixed', ...placement, mix: { preset: 'creator', seed: 58, palette: ['#FFF4DC', '#FFD60A', '#FF5FA2'] } }],
    [{ style: 'mixed', mix: { preset: 'editorial' } }, { style: 'mixed', ...placement, mix: { preset: 'editorial', seed: 58, palette: ['#FAF3E0', '#F2C14E', '#FF7B6B'] } }],
    [{ style: 'mixed', mix: { preset: 'creator', seed: 4294967295, palette: ['#ffffff', '#000000'] } }, { style: 'mixed', ...placement, mix: { preset: 'creator', seed: 4294967295, palette: ['#ffffff', '#000000'] } }],
    [{ style: 'clean' }, { style: 'clean', ...placement }],
  ];
  for (const [captions, expected] of rows) {
    assert.doesNotThrow(() => validateEdit(request(captions)));
    assert.deepEqual(editDocument(request(captions), speechMedia()).captions, expected);
  }
});

test('malformed mixes and word-style selectors name the failing field before any media or job', () => {
  const clips = [{ track: 'v1', path: '/speech.mp4' }, { track: 'v2', start: 0, path: '/reference.mp4' }];
  const word = (appearance, extra = {}) => ({ clip: 0, from: 0, to: 1, appearance, ...extra });
  const rows = [
    [{ style: 'clean', mix: { preset: 'creator' } }, 'captions.mix'],
    [{ style: 'mixed', mix: {} }, 'captions.mix.preset'],
    [{ style: 'mixed', mix: { preset: 'poster' } }, 'captions.mix.preset'],
    [{ style: 'mixed', mix: { preset: 'creator', seed: -1 } }, 'captions.mix'],
    [{ style: 'mixed', mix: { preset: 'creator', seed: 1.5 } }, 'captions.mix'],
    [{ style: 'mixed', mix: { preset: 'creator', palette: ['#ffffff'] } }, 'captions.mix'],
    [{ style: 'mixed', mix: { preset: 'creator', palette: ['#ffffff', 'cream'] } }, 'captions.mix'],
    [{ style: 'mixed', mix: { preset: 'creator', extra: 1 } }, 'captions.mix'],
    [{ style: 'clean', word_styles: [word({ weight: 800 })] }, 'captions.word_styles.0.appearance'],
    [{ style: 'clean', word_styles: [word({ font: 'sans', weight: 600 })] }, 'captions.word_styles.0.appearance'],
    [{ style: 'clean', word_styles: [word({ font: 'mono', italic: true })] }, 'captions.word_styles.0.appearance'],
    [{ style: 'clean', word_styles: [word({ tracking: 0.31 })] }, 'captions.word_styles.0.appearance'],
    [{ style: 'clean', word_styles: [word({ fill: 'red' })] }, 'captions.word_styles.0.appearance'],
    [{ style: 'clean', word_styles: [word({})] }, 'captions.word_styles.0.appearance'],
    [{ style: 'clean', word_styles: [word({ underline: true, css: 'x' })] }, 'captions.word_styles.0.appearance'],
    [{ style: 'clean', word_styles: [word({ underline: true }), word({ underline: true }, { clip: 1 })] }, 'captions.word_styles.1.clip'],
    [{ style: 'clean', word_styles: [word({ underline: true }, { clip: 2 })] }, 'captions.word_styles.0.clip'],
    [{ style: 'clean', word_styles: [word({ underline: true }, { clip: 0.5 })] }, 'captions.word_styles.0.clip'],
    [{ style: 'clean', word_styles: [word({ underline: true }, { from: 1, to: 1 })] }, 'captions.word_styles.0'],
    [{ style: 'clean', word_styles: [word({ underline: true }, { from: -1 })] }, 'captions.word_styles.0'],
    [{ style: 'clean', word_styles: [word({ underline: true }, { to: 181 })] }, 'captions.word_styles.0'],
    [{ style: 'clean', word_styles: [word({ underline: true }, { other: 1 })] }, 'captions.word_styles.0'],
    [{ style: 'clean', word_styles: Array.from({ length: 101 }, () => word({ underline: true })) }, 'captions.word_styles'],
  ];
  for (const [captions, field] of rows) assert.throws(() => validateEdit({ ...input(clips), captions: { position: 'lower', size: 'm', ...captions } }), error => error.details.field === field, JSON.stringify(captions).slice(0, 120));
  const valid = [{ underline: true }, { font: 'serif', weight: 400, italic: true }, { font: 'mono', weight: 700, fill: '#FFD60A', tracking: -0.08, leading: 2 }, { highlight: false }, { highlight: '#000000', underline: false }, { font: 'sans', weight: 900, tracking: 0.3, leading: 1 }];
  for (const appearance of valid) assert.doesNotThrow(() => validateEdit({ ...input(clips), captions: { style: 'clean', position: 'lower', size: 'm', word_styles: [word(appearance)] } }), JSON.stringify(appearance));
});

test('word styles resolve by source-second midpoint inside the clip trim, after corrections, and fail loudly when nothing matches', () => {
  const words = [['one', 0, 0.6], ['two', 0.6, 1.2], ['three', 1.2, 1.8], ['four', 1.8, 2.4], ['five', 2.4, 3]].map(([text, start, end], index) => ({ id: `w${index}`, text, start, end }));
  const document = (clips = [{ track: 'v1', path: '/speech.mp4' }]) => {
    const state = editDocument({ ...input(clips), captions: { style: 'clean', position: 'lower', size: 'm' } }, speechMedia(clips.length));
    state.transcripts['media-0'] = correctTranscript(words, [{ from: 'two three', to: 'twenty three' }]);
    return state;
  };
  const styled = (state, selectors) => applyWordStyles(state, selectors).wordStyles;
  const selector = (from, to, appearance, clip = 0) => ({ clip, from, to, appearance });
  // Midpoints: one 0.3, two 0.75 (corrected tokens split 0.6–1.8), so 0.7–1.3 reaches the corrected words only.
  assert.deepEqual(styled(document(), [selector(0, 0.5, { underline: true })]), { 'media-0': { w0: { underline: true } } });
  assert.deepEqual(Object.keys(styled(document(), [selector(0.6, 1.8, { fill: '#FFD60A' })])['media-0']), ['w1', 'w2']);
  assert.deepEqual(styled(document(), [selector(0, 3, { underline: true }), selector(2.4, 3, { font: 'mono', weight: 700 })])['media-0'].w4, { underline: true, font: 'mono', weight: 700 }, 'later selectors merge over earlier ones');
  // A trimmed clip only styles the words it plays.
  const trimmed = document([{ track: 'v1', path: '/speech.mp4', in: 1.8, out: 3 }]);
  assert.deepEqual(Object.keys(styled(trimmed, [selector(0, 4, { underline: true })])['media-0']), ['w3', 'w4'], 'words outside the trim are not styled');
  for (const [state, selectors, field] of [
    [document(), [selector(3.5, 4, { underline: true })], 'captions.word_styles.0'],
    [trimmed, [selector(0, 1.7, { underline: true })], 'captions.word_styles.0'],
    [document(), [selector(0, 1, { underline: true }), selector(3.5, 4, { underline: true })], 'captions.word_styles.1'],
    [document([{ track: 'v1', path: '/speech.mp4' }, { track: 'v2', start: 0, path: '/reference.mp4' }]), [selector(0, 1, { underline: true }, 1)], 'captions.word_styles.0.clip'],
    [document(), [selector(0, 1, { underline: true }, 7)], 'captions.word_styles.0.clip'],
  ]) assert.throws(() => applyWordStyles(state, selectors), error => error.details.field === field);
  const photo = editDocument({ ...input([{ track: 'v1', path: '/a.png' }]), captions: { style: 'clean', position: 'lower', size: 'm' } }, [{ id: 'media-0', kind: 'photo', source: { width: 100, height: 100 }, poster: '', hasAudio: false }]);
  assert.throws(() => applyWordStyles(photo, [selector(0, 1, { underline: true })]), error => error.details.field === 'captions.word_styles.0.clip');
});

test('overlapping selectors are classified by their merged result, exactly as Studio merges them', () => {
  const words = [['one', 0, 1], ['two', 1, 2], ['three', 2, 3]].map(([text, start, end], index) => ({ id: `w${index}`, text, start, end }));
  const state = () => { const document = editDocument({ ...input([{ track: 'v1', path: '/speech.mp4' }]), captions: { style: 'clean', position: 'lower', size: 'm' } }, speechMedia()); document.transcripts['media-0'] = words; return document; };
  const select = (from, to, appearance, clip = 0) => ({ clip, from, to, appearance });
  const rows = [
    [[select(0, 3, { underline: true }), select(0, 3, { underline: false })], false],
    [[select(0, 3, { highlight: '#FFD60A' }), select(0, 3, { highlight: false })], false],
    [[select(0, 3, { underline: false })], false],
    [[select(0, 3, { underline: false }), select(0, 3, { underline: true })], true],
    [[select(0, 3, { underline: true }), select(1, 3, { underline: false })], true],
    [[select(0, 3, { underline: true }), select(0, 3, { underline: false }), select(1, 2, { fill: '#FFFFFF' })], true],
    [[select(0, 1, { underline: true }), select(1, 3, { underline: false })], true],
    [[select(0, 3, { underline: true }), select(0, 3, { underline: false, fill: '#FFFFFF' })], true],
  ];
  for (const [selectors, customized] of rows) {
    assert.equal(selectorsCustomized(selectors), customized, JSON.stringify(selectors));
    const looks = Object.values(applyWordStyles(state(), selectors).wordStyles['media-0'] ?? {});
    assert.equal(looks.some(look => Object.values(look).some(value => value !== false)), customized, `Studio agrees: ${JSON.stringify(selectors)}`);
  }
});
