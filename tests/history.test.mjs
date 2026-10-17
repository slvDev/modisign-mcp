import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const directory = await mkdtemp(join(tmpdir(), 'modisign-history-'));
process.env.MODISIGN_CONFIG_DIR = directory;
process.env.MODISIGN_NO_TELEMETRY = '1';
after(async () => { await rm(directory, { recursive: true, force: true }); });
const { login, logout } = await import('../dist/auth.js');
const { recordHistory } = await import('../dist/render.js');
const signIn = async () => { assert.equal((await (await login()).completion).signed_in, true); };
const { authorize } = await import('../dist/overlays.js');
const family = { name: 'Hook title', variables: [
  { id: 'setup', type: 'string', role: 'content' },
  { id: 'punch', type: 'string', role: 'content' },
  { id: 'layout', type: 'enum', role: 'layout' },
  { id: 'output', type: 'string', role: 'output' },
] };
const config = (setup, punch = '') => ({
  configuration: `/overlays/hook-title?setup=${encodeURIComponent(setup)}`,
  studio: { family, config: { values: { setup, punch, layout: 'center', output: 'greenscreen' } } },
});

test('completed overlay/composite history follows the editor account and configuration gates', async (t) => {
  let pro = false;
  let tier = 'free';
  let historyStatus = 201;
  let offline = false;
  const writes = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (offline) throw new TypeError('Offline fixture');
    const path = new URL(url).pathname;
    if (path === '/api/auth/device/code') return Response.json({ v: 1, device_code: 'test-device', user_code: 'TEST-CODE', verification_uri_complete: 'https://modisign.app/device?code=TEST-CODE', expires_in: 600, interval: 5 });
    if (path === '/api/auth/device/token') return Response.json({ v: 1, access_token: 'test-device-token', expires_in: 3600 });
    if (path === '/api/account') return Response.json({ user: { pro } });
    if (path === '/api/mcp/authorize') {
      if (tier === 'pro' && options.headers.Authorization === undefined) return Response.json({ v: 1, error: 'Sign in required' }, { status: 401 });
      if (tier === 'pro' && !pro) return Response.json({ v: 1, error: 'Pro required' }, { status: 403 });
      return Response.json({ v: 1, allowed: true, tier });
    }
    assert.equal(path, '/api/account/exports');
    assert.equal(options.headers.Authorization, 'Bearer test-device-token');
    writes.push(JSON.parse(options.body));
    return Response.json({ id: 'completed-export' }, { status: historyStatus });
  });
  for (const account of ['anonymous', 'free', 'pro']) {
    await logout();
    pro = account === 'pro';
    if (account !== 'anonymous') await signIn();
    for (tier of ['free', 'pro']) {
      writes.length = 0;
      const overlay = config(`${account} ${tier}`);
      if (tier === 'pro' && !pro) {
        await assert.rejects(authorize(overlay.configuration));
        assert.deepEqual(writes, []);
        continue;
      }
      assert.equal(await authorize(overlay.configuration), tier);
      assert.deepEqual(await recordHistory(overlay, tier === 'free'), []);
      assert.deepEqual(writes, pro ? [{ title: `${account} ${tier}`, templateName: 'Hook title', templateHref: overlay.configuration }] : []);
    }
  }
  for (const [setup, punch, title] of [
    ['First hook', 'First punch', 'First hook · First punch'],
    ['Second hook', '', 'Second hook'], ['', '', 'Hook title'],
  ]) {
    writes.length = 0;
    const overlay = config(setup, punch);
    assert.deepEqual(await recordHistory(overlay, true), []);
    assert.deepEqual(writes, [{ title, templateName: 'Hook title', templateHref: overlay.configuration }]);
  }
  historyStatus = 503;
  for (const free of [true, false]) assert.deepEqual(await recordHistory(config('Saved clip'), free), ['Your file is saved, but Modisign could not record account history.']);
  await logout();
  pro = false;
  tier = 'free';
  const cached = config('Cached free clip');
  assert.equal(await authorize(cached.configuration), 'free');
  offline = true;
  assert.equal(await authorize(cached.configuration), 'free');
  assert.deepEqual(await recordHistory(cached, true), []);
  await assert.rejects(authorize(config('Uncached free clip').configuration));
  offline = false;
  await signIn();
  offline = true;
  assert.deepEqual(await recordHistory(cached, true), ['Your file is saved, but Modisign could not record account history.']);
  await assert.rejects(authorize(config('pro pro').configuration));
});


test('overlay and Studio authorization use exact free-cache identities and fail closed on denials/cancellation', async (t) => {
  const { authorizeRequest } = await import('../dist/authorization.js');
  const { configurationUrl, resolveConfiguration } = await import('../dist/overlays.js');
  const { writeCache } = await import('../dist/cache.js');
  let result = { v: 1, allowed: true, tier: 'free' };
  let offline = false;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    if (offline) throw new TypeError('Offline fixture');
    return Response.json(result);
  });
  for (const body of [{ configuration: '/overlays/hook-title?setup=Overlay' }, { kind: 'studio', configurations: [], captionStyle: 'clean' }]) {
    const key = `audit:${JSON.stringify(body)}`;
    assert.equal(await authorizeRequest(body, key), 'free');
    offline = true;
    assert.equal(await authorizeRequest(body, key), 'free');
    await assert.rejects(authorizeRequest(body, key + ':different'));
    offline = false;
    result = { v: 1, allowed: false, tier: 'pro', reason: 'pro_required' };
    await assert.rejects(authorizeRequest(body, key + ':denied'));
    offline = true;
    await assert.rejects(authorizeRequest(body, key + ':denied'));
    offline = false;
    result = { v: 1, allowed: false, tier: 'pro' };
    await assert.rejects(authorizeRequest(body, key + ':missing-reason'), /no reason/);
    result = { v: 1, allowed: true, tier: 'pro' };
    assert.equal(await authorizeRequest(body, key + ':pro'), 'pro');
    offline = true;
    await assert.rejects(authorizeRequest(body, key + ':pro'));
    offline = false;
    result = { v: 1, allowed: true, tier: 'free' };
    const before = requests;
    await assert.rejects(authorizeRequest(body, key, AbortSignal.abort()), { name: 'AbortError' });
    assert.equal(requests, before);
  }
  for (const value of ['/overlays/hook-title?setup=Hello#fragment', '/overlays/hook-title?setup=Hello\0', '/overlays/hook-title?', '/overlays/hook-title?setup=%GG']) assert.throws(() => configurationUrl(value));
  assert.equal(configurationUrl('/overlays/hook-title?setup=%F0%9F%98%80').searchParams.get('setup'), '😀');
  const configuration = '/overlays/hook-title?setup=MalformedCache';
  const cached = {
    configuration, tier: 'free', editorUrl: 'https://modisign.app' + configuration, relevance: { relevant: ['setup'], irrelevant: [] },
    render: { compositionUrl: 'https://modisign.app/preview/hook-title?setup=MalformedCache', variables: { setup: 'MalformedCache' }, duration: 3, width: 1080, height: 1920, background: 'green' },
    studio: { family: { id: 'hook-title', name: 'Hook title', variables: [], supported_aspects: ['9x16'], default_duration: 3, looks: [], freeConfigs: [] }, preset: { family: 'hook-title', id: 'audit', href: configuration }, config: { aspect: '9x16', look: 'default', duration: 3, values: { setup: 'MalformedCache' } } },
  };
  const { studio: _studio, ...incomplete } = cached;
  const { relevance: _relevance, ...withoutRelevance } = cached;
  const before = requests;
  for (const record of [incomplete, withoutRelevance]) {
    await writeCache(`configuration:${configuration}`, record);
    await assert.rejects(resolveConfiguration(configuration, new AbortController().signal), /Invalid local cache/);
  }
  assert.equal(requests, before);
  await writeCache(`configuration:${configuration}`, cached);
  assert.deepEqual(await resolveConfiguration(configuration, new AbortController().signal), cached);
  assert.equal(requests, before);
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ v: 1, items: [], nextCursor: null }); });
  await assert.rejects(resolveConfiguration(configuration + 'Miss', new AbortController().signal), /no listed presets/);
  assert.equal(requests, before + 1);
});
