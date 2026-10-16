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
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
