import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    assert.deepEqual(Object.keys(edit.inputSchema.properties.texts.items.properties).sort(), ['backing', 'clip', 'duration', 'fill', 'font', 'italic', 'size', 'start', 'text', 'timestamp', 'weight', 'x', 'y']);
    assert.deepEqual(edit.inputSchema.properties.texts.items.properties.timestamp.enum, ['source', 'timeline']);
    const rapid = edit.inputSchema.properties.rapid_intro;
    assert.deepEqual(Object.keys(rapid.properties).sort(), ['clips', 'frames_per_clip', 'labels', 'mute_teasers', 'timestamp']);
    assert.deepEqual(rapid.required, ['clips', 'labels']);
    assert.deepEqual([rapid.properties.clips.minItems, rapid.properties.clips.maxItems], [5, 7]);
    assert.deepEqual(rapid.properties.frames_per_clip.enum, [3, 4, 5, 6]);
    assert.deepEqual(rapid.properties.timestamp.enum, ['source', 'timeline', 'none']);
    for (const phrase of ['five-frame rapid intro from grind.mp4, pour.mp4, stir.mp4, steam.mp4 and serve.mp4', 'source timestamps', 'Grind beans', 'never looks at pictures', 'never invent them from file names', '3 frames (0.1 seconds)', 'moves later by the intro length']) assert.ok(edit.description.includes(phrase), phrase);
    const five = Array.from({ length: 5 }, (_, index) => ({ path: `/missing-${index}.mp4`, track: 'v1' }));
    const labels = five.map((_, clip) => ({ clip, text: `Step ${clip}` }));
    for (const [extra, field] of [
      [{ texts: [{ text: 'Hi', clip: 0, font: 'comic' }] }, 'font'],
      [{ texts: [{ text: 'Hi', start: 0, duration: 0.09 }] }, 'duration'],
      [{ texts: [{ text: 'Hi', clip: 0, timestamp: 'none' }] }, 'timestamp'],
      [{ rapid_intro: { clips: [0, 1, 2, 3], labels: labels.slice(0, 4) } }, 'clips'],
      [{ rapid_intro: { clips: [0, 1, 2, 3, 4], labels: labels.slice(1) } }, 'labels'],
      [{ rapid_intro: { clips: [0, 1, 2, 3, 4], labels, frames_per_clip: 7 } }, 'frames_per_clip'],
      [{ rapid_intro: { clips: [0, 1, 2, 3, 4], labels, timestamp: 'output' } }, 'timestamp'],
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
