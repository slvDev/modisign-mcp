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
  const photo = join(directory, 'photo.png');
  const calls = [];
  let onFetch = null;
  let proAccount = false;
  let offline = false;
  let onAuthorize = null;
  let denyReason = 'pro';
  let onBrowser = null;
  const launch = puppeteer.launch.bind(puppeteer);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const path = new URL(url).pathname;
    if (onFetch !== null) await onFetch(path, options.signal);
    if (new URL(url).hostname === 'huggingface.co') return new Response('test model');
    if (offline) throw new TypeError('Offline fixture');
    if (path === '/api/mcp/authorize') {
      const body = JSON.parse(options.body);
      calls.push({ path, body });
      const free = !(['karaoke', 'mixed'].includes(body.captionStyle) || body.captionCustomized || body.overlayMotionCustomized || body.titleEffects);
      const allowed = free || proAccount;
      if (onAuthorize !== null) onAuthorize();
      return Response.json(allowed ? { v: 1, allowed: true, tier: free ? 'free' : 'pro' } : { v: 1, allowed: false, reason: denyReason });
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
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:d=1', '-frames:v', '1', photo]);
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
    // Cancel during speech setup leaves nothing published, for a plain style, a Pro mixed request with word styles, an expressive line and a free Scatter.
    const placement = { position: 'lower', size: 'm' };
    for (const [name, pro, captions] of [['clean', false, { style: 'clean', ...placement }], ['mixed', true, { style: 'mixed', ...placement, mix: { preset: 'creator', seed: 58 }, word_styles: [{ clip: 1, from: 0, to: 1, appearance: { underline: true } }] }],
      ['lines', true, { style: 'clean', ...placement, lines: [{ clip: 1, from: 0, to: 1, style: 'editorial', x: 0.3 }] }],
      ['scatter', false, { style: 'clean', ...placement, scatter: { seed: 58, safe_zone: 'social', intensity: 'normal', styles: ['clean', 'boxed'] } }]]) {
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
    await t.test('a first caption run reports the speech model download and caption preparation instead of rendering', async () => {
      const seen = [];
      const job = await jobs.start(request('model-stages.mp4', { captions: { style: 'clean', ...placement } }), async snapshot => { if (seen.at(-1) !== snapshot.state) seen.push(snapshot.state); });
      await finished(jobs, job.job_id);
      assert.ok(seen.indexOf('downloading_speech_model') !== -1 && seen.indexOf('downloading_speech_model') < seen.indexOf('preparing_captions'), seen.join(' > '));
      assert.deepEqual(await readdir(output), []);
    });
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
        const before = calls.length;
        const job = await jobs.start(request(`${stage}.mp4`));
        await reached.promise;
        jobs.cancel(job.job_id);
        assert.equal((await finished(jobs, job.job_id)).state, 'canceled');
        onBrowser = null;
        assert.deepEqual(await readdir(output), []);
        // A canceled job is not a render failure.
        assert.equal(calls.slice(before).some(call => call.body.name === 'mcp_render'), false);
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
        if (call.path === '/api/mcp/authorize') assert.deepEqual(call.body, { kind: 'studio', configurations: [], overlayMotionCustomized: false, captionStyle: call.body.captionStyle, captionCustomized: call.body.captionCustomized, titleEffects: false });
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
        if (call.path === '/api/mcp/authorize') assert.deepEqual(call.body, { kind: 'studio', configurations: [], overlayMotionCustomized: false, captionStyle: null, captionCustomized: false, titleEffects: false });
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
    // Footage, photo and title motion is free and anonymous; only the fixed summary reaches Modisign, never curves, text or paths.
    const key = (at, value, easing = 'linear') => ({ at, value, easing });
    const motion = { scale: [key(0, 1, 'ease-in-out'), key(2, 1.2)], opacity: [key(0, 0, [0.123, 0.456, 0.789, 0.321]), key(0.5, 1)] };
    const summary = (overlays, overlayMotionCustomized, titleEffects = false) => ({ kind: 'studio', configurations: overlays, overlayMotionCustomized, captionStyle: null, captionCustomized: false, titleEffects });
    await t.test('anonymous footage, photo and title motion render free and send only the summary', async () => {
      const before = calls.length;
      const job = await jobs.start(request('motion-free.mp4', { clips: [
        { path: media, track: 'v2', start: 0, mute: true, motion },
        { path: media, track: 'v1', motion: { x: [key(0, 0, 'hold'), key(1, -0.15)] } },
        { path: photo, track: 'v1', out: 1, motion: { rotation: [key(-3, 0), key(5, 90)] } },
      ], texts: [{ text: 'SecretMotionTitle', start: 0, duration: 1, motion }] }));
      const result = await finished(jobs, job.job_id);
      assert.equal(result.state, 'done', JSON.stringify(result.error));
      assert.ok(Math.abs(result.artifact.duration_seconds - 3) < 0.1);
      const mine = calls.slice(before);
      assert.deepEqual(mine.filter(call => call.path === '/api/mcp/authorize').map(call => call.body), [summary([], false), summary([], false)], 'submission and dequeue');
      for (const call of mine) assert.doesNotMatch(JSON.stringify(call.body), /Secret|scale|opacity|rotation|easing|motion|0\.123|source\.mp4|photo\.png/);
    });
    // A seeded configuration lets overlay requests reach authorization and dequeue without the network; the render itself stops at the missing composition.
    const { writeCache } = await import('../dist/cache.js');
    const configuration = '/overlays/hook-title?setup=Overlay';
    const normalized = `${configuration}&aspect=9x16&background=transparent`;
    await writeCache(`configuration:${normalized}`, { configuration: normalized, tier: 'free', editorUrl: `https://modisign.app${normalized}`, relevance: { relevant: [], irrelevant: [] }, activeCues: [],
      render: { compositionUrl: 'https://modisign.app/preview/hook-title', variables: {}, duration: 1, width: 1080, height: 1920, background: 'transparent' },
      studio: { family: { id: 'hook-title', name: 'Hook title', variables: [], cues: [], supported_aspects: ['9x16'], default_duration: 1, looks: [], freeConfigs: [] }, preset: { id: 'free', family: 'hook-title', href: configuration }, config: { aspect: '9x16', look: 'default', duration: 1, values: {} } } });
    const withOverlay = (name, overlayMotion) => request(name, { overlays: [{ configuration, start: 0, ...(overlayMotion === undefined ? {} : { motion: overlayMotion }) }] });
    await t.test('identity-valued or absent overlay motion stays free', async () => {
      const identity = { x: [key(0, 0), key(1, 0)], y: [key(0, 0)], scale: [key(0, 1)], rotation: [key(0, 0)], opacity: [key(0, 1)] };
      for (const overlayMotion of [undefined, identity]) {
        const before = calls.length;
        const result = await finished(jobs, (await jobs.start(withOverlay('identity.mp4', overlayMotion))).job_id);
        assert.equal(result.state, 'failed');
        assert.doesNotMatch(JSON.stringify(result.error), /needs Pro/);
        assert.deepEqual(calls.slice(before).filter(call => call.path === '/api/mcp/authorize').map(call => call.body), [summary([normalized], false), summary([normalized], false)]);
      }
    });
    await t.test('every nonidentity overlay key denies anonymously, active or not, and sends only the boolean', async () => {
      const files = await readdir(output);
      for (const overlayMotion of [{ x: [key(0, 0.1)] }, { y: [key(0, -0.1)] }, { scale: [key(0, 1.5)] }, { rotation: [key(0, 360)] }, { opacity: [key(0, 0.5)] },
        { x: [key(0, 0), key(170, 0.1)] }, { scale: [key(0, 1), key(1, 1)], rotation: [key(0, 0), key(1, 360)] }, motion]) {
        const before = calls.length;
        await assert.rejects(jobs.start(withOverlay('customized.mp4', overlayMotion)), /needs Pro/, JSON.stringify(overlayMotion));
        assert.deepEqual(calls.slice(before).map(call => call.body), [summary([normalized], true)]);
      }
      assert.deepEqual(await readdir(output), files);
    });
    await t.test('Pro allows overlay motion at submission and a revoked account is denied at dequeue', async () => {
      const before = calls.length;
      let seen = 0;
      proAccount = true;
      onAuthorize = () => { if (++seen === 1) proAccount = false; };
      try {
        const result = await finished(jobs, (await jobs.start(withOverlay('revoked.mp4', motion))).job_id);
        assert.equal(result.state, 'failed');
        assert.match(result.error.error, /needs Pro/);
        assert.deepEqual(calls.slice(before).filter(call => call.path === '/api/mcp/authorize').map(call => call.body), [summary([normalized], true), summary([normalized], true)]);
      } finally { onAuthorize = null; proAccount = false; }
    });
    await t.test('a cached free authorization is never reused for a motion-customized request', async () => {
      offline = true;
      try {
        const result = await finished(jobs, (await jobs.start(withOverlay('offline-free.mp4'))).job_id);
        assert.equal(result.state, 'failed', 'the unchanged request still passes authorization from the exact cached body');
        await assert.rejects(jobs.start(withOverlay('offline-customized.mp4', { x: [key(0, 0.1)] })), /Cannot reach Modisign/);
      } finally { offline = false; }
    });
    await t.test('caption lines and Scatter are classified before any speech and send only the six fixed facts at submission and dequeue', async () => {
      const authorizations = before => calls.slice(before).filter(call => call.path === '/api/mcp/authorize').map(call => call.body);
      const body = captionCustomized => ({ kind: 'studio', configurations: [], overlayMotionCustomized: false, captionStyle: 'clean', captionCustomized, titleEffects: false });
      const base = { style: 'clean', ...placement };
      const row = extra => ({ clip: 1, from: 0, to: 1, ...extra });
      const free = [
        { ...base, grouping: { max_words: 4, max_characters: 24, max_duration: 1.8, pause: 0.35 }, lines: [row({ x: 0.31, y: 0.42, size: 0.055, rotation: -4 }), row({ style: 'boxed' })] },
        { ...base, scatter: { seed: 4242, safe_zone: 'frame', intensity: 'subtle', styles: ['clean', 'boxed', 'minimal'] } },
      ];
      const expressive = [
        { ...base, lines: [row({ style: 'editorial' })] },
        { ...base, lines: [row({ style: 'mixed', mix: { preset: 'creator', seed: 4242 } })] },
        { ...base, scatter: { seed: 4242, safe_zone: 'social', intensity: 'normal', styles: ['clean', 'editorial'] } },
      ];
      const start = calls.length;
      for (const captions of free) {
        const before = calls.length;
        const result = await finished(jobs, (await jobs.start(request('lines-free.mp4', { captions }))).job_id);
        assert.notEqual(result.state, 'done', 'the stand-in speech model never produces a file');
        assert.deepEqual(authorizations(before), [body(false), body(false)], 'geometry, free styles and a free pool stay free');
      }
      denyReason = 'sign_in';
      try {
        for (const captions of expressive) {
          const before = calls.length;
          await assert.rejects(jobs.start(request('lines-expressive.mp4', { captions })), /expressive caption lines or styled words.*Sign in/s, JSON.stringify(captions).slice(0, 80));
          assert.deepEqual(authorizations(before), [body(true)]);
        }
      } finally { denyReason = 'pro'; }
      for (const captions of expressive) await assert.rejects(jobs.start(request('lines-expressive.mp4', { captions })), /needs Pro/);
      // A cached free authorization covers the unchanged free body but never an expressive one.
      offline = true;
      try {
        for (const captions of free) assert.notEqual((await finished(jobs, (await jobs.start(request('lines-offline.mp4', { captions }))).job_id)).state, 'done');
        for (const captions of expressive) await assert.rejects(jobs.start(request('lines-offline.mp4', { captions })), /Cannot reach Modisign/);
      } finally { offline = false; }
      // Pro passes both checks with the same body, and a revoked account is denied at dequeue.
      proAccount = true;
      try {
        for (const captions of expressive) {
          const before = calls.length;
          const result = await finished(jobs, (await jobs.start(request('lines-pro.mp4', { captions }))).job_id);
          assert.notEqual(result.state, 'done');
          assert.doesNotMatch(JSON.stringify(result.error), /needs Pro/);
          assert.deepEqual(authorizations(before), [body(true), body(true)]);
        }
        let seen = 0;
        onAuthorize = () => { if (++seen === 1) proAccount = false; };
        const before = calls.length;
        const result = await finished(jobs, (await jobs.start(request('lines-revoked.mp4', { captions: expressive[0] }))).job_id);
        assert.equal(result.state, 'failed');
        assert.match(result.error.error, /needs Pro/);
        assert.deepEqual(authorizations(before), [body(true), body(true)]);
      } finally { onAuthorize = null; proAccount = false; }
      for (const call of calls.slice(start)) {
        if (call.path !== '/api/mcp/authorize') assert.deepEqual(Object.keys(call.body.props).sort(), ['free', 'kind', 'outcome']);
        assert.doesNotMatch(JSON.stringify(call.body), /lines|grouping|scatter|rotation|seed|safe_zone|intensity|max_words|4242|editorial|boxed|creator|0\.31|0\.42|0\.055/);
      }
      assert.equal((await readdir(output)).some(name => name.startsWith('lines-')), false, 'no partial or final file is published');
    });
    await t.test('Scatter reports its stage, publishes once, and an unplaceable phrase fails before any bytes with no text or seed anywhere', async () => {
      // A stand-in for the speech worker answers the transcribe protocol with fixed words.
      const spoken = ['SecretOne', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight.'].map((text, index) => ({ id: `w${index}`, text, start: index * 0.25, end: (index + 1) * 0.25 }));
      onBrowser = async page => {
        await page.evaluateOnNewDocument(words => {
          window.Worker = class { postMessage(message) { setTimeout(() => this.onmessage({ data: { type: 'done', id: message.id, words, audio: true } }), 0); } terminate() {} };
        }, spoken);
      };
      const scatter = { seed: 424242, safe_zone: 'social', intensity: 'normal', styles: ['clean', 'boxed', 'minimal'] };
      const captions = { style: 'clean', ...placement, scatter };
      const files = await readdir(output);
      try {
        const before = calls.length;
        const seen = [];
        const job = await jobs.start(request('scatter.mp4', { captions }), async snapshot => { if (seen.at(-1) !== snapshot.state) seen.push(snapshot.state); });
        const result = await finished(jobs, job.job_id);
        assert.equal(result.state, 'done', JSON.stringify(result.error));
        assert.ok(seen.indexOf('preparing_captions') !== -1 && seen.indexOf('preparing_captions') < seen.indexOf('placing_captions') && seen.indexOf('placing_captions') < seen.lastIndexOf('rendering'), seen.join(' > '));
        assert.deepEqual((await readdir(output)).filter(name => !files.includes(name)), ['scatter.mp4']);
        // Titles covering every candidate position leave no safe place: the job fails naming the field and owner, and nothing is published.
        const blocker = y => ({ text: 'WWWWWWWWWWWWWWWW', start: 0, duration: 2, size: 'xl', backing: true, x: 0.5, y });
        const blocked = await finished(jobs, (await jobs.start(request('scatter-blocked.mp4', { captions, texts: [0.18, 0.28, 0.38, 0.48, 0.58, 0.68].map(blocker) }))).job_id);
        assert.equal(blocked.state, 'failed');
        assert.match(blocked.error.error, /Scatter could not keep \d+ caption phrases? clear of the edit .*seconds, blocked by (title:|overlay:|safe-zone)/);
        assert.equal(blocked.error.field, 'captions.scatter');
        assert.deepEqual((await readdir(output)).filter(name => !files.includes(name)), ['scatter.mp4'], 'no partial or final file for the blocked job');
        for (const call of calls.slice(before)) {
          if (call.path !== '/api/mcp/authorize') assert.deepEqual(Object.keys(call.body.props).sort(), ['free', 'kind', 'outcome']);
          else assert.deepEqual(call.body, { kind: 'studio', configurations: [], overlayMotionCustomized: false, captionStyle: 'clean', captionCustomized: false, titleEffects: false });
          assert.doesNotMatch(JSON.stringify(call.body), /SecretOne|424242|seed|scatter|safe_zone|intensity|rotation|WWWW/);
        }
        assert.doesNotMatch(JSON.stringify([blocked.error, result.artifact]), /SecretOne|424242/);
      } finally { onBrowser = null; }
    });
    await t.test('full-source transcripts over the caption budget fail the job instead of dropping speech from a short-trimmed edit', async () => {
      onBrowser = async page => {
        await page.evaluateOnNewDocument(() => {
          const words = Array.from({ length: 3000 }, (_, index) => ({ id: `w${index}`, text: 'word', start: index * 0.0006, end: (index + 1) * 0.0006 }));
          window.Worker = class { postMessage(message) { setTimeout(() => this.onmessage({ data: { type: 'done', id: message.id, words, audio: true } }), 0); } terminate() {} };
        });
      };
      const files = await readdir(output);
      try {
        const clips = Array.from({ length: 5 }, () => ({ path: media, track: 'v1', out: 0.5 }));
        const result = await finished(jobs, (await jobs.start(request('caption-budget.mp4', { clips, captions: { style: 'clean', ...placement } }))).job_id);
        assert.equal(result.state, 'failed');
        assert.equal(result.error.field, 'captions');
        assert.match(result.error.error, /Captions were not built: the speech in these source files is too long/);
        assert.deepEqual(await readdir(output), files, 'no file is published');
        // The same speech in one source fits and renders.
        const fits = await finished(jobs, (await jobs.start(request('caption-fits.mp4', { clips: clips.slice(0, 1), captions: { style: 'clean', ...placement } }))).job_id);
        assert.equal(fits.state, 'done', JSON.stringify(fits.error));
      } finally { onBrowser = null; }
    });
    await t.test('titles with a reveal authorize only the fixed titleEffects fact at submission and dequeue', async () => {
      const reveal = { rect: { x: 0.1, width: 0.7 }, direction: 'left', start: 0.2, duration: 0.5, easing: 'ease-in-out' };
      const revealed = name => request(name, { texts: [{ text: 'SecretRevealTitle', start: 0, duration: 1.5, reveal }] });
      const authorizations = before => calls.slice(before).filter(call => call.path === '/api/mcp/authorize').map(call => call.body);
      const files = await readdir(output);
      const bad = request('bad-reveal.mp4', { texts: [{ text: 'a', start: 0, duration: 1, reveal: { duration: 0 } }] });
      const before = calls.length;
      await assert.rejects(jobs.start(bad), error => error.details.field === 'texts.0.reveal.duration');
      assert.equal(calls.length, before, 'a malformed reveal fails before any authorization');
      // Anonymous: the free path is denied, the plain title stays free and only the boolean differs.
      denyReason = 'sign_in';
      try {
        const denied = calls.length;
        await assert.rejects(jobs.start(revealed('anonymous.mp4')), /Sign in/);
        assert.deepEqual(authorizations(denied), [summary([], false, true)]);
      } finally { denyReason = 'pro'; }
      const plain = calls.length;
      const free = await finished(jobs, (await jobs.start(request('plain.mp4', { texts: [{ text: 'SecretRevealTitle', start: 0, duration: 1.5 }] }))).job_id);
      assert.equal(free.state, 'done', JSON.stringify(free.error));
      assert.deepEqual(authorizations(plain), [summary([], false), summary([], false)]);
      // A cached free authorization never covers a reveal.
      offline = true;
      try { await assert.rejects(jobs.start(revealed('offline.mp4')), /Cannot reach Modisign/); } finally { offline = false; }
      // Pro: both checks carry the same body and the file is published.
      proAccount = true;
      try {
        const allowed = calls.length;
        const result = await finished(jobs, (await jobs.start(revealed('pro-reveal.mp4'))).job_id);
        assert.equal(result.state, 'done', JSON.stringify(result.error));
        assert.deepEqual(authorizations(allowed), [summary([], false, true), summary([], false, true)]);
        for (const call of calls.slice(allowed)) assert.doesNotMatch(JSON.stringify(call.body), /Secret|reveal|rect|direction|easing|0\.7/);
      } finally { proAccount = false; }
      // A revoked account is denied at dequeue.
      let seen = 0;
      proAccount = true;
      onAuthorize = () => { if (++seen === 1) proAccount = false; };
      try {
        const revoked = calls.length;
        const result = await finished(jobs, (await jobs.start(revealed('revoked-reveal.mp4'))).job_id);
        assert.equal(result.state, 'failed');
        assert.match(result.error.error, /needs Pro/);
        assert.deepEqual(authorizations(revoked), [summary([], false, true), summary([], false, true)]);
      } finally { onAuthorize = null; proAccount = false; }
      assert.deepEqual((await readdir(output)).filter(name => !files.includes(name)).sort(), ['plain.mp4', 'pro-reveal.mp4']);
    });
    await t.test('person effects authorize only fixed facts at submission and dequeue', async () => {
      const person = name => request(name, { texts: [{ text: 'SecretPersonTitle', start: 0, duration: 1.5, occlusion: { clip: 1, threshold: 0.77, feather: 2.5, smoothing: 0.31 } }] });
      const authorizations = before => calls.slice(before).filter(call => call.path === '/api/mcp/authorize').map(call => call.body);
      let before = calls.length;
      await assert.rejects(jobs.start(request('bad-person.mp4', { texts: [{ text: 'a', start: 0, duration: 1, occlusion: { clip: 9 } }] })), error => error.details.field === 'texts.0.occlusion.clip');
      assert.equal(calls.length, before, 'a malformed occlusion fails before any authorization');
      // Anonymous: denied with sign-in, and only the boolean differs from a plain title's body.
      denyReason = 'sign_in';
      try {
        before = calls.length;
        await assert.rejects(jobs.start(person('anonymous-person.mp4')), /Sign in/);
        assert.deepEqual(authorizations(before), [summary([], false, true)]);
      } finally { denyReason = 'pro'; }
      // A plain title bound to the v2 clip stays free and anonymous.
      before = calls.length;
      const plain = await finished(jobs, (await jobs.start(request('plain-v2-title.mp4', { texts: [{ text: 'SecretPlainTitle', clip: 0 }] }))).job_id);
      assert.equal(plain.state, 'done', JSON.stringify(plain.error));
      assert.deepEqual(authorizations(before), [summary([], false), summary([], false)]);
      // A cached free authorization never covers a person title.
      offline = true;
      try { await assert.rejects(jobs.start(person('offline-person.mp4')), /Cannot reach Modisign/); } finally { offline = false; }
      // Pro: both checks carry the same body; the job is canceled right after the second one, before any pixels.
      proAccount = true;
      const dequeued = Promise.withResolvers();
      let seen = 0;
      onAuthorize = () => { if (++seen === 2) dequeued.resolve(); };
      try {
        before = calls.length;
        const job = await jobs.start(person('pro-person.mp4'));
        await dequeued.promise;
        jobs.cancel(job.job_id);
        assert.ok(terminal((await finished(jobs, job.job_id)).state));
        assert.deepEqual(authorizations(before), [summary([], false, true), summary([], false, true)]);
        for (const call of calls.slice(before)) assert.doesNotMatch(JSON.stringify(call.body), /Secret|occlusion|threshold|feather|smoothing|0\.77|people/);
      } finally { onAuthorize = null; proAccount = false; }
      // A revoked account is denied at dequeue.
      seen = 0;
      proAccount = true;
      onAuthorize = () => { if (++seen === 1) proAccount = false; };
      try {
        before = calls.length;
        const result = await finished(jobs, (await jobs.start(person('revoked-person.mp4'))).job_id);
        assert.equal(result.state, 'failed');
        assert.match(result.error.error, /needs Pro/);
        assert.deepEqual(authorizations(before), [summary([], false, true), summary([], false, true)]);
      } finally { onAuthorize = null; proAccount = false; }
    });
    await t.test('motion beyond the project byte limit is refused after mapping and publishes nothing', async () => {
      const files = await readdir(output);
      const heavy = Object.fromEntries(['x', 'y', 'scale', 'rotation', 'opacity'].map(channel => [channel,
        Array.from({ length: 60 }, (_, index) => key(index * 0.5, 0.5, [0.12345678901234, 0.23456789012345, 0.34567890123456, 0.45678901234567]))]));
      const result = await finished(jobs, (await jobs.start(request('heavy.mp4', { clips: [1, 2, 3].map(() => ({ path: media, track: 'v1', motion: heavy })) }))).job_id);
      assert.equal(result.state, 'failed');
      assert.match(result.error.error, /64 KiB/);
      assert.deepEqual(await readdir(output), files);
    });
    // Sounds are free and local: no sound field reaches Modisign, nothing is published unless the whole mix encodes, and the render browser asks nobody but the loopback server.
    const sounds = { sfx: [{ asset: 'ugc-click-01', start: 0.5 }], texts: [{ text: 'SecretSoundTitle', start: 0, duration: 1 }], auto_sfx: { events: ['title'], seed: 99 } };
    await t.test('sounds render free, publish once and never reach Modisign or any other host', async () => {
      const before = calls.length;
      const requested = []; const external = [];
      onBrowser = async page => {
        page.on('request', item => requested.push(item.url()));
        await page.exposeFunction('externalResult', outcome => { external.push(outcome); });
        await page.evaluateOnNewDocument(() => {
          addEventListener('load', () => { for (const host of ['kenney.nl', 'freesound.org', 'pixabay.com', 'sonniss.com']) void fetch(`https://${host}/sound.wav`).then(() => window.externalResult(`answered ${host}`), () => window.externalResult(`denied ${host}`)); });
        });
      };
      try {
        const files = await readdir(output);
        const result = await finished(jobs, (await jobs.start(request('sounds.mp4', sounds))).job_id);
        assert.equal(result.state, 'done', JSON.stringify(result.error));
        assert.deepEqual((await readdir(output)).filter(name => !files.includes(name)), ['sounds.mp4']);
        assert.match(result.warnings.join(' '), /Added 1 automatic sound/);
        assert.deepEqual(external.sort(), ['denied freesound.org', 'denied kenney.nl', 'denied pixabay.com', 'denied sonniss.com']);
        assert.ok(requested.some(url => /\/sfx\/ugc-1\/ugc-click-01\.[0-9a-f]{8}\.wav$/.test(url)), 'the pack sound came from the loopback server');
        assert.ok(requested.every(url => ['localhost', '127.0.0.1'].includes(new URL(url).hostname) || url.startsWith('data:') || url.startsWith('blob:')), requested.filter(url => !/localhost|127\.0\.0\.1|^data:|^blob:/.test(url)).join(' '));
        const mine = calls.slice(before);
        assert.deepEqual(mine.filter(call => call.path === '/api/mcp/authorize').map(call => call.body), [summary([], false), summary([], false)]);
        for (const call of mine) {
          if (call.path === '/api/activity') assert.deepEqual(Object.keys(call.body.props).sort(), ['free', 'kind', 'outcome']);
          assert.doesNotMatch(JSON.stringify(call.body), /ugc-|sfx|sound|click|Secret|source\.mp4/i);
        }
      } finally { onBrowser = null; }
    });
    // The loader's own request, held open, stands for asset preparation; the encoder's first call stands for encoding.
    for (const [stage, arm] of [['asset preparation', () => { const original = window.fetch; window.fetch = (input, init) => { if (String(input).includes('/sfx/')) { void window.cancelAtStage(); return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))); } return original(input, init); }; }],
      ['encoding with sounds', () => { const original = window.VideoEncoder.prototype.encode; let first = true; window.VideoEncoder.prototype.encode = function (...args) { const result = original.apply(this, args); if (first) { first = false; void window.cancelAtStage(); } return result; }; }]]) {
      await t.test(`${stage} cancellation publishes nothing`, async () => {
        const reached = Promise.withResolvers();
        onBrowser = async page => {
          await page.exposeFunction('cancelAtStage', () => { reached.resolve(); });
          await page.evaluateOnNewDocument(arm);
        };
        const files = await readdir(output);
        const job = await jobs.start(request(`sounds-${stage.split(' ')[0]}.mp4`, sounds));
        await reached.promise;
        jobs.cancel(job.job_id);
        assert.equal((await finished(jobs, job.job_id)).state, 'canceled');
        onBrowser = null;
        assert.deepEqual(await readdir(output), files);
      });
    }
    await t.test('a sound whose owner cannot exist is refused at submission before anything is queued', async () => {
      const files = await readdir(output);
      for (const [extra, field] of [[{ sfx: [{ asset: 'ugc-click-01', start: 99 }] }, 'sfx.0.start'], [{ clips: [{ path: media, track: 'v1', out: 0.1 }, { path: media, track: 'v1' }], sfx: [{ asset: 'ugc-pop-01', anchor: { kind: 'transition', after_clip: 0 } }], transitions: [{ after_clip: 0, type: 'crossfade', duration: 0.4 }] }, 'sfx.0.anchor'],
        [{ sfx: [{ asset: 'ugc-pop-01', anchor: { kind: 'overlay-cue', overlay: 0, cue: 'tap' } }], overlays: [{ configuration, start: 0 }] }, 'sfx.0.anchor']]) {
        await assert.rejects(jobs.start(request('refused-sound.mp4', extra)), error => error.details.field === field, JSON.stringify(extra));
      }
      assert.deepEqual(await readdir(output), files);
    });
  } finally {
    await jobs.close();
    await rm(directory, { recursive: true, force: true });
  }
});
