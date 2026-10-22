import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sfxPackSource } from '../scripts/studio-assets.mjs';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

test('stdio advertises explicit tracks and returns field errors without accepting malformed jobs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'modisign-studio-stdio-'));
  const client = new Client({ name: 'studio-contract-test', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/cli.js', import.meta.url))],
      env: { ...process.env, MODISIGN_URL: 'http://localhost:1', MODISIGN_CONFIG_DIR: directory, MODISIGN_NO_TELEMETRY: '1' } }));
    const { tools } = await client.listTools();
    assert.doesNotMatch(JSON.stringify(tools), /HyperFrames|HeyGen|GSAP|esbuild|onnxruntime|Mediabunny|WebCodecs|Chrome Headless Shell|Puppeteer/i);
    const schema = tools.find(tool => tool.name === 'edit_video').inputSchema.properties.clips.items;
    assert.deepEqual(schema.required, ['path', 'track']);
    for (const [clip, field] of [
      [{ path: '/missing.mp4' }, 'track'],
      [{ path: '/missing.mp4', track: 'v2' }, 'start'],
      [{ path: '/missing.mp4', track: 'v2', start: -1 }, 'start'],
      [{ path: '/missing.mp4', track: 'v1', start: 0 }, 'start'],
      [{ path: '/missing.mp4', track: 'v1', crop: { top: 0, right: 50, bottom: 0, left: 50 } }, 'crop'],
      [{ path: '/missing.mp4', track: 'v1', place: { mode: 'custom', x: 0.8, y: 0, width: 0.5, height: 1 } }, 'place'],
      [{ path: '/missing.mp4', track: 'v1', place: { mode: 'top', x: 0 } }, 'place'],
    ]) {
      const result = await client.callTool({ name: 'edit_video', arguments: { clips: [clip], aspect: '9x16' } });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result), new RegExp(field));
      assert.equal(result.structuredContent?.job_id, undefined);
      assert.doesNotMatch(JSON.stringify(result), /Cannot reach Modisign|Media path does not exist/);
    }
    // Mixed captions are discoverable, and every malformed mix or word style fails with its field before any media is read.
    const captions = tools.find(tool => tool.name === 'edit_video').inputSchema.properties.captions;
    assert.deepEqual(Object.keys(captions.properties).sort(), ['corrections', 'mix', 'position', 'size', 'style', 'word_styles']);
    assert.ok(captions.properties.style.enum.includes('mixed'));
    assert.deepEqual(captions.properties.mix.properties.preset.enum, ['creator', 'editorial']);
    assert.deepEqual(captions.properties.mix.required, ['preset']);
    const appearance = captions.properties.word_styles.items.properties.appearance.properties;
    assert.deepEqual(appearance.font.enum, ['sans', 'serif', 'mono']);
    assert.deepEqual([...appearance.weight.enum].sort(), [400, 500, 600, 700, 800, 900]);
    assert.deepEqual(Object.keys(appearance).sort(), ['fill', 'font', 'highlight', 'italic', 'leading', 'tracking', 'underline', 'weight']);
    const placement = { position: 'lower', size: 'm' };
    const word = (extra = {}, appearanceFields = { underline: true }) => ({ clip: 0, from: 0, to: 1, appearance: appearanceFields, ...extra });
    const twoClips = [{ path: '/missing.mp4', track: 'v1' }, { path: '/missing.mp4', track: 'v2', start: 0 }];
    for (const [caption, field, clips = [{ path: '/missing.mp4', track: 'v1' }]] of [
      [{ style: 'clean', ...placement, mix: { preset: 'creator' } }, 'mix'],
      [{ style: 'mixed', ...placement, mix: { preset: 'poster' } }, 'preset'],
      [{ style: 'mixed', ...placement, mix: { preset: 'creator', palette: ['#ffffff'] } }, 'palette'],
      [{ style: 'clean', ...placement, word_styles: [word({}, { weight: 800 })] }, 'appearance'],
      [{ style: 'clean', ...placement, word_styles: [word({}, { font: 'sans', weight: 600 })] }, 'appearance'],
      [{ style: 'clean', ...placement, word_styles: [word({ clip: 1 })] }, 'clip', twoClips],
      [{ style: 'clean', ...placement, word_styles: [word({ from: 1, to: 1 })] }, 'word_styles'],
    ]) {
      const result = await client.callTool({ name: 'edit_video', arguments: { clips, aspect: '9x16', captions: caption } });
      assert.equal(result.isError, true, JSON.stringify(caption));
      assert.match(JSON.stringify(result), new RegExp(field), JSON.stringify(caption));
      assert.equal(result.structuredContent?.job_id, undefined);
      assert.doesNotMatch(JSON.stringify(result), /Cannot reach Modisign|Media path does not exist/);
    }
    // Titles and the rapid intro are discoverable with their documented example, and malformed ones fail by field before any media is read.
    const edit = tools.find(tool => tool.name === 'edit_video');
    assert.deepEqual(Object.keys(edit.inputSchema.properties.texts.items.properties).sort(), ['backing', 'clip', 'duration', 'fill', 'font', 'italic', 'motion', 'occlusion', 'reveal', 'size', 'start', 'text', 'timestamp', 'weight', 'x', 'y']);
    assert.deepEqual(edit.inputSchema.properties.texts.items.properties.timestamp.enum, ['source', 'timeline']);
    const rapid = edit.inputSchema.properties.rapid_intro;
    assert.deepEqual(Object.keys(rapid.properties).sort(), ['clips', 'frames_per_clip', 'labels', 'mute_teasers', 'timestamp']);
    assert.deepEqual(rapid.required, ['clips', 'labels']);
    assert.deepEqual([rapid.properties.clips.minItems, rapid.properties.clips.maxItems], [5, 7]);
    assert.deepEqual(rapid.properties.frames_per_clip.enum, [3, 4, 5, 6]);
    assert.deepEqual(rapid.properties.timestamp.enum, ['source', 'timeline', 'none']);
    for (const phrase of ['five-frame rapid intro from grind.mp4, pour.mp4, stir.mp4, steam.mp4 and serve.mp4', 'source timestamps', 'Grind beans', 'never looks at pictures', 'never invent them from file names', '3 frames (0.1 seconds)', 'moves later by the intro length']) assert.ok(edit.description.includes(phrase), phrase);
    // Motion is discoverable on clips, titles and overlays with one shared row shape, units and bounds, and its time bases and Pro rule are described.
    const layers = { clip: edit.inputSchema.properties.clips.items.properties.motion, title: edit.inputSchema.properties.texts.items.properties.motion, overlay: edit.inputSchema.properties.overlays.items.properties.motion };
    const bounds = { x: [-2, 2], y: [-2, 2], scale: [0.1, 5], rotation: [-3600, 3600], opacity: [0, 1] };
    for (const [layer, motion] of Object.entries(layers)) {
      assert.deepEqual(Object.keys(motion.properties), Object.keys(bounds), layer);
      assert.equal(motion.additionalProperties, false);
      assert.equal(motion.minProperties, 1);
      for (const [channel, [min, max]] of Object.entries(bounds)) {
        const keys = motion.properties[channel];
        assert.deepEqual([keys.minItems, keys.maxItems], [1, 60], `${layer} ${channel}`);
        assert.deepEqual(keys.items.required, ['at', 'value', 'easing']);
        assert.deepEqual([keys.items.properties.value.minimum, keys.items.properties.value.maximum], [min, max], `${layer} ${channel}`);
        // Footage keys may sit on a photo's signed clock, so only the runtime source-kind check narrows them to 0-180.
        assert.deepEqual([keys.items.properties.at.minimum, keys.items.properties.at.maximum], layer === 'clip' ? [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER] : [0, 180], layer);
        assert.deepEqual(keys.items.properties.easing.oneOf[0].enum, ['hold', 'linear', 'ease-in', 'ease-out', 'ease-in-out']);
        assert.deepEqual(keys.items.properties.easing.oneOf[1], { type: 'array', minItems: 4, maxItems: 4, items: { type: 'number', minimum: 0, maximum: 1 } });
      }
    }
    const without = (motion) => JSON.stringify(motion.properties, (key, value) => key === 'at' ? undefined : value);
    assert.equal(without(layers.clip), without(layers.title));
    assert.match(layers.clip.description, /source seconds of this clip/);
    assert.match(layers.title.description, /local seconds from this title's own start/);
    assert.match(layers.overlay.description, /local seconds from this overlay's own start.*needs Pro/);
    for (const phrase of ["On the first clip, smoothly zoom from 100% at source 0s to 120% at 2s, then slide 15% left by 3s; fade 'Watch this' in over its first half-second, in 9:16", 'zoom is static inner framing; motion.scale is outer motion', 'source seconds for footage', 'local seconds from its own start for titles and overlays', 'Footage and title motion are free', 'non-identity motion key on an overlay, even on a free preset, needs Pro']) assert.ok(edit.description.includes(phrase), phrase);
    // The reveal schema comes from the shared constants and its description carries the wipe semantic and the Pro rule.
    const reveal = edit.inputSchema.properties.texts.items.properties.reveal;
    assert.deepEqual([Object.keys(reveal.properties), reveal.required, reveal.additionalProperties], [['rect', 'direction', 'start', 'duration', 'easing'], [], false]);
    assert.deepEqual(reveal.properties.direction.enum, ['up', 'down', 'left', 'right']);
    assert.deepEqual(Object.keys(reveal.properties.rect.properties), ['x', 'y', 'width', 'height']);
    assert.deepEqual([reveal.properties.rect.properties.x.maximum, reveal.properties.rect.properties.width.minimum], [1, 0.01]);
    assert.deepEqual([reveal.properties.start.minimum, reveal.properties.start.maximum, reveal.properties.duration.minimum, reveal.properties.duration.maximum], [0, 180, 1 / 30, 10]);
    assert.deepEqual(reveal.properties.easing.oneOf[0].enum, ['hold', 'linear', 'ease-in', 'ease-out', 'ease-in-out']);
    assert.match(reveal.description, /rectangular wipe.*stationary text.*needs Pro to export/i);
    for (const phrase of ["Wipe 'Grand opening' in from the left over half a second", 'the texts schema gives each field, default and rule', 'titles with a reveal or behind people, mixed captions']) assert.ok(edit.description.includes(phrase), phrase);
    // The behind-people schema comes from the shared ranges and defaults; the model and phase are not caller fields.
    const occlusion = edit.inputSchema.properties.texts.items.properties.occlusion;
    assert.deepEqual([Object.keys(occlusion.properties), occlusion.required, occlusion.additionalProperties], [['clip', 'threshold', 'feather', 'smoothing'], [], false]);
    assert.deepEqual(['threshold', 'feather', 'smoothing'].map(name => [occlusion.properties[name].minimum, occlusion.properties[name].maximum]), [[0.1, 0.9], [0, 4], [0, 0.5]]);
    assert.deepEqual([occlusion.properties.clip.minimum, occlusion.properties.clip.maximum], [0, 299]);
    assert.match(occlusion.description, /behind the people.*small people model that ships inside the package.*needs Pro to export/i);
    for (const phrase of ["Put the title 'Sunday reset' behind me in this clip from 1 to 4 seconds, near the top, with a soft edge", 'titles with a reveal or behind people']) assert.ok(edit.description.includes(phrase), phrase);
    // A photo's virtual clock is signed and unbounded: the schema accepts it and the request fails only on the missing file, never in SDK validation.
    for (const at of [-12.5, 400]) {
      const signed = await client.callTool({ name: 'edit_video', arguments: { clips: [{ path: '/missing.png', track: 'v1', out: 3, motion: { x: [{ at, value: 0.1, easing: 'linear' }] } }], aspect: '9x16' } });
      assert.equal(signed.isError, true);
      assert.doesNotMatch(JSON.stringify(signed), /Input validation error|motion/, `a photo key at ${at}`);
    }
    const five = Array.from({ length: 5 }, (_, index) => ({ path: `/missing-${index}.mp4`, track: 'v1' }));
    const labels = five.map((_, clip) => ({ clip, text: `Step ${clip}` }));
    for (const [extra, field] of [
      [{ texts: [{ text: 'Hi', clip: 0, font: 'comic' }] }, 'font'],
      [{ texts: [{ text: 'Hi', start: 0, duration: 1 }, { text: 'Hi', start: 0, duration: 1, occlusion: {} }] }, 'texts.1.occlusion.clip'],
      [{ texts: [{ text: 'Hi', start: 0, duration: 1, occlusion: { clip: 9 } }] }, 'texts.0.occlusion.clip'],
      [{ texts: [{ text: 'Hi', clip: 0, occlusion: { clip: 1 } }] }, 'texts.0.occlusion.clip'],
      [{ texts: [{ text: 'Hi', clip: 0, occlusion: { model: 'people-v1' } }] }, 'occlusion'],
      [{ texts: [{ text: 'Hi', start: 0, duration: 0.09 }] }, 'duration'],
      [{ texts: [{ text: 'Hi', clip: 0, timestamp: 'none' }] }, 'timestamp'],
      [{ rapid_intro: { clips: [0, 1, 2, 3], labels: labels.slice(0, 4) } }, 'clips'],
      [{ rapid_intro: { clips: [0, 1, 2, 3, 4], labels: labels.slice(1) } }, 'labels'],
      [{ rapid_intro: { clips: [0, 1, 2, 3, 4], labels, frames_per_clip: 7 } }, 'frames_per_clip'],
      [{ rapid_intro: { clips: [0, 1, 2, 3, 4], labels, timestamp: 'output' } }, 'timestamp'],
      [{ clips: [{ path: '/missing.mp4', track: 'v1', motion: { scale: [{ at: 0, value: 9, easing: 'linear' }] } }] }, 'motion'],
      [{ texts: [{ text: 'Hi', clip: 0, motion: { opacity: [{ at: 0, value: 1, easing: 'bounce' }] } }] }, 'motion'],
      [{ overlays: [{ configuration: '/overlays/hook-title?setup=x', start: 0, motion: { x: [] } }] }, 'motion'],
      [{ texts: [{ text: 'Hi', clip: 0, motion: { opacity: [{ at: 0, value: 1, easing: 'linear' }] }, animationOffset: 1 }] }, 'texts'],
      [{ texts: [{ text: 'Hi', clip: 0, reveal: { rect: { x: 0.6, width: 0.6 } } }] }, 'texts.0.reveal.rect'],
      [{ texts: [{ text: 'Hi', clip: 0, reveal: { direction: 'diagonal' } }] }, 'reveal'],
      [{ texts: [{ text: 'Hi', clip: 0, reveal: { phase: 1 } }] }, 'reveal'],
    ]) {
      const result = await client.callTool({ name: 'edit_video', arguments: { clips: five, aspect: '9x16', ...extra } });
      assert.equal(result.isError, true, JSON.stringify(extra));
      assert.match(JSON.stringify(result), new RegExp(field), JSON.stringify(extra));
      assert.equal(result.structuredContent?.job_id, undefined);
      assert.doesNotMatch(JSON.stringify(result), /Cannot reach Modisign|Media path does not exist/);
    }
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('stdio advertises the sound pack and refuses malformed sounds by field before any media is read', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'modisign-studio-sfx-stdio-'));
  const client = new Client({ name: 'studio-sfx-test', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/cli.js', import.meta.url))],
      env: { ...process.env, MODISIGN_URL: 'http://localhost:1', MODISIGN_CONFIG_DIR: directory, MODISIGN_NO_TELEMETRY: '1' } }));
    const { tools } = await client.listTools();
    assert.equal(tools.length, 11, 'sounds add no twelfth tool');
    assert.doesNotMatch(JSON.stringify(tools), /HyperFrames|HeyGen|GSAP|esbuild|onnxruntime|Mediabunny|WebCodecs|Chrome Headless Shell|Puppeteer/i);
    const manifest = JSON.parse(await readFile(join(sfxPackSource(fileURLToPath(new URL('../', import.meta.url))), 'manifest.json'), 'utf8'));
    const edit = tools.find(tool => tool.name === 'edit_video');
    const sfx = edit.inputSchema.properties.sfx;
    assert.equal(sfx.maxItems, 100);
    assert.deepEqual(sfx.items.required, ['asset']);
    assert.deepEqual(Object.keys(sfx.items.properties).sort(), ['anchor', 'asset', 'fade_in', 'fade_out', 'gain', 'in', 'mute', 'offset', 'out', 'start']);
    assert.deepEqual(sfx.items.properties.asset.enum, manifest.sounds.map(sound => sound.id));
    assert.equal(sfx.items.additionalProperties, false);
    assert.deepEqual(sfx.items.properties.anchor.oneOf.map(row => row.properties.kind.const), ['title-enter', 'transition', 'overlay-cue']);
    assert.deepEqual([sfx.items.properties.offset.minimum, sfx.items.properties.offset.maximum, sfx.items.properties.gain.maximum], [-2, 2, 2]);
    const auto = edit.inputSchema.properties.auto_sfx;
    assert.deepEqual(Object.keys(auto.properties).sort(), ['events', 'intensity', 'seed', 'title_sound']);
    assert.deepEqual(auto.properties.events.items.enum, ['title', 'transition', 'cta-tap']);
    assert.deepEqual(auto.properties.intensity.enum, ['subtle', 'normal']);
    assert.deepEqual(auto.properties.title_sound.enum, ['pop', 'typing', 'sparkle']);
    for (const phrase of [...manifest.sounds.flatMap(sound => [sound.id, sound.name]), 'built-in free sound pack', 'before pause removal and any rapid intro', 'never change their speech volume', 'a missing one is an error naming the field', 'Add a quiet interface click at 1.2 seconds and a bubble pop']) assert.ok(edit.description.includes(phrase), phrase);
    assert.doesNotMatch(JSON.stringify(tools.map(tool => Object.keys(tool.inputSchema.properties))), /audio_path|sound_url|search/);
    const clips = [{ path: '/missing.mp4', track: 'v1' }, { path: '/missing-2.mp4', track: 'v1' }];
    const base = { asset: 'ugc-click-01', start: 1 };
    for (const [extra, field] of [
      [{ sfx: [{ ...base, asset: 'ugc-click-99' }] }, 'asset'], [{ sfx: [{ asset: 'ugc-click-01' }] }, 'sfx'], [{ sfx: [{ ...base, anchor: { kind: 'title-enter', text: 0 } }] }, 'sfx'],
      [{ sfx: [{ ...base, offset: 1 }] }, 'offset'], [{ sfx: [{ ...base, gain: 3 }] }, 'gain'], [{ sfx: [{ ...base, in: 0.08, out: 0.05 }] }, 'sfx'], [{ sfx: [{ ...base, fade_in: 3 }] }, 'fade_in'],
      [{ sfx: [{ ...base, path: '/music.mp3' }] }, 'sfx'], [{ sfx: [{ asset: 'ugc-pop-01', anchor: { kind: 'title-enter', text: 0 } }] }, 'text'],
      [{ sfx: [{ asset: 'ugc-pop-01', anchor: { kind: 'transition', after_clip: 0 } }] }, 'after_clip'], [{ sfx: [{ asset: 'ugc-pop-01', anchor: { kind: 'overlay-cue', overlay: 0, cue: 'tap' } }] }, 'overlay'],
      [{ auto_sfx: { events: ['click'] } }, 'events'], [{ auto_sfx: { intensity: 'loud' } }, 'intensity'], [{ auto_sfx: { audio_path: '/a.mp3' } }, 'auto_sfx'],
    ]) {
      const result = await client.callTool({ name: 'edit_video', arguments: { clips, aspect: '9x16', ...extra } });
      assert.equal(result.isError, true, JSON.stringify(extra));
      assert.match(JSON.stringify(result), new RegExp(field), JSON.stringify(extra));
      assert.equal(result.structuredContent?.job_id, undefined);
      assert.doesNotMatch(JSON.stringify(result), /Cannot reach Modisign|Media path does not exist/);
    }
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
