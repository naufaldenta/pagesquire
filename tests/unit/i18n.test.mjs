import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AssistantClient,
  createHttpTransport,
  describeActionProgress,
  en,
  format,
  id,
  localeFor,
  resolveMessages,
} from '../../packages/client/dist/index.js';
import { ConversationEngine, ENGINE_TEXT } from '@pagesquire/server';

test('English and Indonesian packs cover the same keys with non-empty text and placeholders', () => {
  assert.deepEqual(Object.keys(id).sort(), Object.keys(en).sort());
  for (const [key, value] of Object.entries(id)) {
    assert.ok(value.trim(), key);
    const placeholders = (text) => (text.match(/\{\w+\}/g) ?? []).sort();
    assert.deepEqual(placeholders(value), placeholders(en[key]), key);
  }
  assert.deepEqual(
    Object.keys(ENGINE_TEXT.id).sort(),
    Object.keys(ENGINE_TEXT.en).sort(),
  );
});

test('locale detection follows language tags and overrides replace single keys', () => {
  assert.equal(localeFor('id-ID'), 'id');
  assert.equal(localeFor('in'), 'id');
  assert.equal(localeFor('en-GB'), 'en');
  assert.equal(localeFor('fr'), 'en');
  assert.equal(localeFor(undefined), 'en');
  const document = { documentElement: { lang: 'id' } };
  assert.equal(resolveMessages({}, document)['widget.send'], 'Kirim');
  assert.equal(
    resolveMessages({ locale: 'en' }, document)['widget.send'],
    'Send',
  );
  const custom = resolveMessages(
    { locale: 'id', messages: { 'widget.send': 'Tanya', unknown: 'x' } },
    document,
  );
  assert.equal(custom['widget.send'], 'Tanya');
  assert.equal(custom['widget.stop'], 'Hentikan');
  assert.equal('unknown' in custom, false);
  assert.equal(
    format('{stage}: {capability} {missing}', { stage: 'A', capability: 'B' }),
    'A: B {missing}',
  );
});

test('progress, transport and client errors use the chosen language', async () => {
  assert.deepEqual(describeActionProgress({ stage: 'verified' }, id), {
    label: 'Terverifikasi',
    message: id['stage.verified.help'],
  });
  assert.equal(
    describeActionProgress({ stage: 'failed', code: 'TARGET_COVERED' }, id)
      .message,
    id['recovery.element'],
  );
  assert.equal(
    describeActionProgress({ stage: 'failed', code: 'APPROVAL_DENIED' })
      .message,
    en['recovery.approval'],
  );
  const transport = createHttpTransport({
    locale: 'id',
    endpoint: '/chat',
    baseUrl: 'https://example.test/',
    csrfToken: () => 'token',
    fetch: async () =>
      new Response('{"error":{"code":"RATE_LIMITED"}}', { status: 429 }),
  });
  await assert.rejects(
    transport({}, new AbortController().signal),
    (error) => error.message === id['error.http429'],
  );
  const client = new AssistantClient({
    locale: 'id',
    runtime: {
      observe: () => ({
        protocolVersion: '0.1',
        id: 'snapshot',
        url: 'https://example.test/',
        title: '',
        text: '',
        targets: [],
        truncated: { text: false, targets: false },
      }),
      registry: { list: () => [] },
      resetSession() {},
    },
    transport: async () => {
      throw new Error('boom');
    },
  });
  await client.send('Halo');
  assert.equal(client.state.messages.at(-1).text, id['client.unexpected']);
  await assert.rejects(client.send(' '), {
    message: id['client.invalidMessage'],
  });
});

test('engine fixed replies follow the engine locale', async () => {
  const manifest = {
    schemaVersion: '0.1',
    capabilities: [
      {
        id: 'testing.set',
        description: 'Set state.',
        execution: 'browser',
        handler: 'set',
        verification: { handler: 'verify' },
        risk: 'reversible',
        inputSchema: {
          type: 'object',
          properties: { enabled: { type: 'boolean' } },
          required: ['enabled'],
          additionalProperties: false,
        },
      },
    ],
  };
  const engine = new ConversationEngine({
    manifest,
    locale: 'id',
    maxAttempts: 1,
    provider: {
      async complete() {
        return {
          text: 'Halo',
          emotion: 'happy',
          finished: true,
          toolCalls: [],
        };
      },
    },
  });
  const snapshot = {
    protocolVersion: '0.1',
    id: 'snapshot',
    url: 'https://example.test/',
    title: '',
    text: '',
    targets: [],
    truncated: { text: false, targets: false },
  };
  const first = await engine.handle(
    {
      protocolVersion: '0.1',
      requestId: 'r1',
      message: 'Halo',
      snapshot,
      capabilityIds: ['testing.set'],
    },
    null,
    ['testing.set'],
  );
  const limited = await engine.handle(
    {
      protocolVersion: '0.1',
      requestId: 'r2',
      conversationId: first.state.id,
      message: 'Lagi',
      snapshot,
      capabilityIds: ['testing.set'],
    },
    first.state,
    ['testing.set'],
  );
  assert.equal(limited.reply.response.text, ENGINE_TEXT.id.limit);
  assert.throws(
    () =>
      new ConversationEngine({
        manifest,
        locale: 'fr',
        provider: { async complete() {} },
      }),
    { code: 'INVALID_OPTIONS' },
  );
});
