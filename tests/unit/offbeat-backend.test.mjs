import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  createBackend,
  handleDeployedRequest,
} from '../../examples/brutalist-demo/server/backend.mjs';
import { createSessions } from '../../examples/brutalist-demo/server/auth.mjs';
import {
  readConfig,
  createPool,
} from '../../examples/brutalist-demo/server/config.mjs';
import {
  SyntheticProvider,
  SyntheticStore,
  testConfig as config,
} from '../fixtures/offbeat-backend.mjs';
import { manifest } from '../../examples/brutalist-demo/capabilities.mjs';
import { OpenAiCompatibleProvider } from '../../packages/server/dist/index.js';

const fixture = JSON.parse(
  await readFile(
    new URL('../fixtures/conformance.json', import.meta.url),
    'utf8',
  ),
);
const payload = {
  ...fixture.request,
  capabilityIds: manifest.capabilities.map((c) => c.id),
  message: 'Hello',
};
function request(route, body, headers = {}, method = 'POST') {
  return new Request(config.origin + '/api/' + route, {
    method,
    headers: {
      origin: config.origin,
      'Content-Type': 'application/json',
      ...headers,
    },
    ...(body === undefined
      ? {}
      : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
async function login(backend) {
  const response = await backend.handle(
    request('session', { accessCode: config.accessCode }),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const data = await response.json();
  return {
    cookie: response.headers.get('set-cookie').split(';')[0],
    'x-csrf-token': data.csrfToken,
  };
}

test('OFFBEAT config is environment-owned and rejects insecure/missing configuration', async () => {
  const env = {
    PAGESQUIRE_PROVIDER_URL: 'https://provider.example/v1/chat/completions',
    PAGESQUIRE_MODEL: 'model-one',
    PAGESQUIRE_API_KEY: 'synthetic-key',
    PAGESQUIRE_SESSION_SECRET: config.sessionSecret,
    PAGESQUIRE_DEMO_ACCESS_CODE: config.accessCode,
    PAGESQUIRE_DATABASE_URL: 'postgres://owner:fake@db.example/postgres',
    PAGESQUIRE_PUBLIC_ORIGIN: config.origin,
    PAGESQUIRE_STORAGE_DRIVER: 'supabase-postgres',
  };
  assert.equal(readConfig(env).model, 'model-one');
  assert.equal(
    readConfig({ ...env, PAGESQUIRE_MODEL: 'replacement-model' }).model,
    'replacement-model',
  );
  for (const [key, value] of [
    ['PAGESQUIRE_MODEL', ''],
    ['PAGESQUIRE_PROVIDER_URL', 'http://provider.example/'],
    ['PAGESQUIRE_PROVIDER_URL', 'https://user:secret@provider.example/'],
    ['PAGESQUIRE_STORAGE_DRIVER', 'memory'],
    ['PAGESQUIRE_SESSION_SECRET', 'short'],
    ['PAGESQUIRE_PUBLIC_ORIGIN', 'https://example.com/path'],
    ['PAGESQUIRE_DAILY_REQUEST_LIMIT', '0'],
    ['PAGESQUIRE_API_KEY', 'key\r\nsecret'],
  ])
    assert.throws(() => readConfig({ ...env, [key]: value }));
  const pool = createPool(
    'postgres://owner:fake@db.example/postgres?sslmode=disable',
  );
  assert.equal(pool.options.ssl.rejectUnauthorized, true);
  assert.doesNotMatch(pool.options.connectionString, /sslmode/);
  await pool.end();
  const missing = await handleDeployedRequest(
    new Request(config.origin + '/api/session'),
  );
  assert.equal(missing.status, 503);
  assert.doesNotMatch(await missing.text(), /synthetic-key|postgres:\/\//);
});

test('OFFBEAT signed sessions reject tampering, duplicate cookies, expiry and access-code rotation', () => {
  let time = 1000;
  const sessions = createSessions({ ...config, secure: true }, () => time);
  const created = sessions.create();
  assert.match(created.cookie, /^__Host-pagesquire_session=/);
  for (const attribute of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/'])
    assert.ok(created.cookie.includes(attribute));
  const cookie = created.cookie.split(';')[0];
  const read = (value) =>
    sessions.read(new Request(config.origin, { headers: { cookie: value } }));
  assert.equal(read(cookie).csrfToken, created.csrfToken);
  assert.equal(read(cookie + 'x'), null);
  assert.equal(read(cookie + ';' + cookie), null);
  assert.equal(
    createSessions(
      { ...config, secure: true, accessCode: 'changed-owner-code' },
      () => time,
    ).read(new Request(config.origin, { headers: { cookie } })),
    null,
  );
  time += 3601;
  assert.equal(read(cookie), null);
  assert.match(sessions.clear(), /Max-Age=0/);
  const ignored = createSessions(config);
  assert.equal(
    ignored.clientKey(
      request('session', undefined, { 'x-forwarded-for': '1.1.1.1' }),
    ),
    ignored.clientKey(request('session')),
  );
  const trusted = createSessions({ ...config, trustVercel: true });
  assert.notEqual(
    trusted.clientKey(
      request('session', undefined, { 'x-vercel-forwarded-for': '1.1.1.1' }),
    ),
    trusted.clientKey(
      request('session', undefined, { 'x-vercel-forwarded-for': '2.2.2.2' }),
    ),
  );
});

test('OFFBEAT backend fails closed on auth, CSRF, origin, method, body and storage failures', async () => {
  const store = new SyntheticStore();
  const provider = new SyntheticProvider();
  const backend = createBackend({ config, store, provider });
  assert.deepEqual(
    await (
      await backend.handle(new Request(config.origin + '/api/session'))
    ).json(),
    { available: true, authenticated: false },
  );
  assert.equal((await backend.handle(request('chat', payload))).status, 403);
  assert.equal(
    (
      await backend.handle(
        request(
          'session',
          { accessCode: config.accessCode },
          { origin: 'https://evil.example' },
        ),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await backend.handle(
        request('session', {}, { 'Content-Type': 'text/plain' }),
      )
    ).status,
    415,
  );
  assert.equal(
    (await backend.handle(request('session', 'x'.repeat(2000)))).status,
    400,
  );
  assert.equal(
    (await backend.handle(request('session', { accessCode: 'wrong' }))).status,
    403,
  );
  const headers = await login(backend);
  assert.equal(
    (await backend.handle(request('chat', payload, { cookie: headers.cookie })))
      .status,
    419,
  );
  assert.equal(
    (await backend.handle(request('chat', {}, headers))).status,
    422,
  );
  assert.equal(
    (await backend.handle(request('chat', 'x'.repeat(200000), headers))).status,
    413,
  );
  assert.equal(
    (await backend.handle(request('chat', undefined, {}, 'GET'))).status,
    405,
  );
  assert.equal(
    (
      await backend.handle(request('session', undefined, {}, 'PATCH'))
    ).headers.get('allow'),
    'GET, POST, DELETE',
  );
  assert.equal((await backend.handle(request('missing'))).status, 404);
  assert.equal(provider.calls, 0);
  const result = await backend.handle(
    request('session', undefined, headers, 'DELETE'),
  );
  assert.match(result.headers.get('set-cookie'), /Max-Age=0/);
  store.consume = async () => {
    throw Error('private-db-password');
  };
  const unavailable = await backend.handle(request('chat', payload, headers));
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /private-db-password/);
});

test('OFFBEAT uses the real engine, caches retry proposals and durably charges failed provider calls', async () => {
  const store = new SyntheticStore();
  const provider = new SyntheticProvider();
  const backend = createBackend({ config, store, provider });
  const headers = await login(backend);
  const input = { ...payload, message: 'Make headings red' };
  const first = await (
    await backend.handle(request('chat', input, headers))
  ).json();
  assert.equal(first.response.emotion, 'thinking');
  assert.equal(
    first.response.toolCalls[0].capabilityId,
    'accessibility.set_heading_color',
  );
  assert.deepEqual(first.response.toolCalls[0].parameters, {
    color: '#c52b28',
  });
  assert.doesNotMatch(JSON.stringify(first), /Premature success/);
  assert.deepEqual(
    await (await backend.handle(request('chat', input, headers))).json(),
    first,
  );
  assert.equal(provider.calls, 1);
  provider.complete = async () => {
    throw Error('private-provider-key');
  };
  const failure = await backend.handle(
    request('chat', { ...payload, requestId: 'failed-request' }, headers),
  );
  assert.equal(failure.status, 502);
  assert.doesNotMatch(await failure.text(), /private-provider-key/);
  assert.equal(store.counters.get('provider:global:day').count, 2);
  const saved = [...store.values.values()][0];
  assert.equal(saved.state.attempts, 1);
  assert.equal(
    (
      await backend.handle(
        request('chat', { ...payload, requestId: 'failed-request' }, headers),
      )
    ).status,
    409,
  );
});

test('OFFBEAT shared provider and login quotas do not reset on a new backend instance', async () => {
  const store = new SyntheticStore();
  const provider = new SyntheticProvider();
  const create = () =>
    createBackend({ config: { ...config, dailyLimit: 1 }, store, provider });
  const headers = await login(create());
  assert.equal(
    (await create().handle(request('chat', payload, headers))).status,
    200,
  );
  const denied = await create().handle(
    request('chat', { ...payload, requestId: 'quota-request' }, headers),
  );
  assert.equal(denied.status, 429);
  assert.ok(denied.headers.has('retry-after'));
  assert.equal(provider.calls, 1);
  for (let index = 0; index < 4; index++)
    assert.equal(
      (await create().handle(request('session', { accessCode: 'wrong' })))
        .status,
      403,
    );
  assert.equal(
    (
      await create().handle(
        request('session', { accessCode: config.accessCode }),
      )
    ).status,
    429,
  );
});

test('OFFBEAT configured model is sent by the actual server provider without retries or client secrets', async () => {
  let calls = 0;
  const provider = new OpenAiCompatibleProvider({
    endpoint: 'https://provider.example/v1/chat/completions',
    model: 'owner-replacement-model',
    apiKey: 'synthetic-key',
    fetch: async (_url, options) => {
      calls++;
      assert.equal(JSON.parse(options.body).model, 'owner-replacement-model');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-key');
      assert.equal(options.redirect, 'error');
      return new Response('private-provider-error', { status: 429 });
    },
  });
  await assert.rejects(provider.complete([], [], 100), {
    code: 'PROVIDER_UNAVAILABLE',
  });
  assert.equal(calls, 1);
});
