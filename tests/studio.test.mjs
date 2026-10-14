import assert from 'node:assert/strict';
import test from 'node:test';
import { mapClips, validateEdit, editDocument, correctTranscript } from '../dist/studio-request.js';

const video = duration => ({ kind: 'video', duration, width: 1920, height: 1080 });
const input = clips => ({ clips, aspect: '9x16' });
test('Studio mapping preserves trims, settings and source punch-ins and clamps crossfades', () => {
  const request = { ...input([{ path: '/a.mp4', in: 1, out: 2, zoom: 2, pan_x: 0, volume: 0.5, fade_out: 0.8, punch_ins: [{ at: 1.2, length: 0.5, zoom: 125 }] }, { path: '/b.mp4', out: 1 }]), transitions: [{ after_clip: 0, type: 'crossfade', duration: 1 }] };
  const clips = mapClips(request, [video(4), video(4)]);
  assert.equal(clips[0].inPoint, 1);
  assert.equal(clips[0].settings.volume, 0.5);
  assert.equal(clips[0].settings.fadeOut, 0.8);
  assert.ok(clips[0].settings.centerX > 0);
  assert.deepEqual(clips[0].punchIns, [{ start: 1.2, length: 0.5, zoom: 1.25 }]);
  assert.deepEqual(clips[0].transition, { type: 'crossfade', duration: 0.45, to: clips[1].id });
});
test('Studio validates post-overlap length, counts, source bounds and transition adjacency', () => {
  assert.equal(mapClips({ ...input([{ path: '/a' }, { path: '/b' }]), transitions: [{ after_clip: 0, type: 'crossfade', duration: 0.6 }] }, [video(90.3), video(90.3)]).length, 2);
  assert.throws(() => mapClips(input([{ path: '/a' }, { path: '/b' }]), [video(100), video(81)]));
  assert.throws(() => mapClips(input([{ path: '/a', out: 3 }]), [video(2)]));
  assert.throws(() => mapClips(input([{ path: '/a', in: 1, out: 1.1 }]), [video(2)]));
  assert.throws(() => validateEdit(input(Array.from({ length: 301 }, () => ({ path: '/a' })))));
  assert.throws(() => mapClips({ ...input([{ path: '/a' }]), transitions: [{ after_clip: 0, type: 'dip', duration: 0.4 }] }, [video(2)]));
});
test('Studio photo duration, virtual timing and audio constraints share Studio validation', () => {
  const photo = { kind: 'photo', duration: 3, width: 100, height: 100 };
  const clip = mapClips(input([{ path: '/a.png', in: 1, out: 5, fit: 'fit', slow_zoom: true }]), [photo])[0];
  assert.equal(clip.duration, 4); assert.equal(clip.sourceStart, 1); assert.equal(clip.inPoint, 0);
  assert.equal(clip.settings.slowZoom, true);
  assert.throws(() => mapClips(input([{ path: '/a.png', out: 31 }]), [photo]));
  assert.throws(() => mapClips(input([{ path: '/a.png', volume: 1 }]), [photo]));
  assert.throws(() => mapClips(input([{ path: '/a.mp4', slow_zoom: true }]), [video(2)]));
});
test('Studio rejects malformed caption/silence requests and overlapping or off-grid punch-ins', () => {
  assert.throws(() => validateEdit({ ...input([{ path: '/a' }]), captions: { style: 'clean', position: 'bottom', size: 'm' } }));
  assert.throws(() => validateEdit({ ...input([{ path: '/a' }]), remove_silences: { sensitivity: 'normal', shortest_pause: 0.4 } }));
  for (const rows of [[{ at: 0, length: 0.51, zoom: 125 }], [{ at: 0, length: 1, zoom: 125 }, { at: 0.5, length: 1, zoom: 110 }], [{ at: 0, length: 1, zoom: 120 }]]) assert.throws(() => mapClips(input([{ path: '/a', punch_ins: rows }]), [video(3)]));
});
test('document mapping retains local media and transcript corrections preserve source times', () => {
  const media = [{ id: 'media-0', kind: 'video', source: { file: {}, url: 'blob:local', ...video(3) }, poster: '', filmstrip: [], waveform: null, silenceLevels: null }];
  const document = editDocument(input([{ path: '/a' }]), media);
  assert.equal(document.media, media); assert.equal(document.clips[0].mediaId, media[0].id);
  const words = [{ id: '0', text: 'John', start: 0, end: 0.3 }, { id: '1', text: 'Smith', start: 0.3, end: 1 }, { id: '2', text: 'speaks', start: 1, end: 2 }];
  const corrected = correctTranscript(words, [{ from: 'john smith', to: 'Jane Doe' }]);
  assert.deepEqual(corrected.map(word => word.text), ['Jane', 'Doe', 'speaks']);
  assert.equal(corrected[0].start, 0); assert.equal(corrected[1].end, 1); assert.equal(corrected[2], words[2]);
});

test('Studio accepts every caption style and rejects unknown styles', () => {
  for (const style of ['clean', 'boxed', 'minimal', 'karaoke', 'bold-keyword', 'word-pop', 'highlight-box', 'neon', 'pop-up', 'typewriter', 'outline', 'editorial', 'gradient']) {
    const request = { ...input([{ path: '/speech.mp4' }]), captions: { style, position: 'lower', size: 'm' } };
    assert.doesNotThrow(() => validateEdit(request));
    assert.deepEqual(editDocument(request, [{ id: 'media-0', kind: 'video', source: { ...video(2), file: new File([], 'speech.mp4'), url: 'blob:speech' }, poster: '', filmstrip: [], waveform: null, silenceLevels: null }]).captions, request.captions);
  }
  assert.throws(() => validateEdit({ ...input([{ path: '/speech.mp4' }]), captions: { style: 'unknown', position: 'lower', size: 'm' } }));
});
