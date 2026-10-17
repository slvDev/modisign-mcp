import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const field = (id, extra) => ({ id, type: 'string', role: 'content', label: id, default: '', value: '', relevant: true, ...extra });
const preset = { v: 1, family: 'yt-subscribe', preset: 'deep-work-notes', free: false, look: 'purple-on-white', duration: 6, aspects: ['9x16'], looks: [{ id: 'purple-on-white', name: 'Purple on white' }],
  properties: { content: [field('ctaText'), field('channelName', { relevant: false, showWhen: [{ subscribeStyle: ['card', 'milestone'] }] })], style: [], layout: [] } };
const configured = (inactiveEdits) => ({ v: 1, configuration: '/overlays/yt-subscribe?subscriberCount=9999', tier: 'pro', editorUrl: 'https://modisign.app/overlays/yt-subscribe?subscriberCount=9999',
  relevance: { relevant: ['ctaText'], irrelevant: ['channelName', 'subscriberCount'] }, inactiveEdits });

test('stdio get_overlay exposes showWhen/relevant and configure_overlay reports relevance and inactive edits', async () => {
  let inactive = ['subscriberCount'];
  const upstream = createServer((request, response) => {
    const body = request.url.startsWith('/api/mcp/preset') ? preset : request.url === '/api/mcp/configure' ? configured(inactive) : { v: 1 };
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const directory = await mkdtemp(join(tmpdir(), 'modisign-overlay-stdio-'));
  const client = new Client({ name: 'overlay-contract-test', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/cli.js', import.meta.url))],
      env: { ...process.env, MODISIGN_URL: `http://127.0.0.1:${upstream.address().port}`, MODISIGN_CONFIG_DIR: directory, MODISIGN_NO_TELEMETRY: '1' } }));
    const described = await client.callTool({ name: 'get_overlay', arguments: { family: 'yt-subscribe', preset: 'deep-work-notes' } });
    const fields = described.structuredContent.fields;
    assert.deepEqual(fields.map(({ id, relevant }) => [id, relevant]), [['ctaText', true], ['channelName', false]]);
    assert.deepEqual(fields[1].showWhen, [{ subscribeStyle: ['card', 'milestone'] }]);
    assert.equal(fields[0].showWhen, undefined);

    const result = await client.callTool({ name: 'configure_overlay', arguments: { family: 'yt-subscribe', preset: 'deep-work-notes', values: { subscriberCount: 9999 } } });
    assert.deepEqual(result.structuredContent.inactiveEdits, ['subscriberCount']);
    assert.deepEqual(result.structuredContent.relevance, { relevant: ['ctaText'], irrelevant: ['channelName', 'subscriberCount'] });
    assert.match(result.structuredContent.notice, /subscriberCount.*no effect on this render/);
    assert.match(result.content[0].text, /no effect on this render/);

    inactive = [];
    const active = await client.callTool({ name: 'configure_overlay', arguments: { family: 'yt-subscribe', preset: 'deep-work-notes', values: { subscriberCount: 9999, subscribeStyle: 'milestone' } } });
    assert.deepEqual(active.structuredContent.inactiveEdits, []);
    assert.equal('notice' in active.structuredContent, false);
    assert.doesNotMatch(active.content[0].text, /no effect/);
  } finally {
    await client.close();
    upstream.close();
    await rm(directory, { recursive: true, force: true });
  }
});
