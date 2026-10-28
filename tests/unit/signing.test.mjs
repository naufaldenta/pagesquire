import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { validateChatReply } from '@pagesquire/protocol';
import { createGenericCapabilities } from '../../packages/core/dist/index.js';
import {
  ConversationEngine,
  createSigningKey,
  signActionCall,
  signingPublicKey,
  siteDeclaration,
  verifyActionCall,
} from '@pagesquire/server';
import {
  UsedCalls,
  validateSiteManifest,
  verifySignedAction,
} from '../../packages/extension/src/policy.js';

const vector = JSON.parse(
  await readFile(new URL('../fixtures/signing.json', import.meta.url)),
);
const origin = 'http://shop.test';
const signing = { key: vector.signingKey, origin };
const call = {
  protocolVersion: '0.1',
  callId: 'c'.repeat(32),
  capabilityId: 'ui.type',
  snapshotId: 'snapshot-1',
  parameters: { target: 'target-1', text: 'Ada', clear: true },
};

test('keys follow the shared test vector', () => {
  assert.equal(signingPublicKey(vector.signingKey), vector.publicKey);
  const vectorCall = {
    ...call,
    ...JSON.parse(vector.claims),
    protocolVersion: '0.1',
    signature: { claims: vector.claims, value: vector.signature },
  };
  assert.ok(
    verifyActionCall(vectorCall, vector.publicKey, origin, 1830000010 * 1000),
  );
  const fresh = createSigningKey();
  assert.equal(signingPublicKey(fresh.signingKey), fresh.publicKey);
  assert.match(fresh.publicKey, /^ed25519:[A-Za-z0-9+/]{43}=$/);
});

test('signed calls carry their claims and verify only as issued', async () => {
  const now = Date.UTC(2026, 9, 28);
  const signed = signActionCall(call, signing, now);
  const claims = JSON.parse(signed.signature.claims);
  assert.deepEqual(claims, {
    v: 1,
    origin,
    callId: call.callId,
    capabilityId: 'ui.type',
    snapshotId: 'snapshot-1',
    parameters: call.parameters,
    iat: now / 1000,
    exp: now / 1000 + 60,
  });
  assert.ok(verifyActionCall(signed, vector.publicKey, origin, now));
  assert.equal(
    verifyActionCall(signed, vector.publicKey, 'http://evil.test', now),
    undefined,
  );
  assert.equal(
    verifyActionCall(
      { ...signed, parameters: { ...call.parameters, text: 'Eve' } },
      vector.publicKey,
      origin,
      now,
    ),
    undefined,
  );
  assert.equal(
    verifyActionCall(signed, vector.publicKey, origin, now + 181_000),
    undefined,
  );
  // The extension's own check accepts what the Node server signed.
  const verified = await verifySignedAction({
    signature: signed.signature,
    publicKey: vector.publicKey,
    origin,
    args: { kind: 'type', text: 'Ada' },
    now,
  });
  assert.equal(verified.claims.callId, call.callId);
  assert.equal(
    new UsedCalls().use(verified.claims.callId, claims.exp, now),
    true,
  );
});

test('the site declaration is what the extension accepts', () => {
  const declaration = siteDeclaration({
    endpoint: '/pagesquire/chat',
    signingKey: vector.signingKey,
  });
  assert.deepEqual(validateSiteManifest(declaration).value, {
    ...declaration,
    frames: [],
  });
});

test('the engine signs proposed calls when configured', async () => {
  const manifest = {
    schemaVersion: '0.1',
    capabilities: createGenericCapabilities(),
  };
  const provider = {
    async complete() {
      return {
        text: 'Typing',
        emotion: 'thinking',
        finished: false,
        toolCalls: [
          {
            capabilityId: 'ui.type',
            parameters: { target: 'target-1', text: 'Ana', clear: true },
          },
        ],
      };
    },
  };
  const engine = new ConversationEngine({ manifest, provider, signing });
  const { reply, state } = await engine.handle(
    {
      protocolVersion: '0.1',
      requestId: 'r1',
      message: 'Set my name to Ana',
      snapshot: {
        protocolVersion: '0.1',
        id: 'snapshot-1',
        url: 'http://shop.test/profile',
        title: 'Profile',
        text: 'Profile form',
        targets: [
          {
            id: 'target-1',
            tag: 'input',
            name: 'Your name',
            role: 'textbox',
            disabled: false,
            actionable: true,
          },
        ],
        truncated: { text: false, targets: false },
      },
      capabilityIds: manifest.capabilities.map((entry) => entry.id),
    },
    null,
    manifest.capabilities.map((entry) => entry.id),
  );
  assert.equal(validateChatReply(reply).valid, true);
  const [proposed] = reply.response.toolCalls;
  assert.ok(verifyActionCall(proposed, vector.publicKey, origin));
  // Stored state keeps the plain call; only the reply carries the signature.
  assert.equal(state.pending.signature, undefined);
  assert.equal(state.pending.callId, proposed.callId);
});

test('invalid signing options fail at construction', () => {
  const manifest = { schemaVersion: '0.1', capabilities: [] };
  const provider = { async complete() {} };
  for (const bad of [
    { key: 'short', origin },
    { key: `${vector.signingKey}x`, origin },
    { key: vector.signingKey, origin: 'http://shop.test/path' },
    { key: vector.signingKey, origin: 'ftp://shop.test' },
    { key: vector.signingKey, origin: 'not a url' },
  ])
    assert.throws(
      () => new ConversationEngine({ manifest, provider, signing: bad }),
      { code: 'INVALID_OPTIONS' },
      JSON.stringify(bad),
    );
});

test('the CLI prints a fresh signing key pair and stores nothing', async () => {
  const { run } = await import('../../packages/cli/dist/bin.js');
  const first = await run(['signing-key']);
  const second = await run(['signing-key']);
  assert.equal(signingPublicKey(first.signingKey), first.publicKey);
  assert.notEqual(first.signingKey, second.signingKey);
  await assert.rejects(run(['signing-key', '--root', '.']), {
    code: 'INVALID_OPTIONS',
  });
});

test('in frames the signature binds the target ID and the clear flag', async () => {
  const now = Date.UTC(2026, 9, 28);
  const signedFor = (capabilityId, parameters) =>
    signActionCall({ ...call, capabilityId, parameters }, signing, now)
      .signature;
  const check = (signature, args) =>
    verifySignedAction({
      signature,
      publicKey: vector.publicKey,
      origin,
      args,
      now,
    }).then((result) => result.code);
  const click = signedFor('ui.click', { target: 'frame1-target-3' });
  const frameClick = { kind: 'click', frame: 'frame1', target: 'target-3' };
  assert.equal(await check(click, frameClick), undefined);
  assert.equal(
    await check(click, { ...frameClick, target: 'target-4' }),
    'MISMATCH',
  );
  assert.equal(
    await check(click, { ...frameClick, frame: 'frame2' }),
    'MISMATCH',
  );
  // A frame signature cannot drive a page target, nor the reverse.
  assert.equal(
    await check(click, { kind: 'click', nonce: 'a'.repeat(32) }),
    'MISMATCH',
  );
  assert.equal(
    await check(signedFor('ui.click', { target: 'target-3' }), frameClick),
    'MISMATCH',
  );
  const type = signedFor('ui.type', {
    target: 'frame1-target-3',
    text: 'Ada',
    clear: true,
  });
  const frameType = { ...frameClick, kind: 'type', text: 'Ada', clear: true };
  assert.equal(await check(type, frameType), undefined);
  assert.equal(await check(type, { ...frameType, clear: false }), 'MISMATCH');
});

test('tab switches and tab targets are bound by the signature', async () => {
  const now = Date.UTC(2026, 9, 28);
  const signedFor = (capabilityId, parameters) =>
    signActionCall({ ...call, capabilityId, parameters }, signing, now)
      .signature;
  const check = (signature, args) =>
    verifySignedAction({
      signature,
      publicKey: vector.publicKey,
      origin,
      args,
      now,
    }).then((result) => result.code);
  const toTab2 = signedFor('ui.switch_tab', { tab: 'tab2' });
  assert.equal(await check(toTab2, { kind: 'switch', tab: 'tab2' }), undefined);
  assert.equal(
    await check(toTab2, { kind: 'switch', tab: 'tab1' }),
    'MISMATCH',
  );
  assert.equal(
    await check(toTab2, { kind: 'click', nonce: 'a'.repeat(32) }),
    'MISMATCH',
  );
  const click = signedFor('ui.click', { target: 'tab2-target-1' });
  assert.equal(
    await check(click, { kind: 'click', frame: 'tab2', target: 'target-1' }),
    undefined,
  );
  assert.equal(
    await check(click, { kind: 'click', frame: 'tab3', target: 'target-1' }),
    'MISMATCH',
  );
  assert.equal(
    await check(click, { kind: 'click', nonce: 'a'.repeat(32) }),
    'MISMATCH',
  );
});
