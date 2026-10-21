import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  OpenAiCompatibleProvider,
  listProviderPresets,
  providerConfigurationFromEnv,
  resolveProviderConfiguration,
  completionRequest,
  decodeCompletion,
} from '@pagesquire/server';
import { validateProviderResponse } from '@pagesquire/protocol';

const final = {
  text: 'Hello',
  emotion: 'happy',
  finished: true,
  toolCalls: [],
};
const wrap = (content) => ({
  choices: [{ finish_reason: 'stop', message: { content } }],
});

test('database checks and migrations do not require compiled AI packages on a clean CI checkout', async () => {
  const database = await readFile(
    'examples/brutalist-demo/server/database.mjs',
    'utf8',
  );
  assert.doesNotMatch(database, /packages\/|\/dist\/|config\.mjs/);
  for (const path of [
    'tests/database/offbeat.test.mjs',
    'scripts/migrate-offbeat.mjs',
  ]) {
    const source = await readFile(path, 'utf8');
    assert.doesNotMatch(source, /server\/config\.mjs|\/dist\//);
    assert.match(
      source,
      path.startsWith('tests/')
        ? /fixtures\/disposable-postgres\.mjs/
        : /server\/database\.mjs/,
    );
  }
  const privacy = await readFile('packages/server/src/privacy.ts', 'utf8');
  assert.doesNotMatch(privacy, /^import(?! type )/m);
  const unbuiltPrivacy = await import('../../packages/server/src/privacy.ts');
  assert.equal(typeof unbuiltPrivacy.forgetConversation, 'function');
  const { createPool } =
    await import('../../examples/brutalist-demo/server/database.mjs');
  assert.equal(typeof createPool, 'function');
});
for (const preset of listProviderPresets())
  test(`provider preset ${preset.id} sends one bounded, owner-model request without hidden defaults or retries`, async () => {
    let calls = 0;
    const provider = new OpenAiCompatibleProvider({
      provider: preset.id,
      endpoint: preset.endpoint || 'https://gateway.test/v1/chat/completions',
      model: 'owner-selected-model',
      apiKey: 'synthetic-key',
      fetch: async (url, init) => {
        calls++;
        assert.equal(
          String(url),
          preset.endpoint || 'https://gateway.test/v1/chat/completions',
        );
        assert.equal(init.redirect, 'error');
        assert.equal(init.headers.Authorization, 'Bearer synthetic-key');
        const body = JSON.parse(init.body);
        assert.equal(body.model, 'owner-selected-model');
        assert.equal(body[preset.tokenParameter], 500);
        assert.equal(body.stream, false);
        assert.deepEqual(
          body.response_format,
          preset.responseMode === 'prompt'
            ? undefined
            : { type: 'json_object' },
        );
        assert.equal(body.tools, undefined);
        return Response.json(wrap(JSON.stringify(final)));
      },
    });
    assert.deepEqual(await provider.complete([], [], 500), final);
    assert.equal(calls, 1);
  });

test('provider catalog is canonical, immutable by callers and packaged with Node', async () => {
  const source = await readFile('packages/server/src/providers.ts', 'utf8');
  assert.doesNotMatch(source, /readFileSync|import\.meta\.url/);
  const next = await readFile('examples/nextjs/next.config.mjs', 'utf8');
  assert.match(next, /transpilePackages: \['@pagesquire\/server'\]/);
  const canonical = JSON.parse(
    await readFile('packages/php/resources/providers.json', 'utf8'),
  );
  assert.deepEqual(listProviderPresets(), canonical.providers);
  assert.equal(new Set(canonical.providers.map((item) => item.id)).size, 16);
  const copy = listProviderPresets();
  copy[0].id = 'tampered';
  assert.equal(listProviderPresets()[0].id, 'custom');
});

test('server env configuration supports presets and legacy aliases, rejects ambiguity and missing values without keys in errors', () => {
  const env = {
    PAGESQUIRE_PROVIDER: 'groq',
    PAGESQUIRE_MODEL: 'chosen',
    PAGESQUIRE_API_KEY: 'synthetic-private',
  };
  assert.equal(
    providerConfigurationFromEnv(env).endpoint,
    'https://api.groq.com/openai/v1/chat/completions',
  );
  assert.equal(
    providerConfigurationFromEnv({
      PAGESQUIRE_PROVIDER_ENDPOINT: 'https://legacy.test/chat/completions',
      PAGESQUIRE_PROVIDER_KEY: 'legacy-key',
      PAGESQUIRE_PROVIDER_MODEL: 'legacy-model',
    }).provider,
    'custom',
  );
  for (const change of [
    { PAGESQUIRE_PROVIDER: 'invented' },
    { PAGESQUIRE_MODEL: '' },
    { PAGESQUIRE_API_KEY: '' },
    { PAGESQUIRE_PROVIDER_KEY: 'conflicting-secret' },
    { PAGESQUIRE_PROVIDER: 'qwen' },
    { PAGESQUIRE_PROVIDER_URL: 'http://localhost:20128/v1/chat/completions' },
    { PAGESQUIRE_PROVIDER_URL: 'https://provider.test/chat?key=private' },
    { PAGESQUIRE_RESPONSE_MODE: 'auto-retry' },
    { PAGESQUIRE_THINKING: 'disabled' },
  ]) {
    assert.throws(
      () => providerConfigurationFromEnv({ ...env, ...change }),
      (error) =>
        error.code === 'INVALID_PROVIDER_CONFIG' &&
        !/synthetic-private|conflicting-secret/.test(error.message),
    );
  }
});

test('dialect overrides consolidate trusted instructions, preserve user data, and never inject tools or both token fields', () => {
  const config = resolveProviderConfiguration({
    provider: 'qwen',
    endpoint: 'https://workspace.test/compatible-mode/v1/chat/completions',
    apiKey: 'key',
    model: 'chosen',
    responseMode: 'prompt',
    tokenParameter: 'max_completion_tokens',
    systemRole: 'developer',
    thinking: 'disabled',
  });
  const body = completionRequest(
    config,
    [
      { role: 'system', content: 'First' },
      { role: 'user', content: 'Untrusted' },
      { role: 'system', content: 'Second' },
    ],
    100,
  );
  assert.deepEqual(body.messages, [
    { role: 'developer', content: 'First\n\nSecond' },
    { role: 'user', content: 'Untrusted' },
  ]);
  assert.equal(body.response_format, undefined);
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.max_completion_tokens, 100);
  assert.equal(body.enable_thinking, false);
  assert.throws(() => completionRequest(config, [], 4097), {
    code: 'INVALID_PROVIDER_CONFIG',
  });
});

test('response normalization accepts only complete JSON or a whole JSON fence, including text parts, while strict action validation remains authoritative', () => {
  for (const content of [
    JSON.stringify(final),
    '```json\n' + JSON.stringify(final) + '\n```',
    [{ type: 'text', text: JSON.stringify(final) }],
  ]) {
    assert.deepEqual(decodeCompletion(wrap(content)), final);
  }
  for (const envelope of [
    wrap('Here is JSON: ' + JSON.stringify(final)),
    wrap('[]'),
    wrap('{bad'),
    wrap([{ type: 'image_url', image_url: 'private' }]),
    wrap('x'.repeat(65537)),
    { ...wrap(JSON.stringify(final)), choices: [] },
    {
      choices: [
        {
          finish_reason: 'length',
          message: { content: JSON.stringify(final) },
        },
      ],
    },
    {
      choices: [{ message: { refusal: 'no', content: JSON.stringify(final) } }],
    },
    {
      choices: [
        { message: { content: JSON.stringify(final), tool_calls: [{}] } },
      ],
    },
  ])
    assert.throws(() => decodeCompletion(envelope), {
      code: 'INVALID_PROVIDER_RESPONSE',
    });
  const unknown = decodeCompletion(
    wrap(JSON.stringify({ ...final, selector: 'body' })),
  );
  assert.equal(validateProviderResponse(unknown).valid, false);
});
