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
const toolCapabilities = [
  {
    id: 'accessibility.set_heading_color',
    description: 'Change heading color only.',
    execution: 'browser',
    handler: 'headings',
    verification: { handler: 'verifyHeadings' },
    risk: 'reversible',
    inputSchema: {
      type: 'object',
      properties: { color: { type: 'string' } },
      required: ['color'],
      additionalProperties: false,
    },
  },
];
const toolConfig = resolveProviderConfiguration({
  provider: 'openai',
  apiKey: 'synthetic-key',
  model: 'owner-selected-model',
  responseMode: 'tools',
});
test('tools mode sends approved capabilities as native functions with dot-free names', () => {
  const body = completionRequest(
    toolConfig,
    [
      { role: 'system', content: 'Trusted instructions.' },
      { role: 'user', content: 'Make headings red.' },
    ],
    500,
    toolCapabilities,
  );
  assert.equal(body.response_format, undefined);
  assert.deepEqual(body.tools, [
    {
      type: 'function',
      function: {
        name: 'accessibility_set_heading_color',
        description: 'Change heading color only.',
        parameters: toolCapabilities[0].inputSchema,
      },
    },
  ]);
  assert.match(body.messages[0].content, /Tool mode: to act, call exactly one/);
  assert.equal(
    completionRequest(toolConfig, [], 500, []).tools,
    undefined,
    'No tools are offered when nothing is approved',
  );
});
test('tools mode decodes only the first known tool call and turns plain text into a tool-free final reply', () => {
  const call = (name, args, extra = {}) => ({
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          content: null,
          tool_calls: [
            { type: 'function', function: { name, arguments: args } },
            {
              type: 'function',
              function: {
                name: 'accessibility_set_heading_color',
                arguments: '{"color":"#00ff00"}',
              },
            },
          ],
          ...extra,
        },
      },
    ],
  });
  const draft = decodeCompletion(
    call('accessibility_set_heading_color', '{"color":"#ff0000"}'),
    toolConfig,
    toolCapabilities,
  );
  assert.deepEqual(draft.toolCalls, [
    {
      capabilityId: 'accessibility.set_heading_color',
      parameters: { color: '#ff0000' },
    },
  ]);
  assert.equal(draft.finished, false);
  assert.equal(validateProviderResponse(draft).valid, true);
  for (const invalid of [
    call('unknown_capability', '{}'),
    call('accessibility_set_heading_color', '[1]'),
    call('accessibility_set_heading_color', '{broken'),
    call('accessibility_set_heading_color', '{}', { refusal: 'No.' }),
  ])
    assert.throws(
      () => decodeCompletion(invalid, toolConfig, toolCapabilities),
      {
        code: 'INVALID_PROVIDER_RESPONSE',
      },
    );
  assert.deepEqual(
    decodeCompletion(
      wrap('Headings are already red.'),
      toolConfig,
      toolCapabilities,
    ),
    {
      text: 'Headings are already red.',
      emotion: 'idle',
      finished: true,
      toolCalls: [],
    },
  );
  assert.deepEqual(
    decodeCompletion(wrap(JSON.stringify(final)), toolConfig, toolCapabilities),
    final,
  );
  assert.throws(
    () =>
      decodeCompletion(
        { choices: [{ finish_reason: 'length', message: { content: 'Cut' } }] },
        toolConfig,
        toolCapabilities,
      ),
    { code: 'INVALID_PROVIDER_RESPONSE' },
  );
});
test('provider diagnostics report outcome, status, latency and token usage without content or keys', async () => {
  const events = [];
  const respond = (status, body) => async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const make = (fetch) =>
    new OpenAiCompatibleProvider({
      provider: 'openai',
      apiKey: 'secret-key-marker',
      model: 'owner-selected-model',
      fetch,
      onDiagnostic: (event) => {
        events.push(event);
        throw new Error('A failing hook must not change the outcome');
      },
    });
  const reply = await make(
    respond(200, {
      ...wrap(JSON.stringify(final)),
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    }),
  ).complete([{ role: 'user', content: 'prompt-marker' }], [], 100);
  assert.deepEqual(reply, final);
  await assert.rejects(
    make(respond(429, { error: { message: 'body-marker' } })).complete(
      [],
      [],
      100,
    ),
    { code: 'PROVIDER_UNAVAILABLE' },
  );
  await assert.rejects(
    make(respond(200, wrap('not json'))).complete([], [], 100),
    {
      code: 'INVALID_PROVIDER_RESPONSE',
    },
  );
  await assert.rejects(
    make(async () => {
      throw new TypeError('network-marker');
    }).complete([], [], 100),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    make(() => new Promise(() => {})).complete([], [], 100, controller.signal),
  );
  assert.deepEqual(
    events.map(({ latencyMs, ...event }) => {
      assert.ok(Number.isInteger(latencyMs) && latencyMs >= 0);
      return event;
    }),
    [
      {
        outcome: 'ok',
        status: 200,
        usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
      },
      { outcome: 'http_error', status: 429 },
      { outcome: 'invalid_response', status: 200 },
      { outcome: 'network_error' },
      { outcome: 'cancelled' },
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(events),
    /secret-key-marker|prompt-marker|body-marker|network-marker/,
  );
});
