import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import { personModelSource, personRuntimeScript, studioWebRoot } from '../scripts/studio-assets.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const terminal = state => ['done', 'failed', 'canceled'].includes(state);
const frame = async path => (await run('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer', maxBuffer: 64 * 2 ** 20 })).stdout;

// The shipped probe picture (a public-domain NASA frame with a known person region) is a real person photo: the title behind people must leave the person's pixels as they are and keep the title elsewhere.
test('a title behind people renders from the shipped people model, keeps the person in front and reports its stages', { timeout: 180_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'modisign-studio-person-'));
  process.env.MODISIGN_CONFIG_DIR = join(directory, 'config');
  delete process.env.MODISIGN_NO_TELEMETRY;
  const { personManifest } = await import(pathToFileURL(personRuntimeScript(root)).href);
  const { probe } = await personManifest(studioWebRoot(root));
  const photo = join(directory, 'person.png');
  await copyFile(join(personModelSource(root), probe.file), photo);
  const { Jobs } = await import('../dist/jobs.js');
  const jobs = new Jobs();
  const authorizations = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname;
    if (path === '/api/mcp/authorize') { authorizations.push(JSON.parse(options.body)); return Response.json({ v: 1, allowed: true, tier: 'pro' }); }
    assert.equal(path, '/api/activity');
    return Response.json({ ok: true });
  });
  const title = { text: 'MODISIGN', start: 0, duration: 1, size: 'xl', fill: '#ff2d55', y: 0.5 };
  const render = async (name, texts) => {
    const seen = new Set();
    const job = await jobs.start({ kind: 'studio', aspect: '1x1', quality: '720p', clips: [{ path: photo, track: 'v1', out: 1 }], texts, output_path: join(directory, name) });
    for (let result = jobs.status(job.job_id); !terminal(result.state); result = jobs.status(job.job_id)) { seen.add(result.state); await delay(5); }
    const result = jobs.status(job.job_id);
    assert.equal(result.state, 'done', JSON.stringify(result.error));
    return { path: result.artifact.path, seen };
  };
  try {
    const plain = await render('plain.mp4', []);
    const front = await render('front.mp4', [title]);
    const behind = await render('behind.mp4', [{ ...title, occlusion: { clip: 0, feather: 0 } }]);
    assert.equal(plain.seen.has('preparing_people_model') || plain.seen.has('preparing_people_masks'), false, 'a request without a person title never prepares people');
    assert.ok(behind.seen.has('preparing_people_model') || behind.seen.has('preparing_people_masks'), `stages reach job_status: ${[...behind.seen]}`);
    assert.deepEqual(authorizations.map(body => body.titleEffects), [false, false, false, false, true, true]);
    const [base, over, under] = await Promise.all([plain, front, behind].map(item => frame(item.path)));
    const size = Math.sqrt(base.length / 3);
    assert.equal(size * size * 3, base.length);
    const mean = (a, b, area) => {
      let total = 0; let count = 0;
      for (let y = Math.floor(area.y * size); y < Math.ceil((area.y + area.height) * size); y++) {
        for (let x = Math.floor(area.x * size); x < Math.ceil((area.x + area.width) * size); x++) for (let c = 0; c < 3; c++) { total += Math.abs(a[(y * size + x) * 3 + c] - b[(y * size + x) * 3 + c]); count++; }
      }
      return total / count;
    };
    const person = { x: probe.person.x / 256, y: probe.person.y / 256, width: probe.person.width / 256, height: probe.person.height / 256 };
    const corner = { x: 0.02, y: 0.02, width: 0.2, height: 0.2 };
    const band = { x: 0.1, y: 0.45, width: 0.2, height: 0.1 };
    const measured = { covered: mean(base, over, person), behind: mean(base, under, person), away: mean(base, under, band), cornerFront: mean(over, under, corner), cornerBase: mean(base, under, corner) };
    t.diagnostic(JSON.stringify(measured));
    assert.ok(measured.covered > 15, 'a title in front covers the person region');
    assert.ok(measured.behind < measured.covered / 3, 'behind people the person region keeps its own pixels');
    assert.ok(measured.away > 15, 'the title still shows away from the person');
    assert.ok(measured.cornerFront < 3 && measured.cornerBase < 3, 'untouched areas are identical');
  } finally {
    await jobs.close();
    await rm(directory, { recursive: true, force: true });
  }
});
