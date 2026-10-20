import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import puppeteer from 'puppeteer-core';

const terminal = state => ['done', 'failed', 'canceled'].includes(state);
async function finished(jobs, id) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const result = jobs.status(id);
    if (terminal(result.state)) return result;
    await delay(50);
  }
  throw new Error('Job did not finish');
}

test('two-track jobs preserve authorization privacy, output collisions and stage cancellation', { timeout: 120_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'modisign-studio-jobs-'));
  process.env.MODISIGN_CONFIG_DIR = join(directory, 'config');
  delete process.env.MODISIGN_NO_TELEMETRY;
  delete process.env.DO_NOT_TRACK;
  const { Jobs } = await import('../dist/jobs.js');
  const { getTranscript } = await import('../dist/studio.js');
  const jobs = new Jobs();
  const output = join(directory, 'output');
  await mkdir(output);
  const media = join(directory, 'source.mp4');
  const calls = [];
  let onFetch = null;
  let proAccount = false;
  let onBrowser = null;
  const launch = puppeteer.launch.bind(puppeteer);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname;
    if (onFetch !== null) await onFetch(path, options.signal);
    if (new URL(url).hostname === 'huggingface.co') return new Response('test model');
    if (path === '/api/mcp/authorize') {
      const body = JSON.parse(options.body);
      calls.push({ path, body });
      if (!proAccount && (['karaoke', 'mixed'].includes(body.captionStyle) || body.captionCustomized)) return Response.json({ v: 1, allowed: false, reason: 'pro' });
      return Response.json({ v: 1, allowed: true, tier: 'free' });
    }
    assert.equal(path, '/api/activity');
    calls.push({ path, body: JSON.parse(options.body) });
    return Response.json({ ok: true });
  });
  t.mock.method(puppeteer, 'launch', async options => {
    const browser = await launch(options);
    if (onBrowser !== null) {
      const newPage = browser.newPage.bind(browser);
      browser.newPage = async () => {
        const page = await newPage();
        await onBrowser(page);
        return page;
      };
    }
    return browser;
  });
  const request = (name, extra = {}) => ({ kind: 'studio', aspect: '9x16', quality: '720p', clips: [
    { path: media, track: 'v2', start: 0, mute: true, place: { mode: 'top' }, crop: { top: 0, right: 5, bottom: 0, left: 5 } },
    { path: media, track: 'v1', place: { mode: 'bottom' } },
  ], output_path: join(output, name), ...extra });
  try {
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', media]);
    await t.test('validation abort cannot enqueue or publish', async () => {
      const reached = Promise.withResolvers();
      onFetch = async (_path, signal) => { reached.resolve(); await delay(30_000, undefined, { signal }); };
      const controller = new AbortController();
      const pending = jobs.start(request('validation.mp4'), undefined, controller.signal);
      await reached.promise;
      controller.abort();
      await assert.rejects(pending, { name: 'AbortError' });
      onFetch = null;
      assert.deepEqual(await readdir(output), []);
    });
    // Cancel during speech setup leaves nothing published, for a plain style and for a Pro mixed request with word styles.
    const placement = { position: 'lower', size: 'm' };
    for (const [name, pro, captions] of [['clean', false, { style: 'clean', ...placement }], ['mixed', true, { style: 'mixed', ...placement, mix: { preset: 'creator', seed: 58 }, word_styles: [{ clip: 1, from: 0, to: 1, appearance: { underline: true } }] }]]) {
      await t.test(`${name} model setup cancellation cleans scratch files`, async () => {
        const reached = Promise.withResolvers();
        proAccount = pro;
        onFetch = async (path, signal) => { if (path !== '/api/mcp/authorize') { reached.resolve(); await delay(30_000, undefined, { signal }); } };
        const job = await jobs.start(request(`model-${name}.mp4`, { captions }));
        await reached.promise;
        jobs.cancel(job.job_id);
        assert.equal((await finished(jobs, job.job_id)).state, 'canceled');
        onFetch = null; proAccount = false;
        assert.deepEqual(await readdir(output), []);
      });
    }
    for (const [stage, codec, method] of [['decoder', 'VideoDecoder', 'decode'], ['encoding', 'VideoEncoder', 'encode']]) {
      await t.test(`${stage} cancellation cleans scratch files`, async () => {
        const reached = Promise.withResolvers();
        onBrowser = async page => {
          await page.exposeFunction('cancelAtStage', () => { reached.resolve(); });
          await page.evaluateOnNewDocument((codec, method) => {
            const original = window[codec].prototype[method];
            let first = true;
            window[codec].prototype[method] = function (...args) {
              const result = original.apply(this, args);
              if (first) { first = false; void window.cancelAtStage(); }
              return result;
            };
          }, codec, method);
        };
        const job = await jobs.start(request(`${stage}.mp4`));
        await reached.promise;
        jobs.cancel(job.job_id);
        assert.equal((await finished(jobs, job.job_id)).state, 'canceled');
        onBrowser = null;
        assert.deepEqual(await readdir(output), []);
      });
    }
    await t.test('unexpected export and transcription failures hide runtime internals', async () => {
      onBrowser = async page => {
        await page.evaluateOnNewDocument(() => {
          window.addEventListener('load', () => {
            window.runStudio = async () => { throw new Error('PrivateDecoder failed at /private/source.mp4'); };
          });
        });
      };
      try {
        const job = await jobs.start(request('failed.mp4'));
        const result = await finished(jobs, job.job_id);
        assert.equal(result.state, 'failed');
        assert.deepEqual(result.error, { error: 'Studio export failed.' });
        await assert.rejects(getTranscript({ path: media }, new AbortController().signal), { message: 'Transcription failed.' });
        assert.deepEqual(await readdir(output), []);
      } finally { onBrowser = null; }
    });
    await t.test('success preserves existing files and sends only the established payloads', async () => {
      const first = await jobs.start(request('success.mp4'));
      const result = await finished(jobs, first.job_id);
      assert.equal(result.state, 'done', JSON.stringify(result.error));
      const bytes = await readFile(result.artifact.path);
      const second = await jobs.start(request('success.mp4'));
      const collision = await finished(jobs, second.job_id);
      assert.equal(collision.state, 'done', JSON.stringify(collision.error));
      assert.equal(basename(collision.artifact.path), 'success-2.mp4');
      assert.deepEqual(await readFile(result.artifact.path), bytes);
      // Expressive styles, the mix and any word styling over a free style are all Pro, decided by the same summary.
      const placement = { position: 'lower', size: 'm' };
      for (const captions of [{ style: 'karaoke', ...placement }, { style: 'mixed', ...placement }, { style: 'mixed', ...placement, mix: { preset: 'editorial', seed: 3 } }, { style: 'clean', ...placement, word_styles: [{ clip: 1, from: 0, to: 1, appearance: { underline: true } }] }]) {
        await assert.rejects(jobs.start(request('pro.mp4', { captions })), /needs Pro/, JSON.stringify(captions));
      }
      for (const call of calls) {
        if (call.path === '/api/mcp/authorize') assert.deepEqual(call.body, { kind: 'studio', configurations: [], captionStyle: call.body.captionStyle, captionCustomized: call.body.captionCustomized });
        else {
          assert.equal(call.body.name, 'mcp_render');
          assert.deepEqual(Object.keys(call.body.props).sort(), ['free', 'kind', 'outcome']);
        }
        for (const privateValue of ['source.mp4', 'crop', 'place', 'track', 'transcript', 'underline', 'word_styles', 'palette', 'seed', 'preset']) assert.equal(JSON.stringify(call.body).includes(privateValue), false);
      }
      assert.equal(calls.some(call => call.path === '/api/activity'), true);
      assert.deepEqual((await readdir(output)).sort(), ['success-2.mp4', 'success.mp4']);
    });
    await t.test('titles and rapid intro render free, publish once and never reach Modisign', async () => {
      const before = calls.length;
      const clips = length => Array.from({ length: 5 }, () => ({ path: media, track: 'v1', out: length }));
      const intro = { clips: [0, 1, 2, 3, 4], labels: ['SecretLabelA', 'b', 'c', 'd', 'e'].map((text, clip) => ({ clip, text })) };
      const files = await readdir(output);
      await assert.rejects(jobs.start(request('refused.mp4', { clips: clips(0.1), rapid_intro: intro })), /shorter than 5 frames/);
      assert.deepEqual(await readdir(output), files, 'a refused intro publishes nothing');
      const job = await jobs.start(request('titles.mp4', { clips: clips(0.5), rapid_intro: intro, texts: [{ text: 'SecretTitleText', start: 0, duration: 1 }] }));
      const result = await finished(jobs, job.job_id);
      assert.equal(result.state, 'done', JSON.stringify(result.error));
      assert.ok(Math.abs(result.artifact.duration_seconds - (2.5 + 25 / 30)) < 1e-6);
      const mine = calls.slice(before);
      assert.ok(mine.length > 0);
      for (const call of mine) {
        if (call.path === '/api/mcp/authorize') assert.deepEqual(call.body, { kind: 'studio', configurations: [], captionStyle: null, captionCustomized: false });
        else assert.deepEqual(Object.keys(call.body.props).sort(), ['free', 'kind', 'outcome']);
        assert.doesNotMatch(JSON.stringify(call.body), /Secret|rapid|texts|labels/);
      }
    });
    await t.test('the rapid intro length check waits for silence removal instead of judging the unedited clips', async () => {
      const clips = Array.from({ length: 90 }, () => ({ path: media, track: 'v1' }));
      const intro = { clips: [0, 1, 2, 3, 4], labels: ['a', 'b', 'c', 'd', 'e'].map((text, clip) => ({ clip, text })) };
      await assert.rejects(jobs.start(request('long-a.mp4', { clips, rapid_intro: intro })), /at most 180 seconds/);
      const job = await jobs.start(request('long-b.mp4', { clips, rapid_intro: intro, remove_silences: { sensitivity: 'normal', shortest_pause: 0.5 } }));
      const result = await finished(jobs, job.job_id);
      assert.equal(result.state, 'failed');
      assert.match(result.error.error, /at most 180 seconds/, 'the browser judges the real result, with no file published');
    });
  } finally {
    await jobs.close();
    await rm(directory, { recursive: true, force: true });
  }
});
