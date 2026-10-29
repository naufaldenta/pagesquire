import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  KEYS,
  RateLimiter,
  auditEntry,
  invalidAction,
  isTestOrigin,
  originPattern,
  sensitiveReason,
  validateSiteManifest,
  verifySignedAction,
  UsedCalls,
  deniedFrame,
  frameScope,
} from '../../packages/extension/src/policy.js';

const vector = JSON.parse(
  await readFile(new URL('../fixtures/signing.json', import.meta.url)),
);

const nonce = 'a'.repeat(32);

test('the development build qualifies only local and .test origins', () => {
  for (const origin of [
    'http://localhost:3000',
    'https://localhost',
    'http://127.0.0.1:8080',
    'http://shop.localhost',
    'https://shop.test',
  ])
    assert.equal(isTestOrigin(origin), true, origin);
  for (const origin of [
    'https://example.com',
    'http://localhost.example.com',
    'http://test',
    'https://shop.test.example.com',
    'http://10.0.0.1',
    'http://[::1]:3000',
    'file:///tmp/a.html',
    'chrome://settings',
    'not a url',
  ])
    assert.equal(isTestOrigin(origin), false, origin);
});

test('every qualifying host is covered by a manifest host permission', async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL('../../packages/extension/manifest.json', import.meta.url),
    ),
  );
  for (const origin of [
    'http://localhost:3000',
    'https://127.0.0.1',
    'http://shop.localhost',
    'https://shop.test',
  ])
    assert.ok(
      manifest.host_permissions.includes(originPattern(origin)) ||
        manifest.host_permissions.includes(
          originPattern(origin).replace(/\/\/[^.]+\./, '//*.'),
        ),
      origin,
    );
  // No remote code, no blanket host access.
  assert.equal(manifest.manifest_version, 3);
  assert.ok(!manifest.host_permissions.includes('<all_urls>'));
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.externally_connectable, undefined);
});

test('content-script patterns drop the port; the worker checks exact origins', () => {
  assert.equal(originPattern('http://localhost:3000'), 'http://localhost/*');
  assert.equal(originPattern('https://shop.test'), 'https://shop.test/*');
});

test('site manifests are validated strictly and must publish a key', () => {
  const key = `ed25519:${Buffer.alloc(32, 1).toString('base64')}`;
  assert.deepEqual(
    validateSiteManifest({ version: 1, endpoint: '/api/chat', publicKey: key })
      .value,
    {
      version: 1,
      endpoint: '/api/chat',
      publicKey: key,
      frames: [],
      features: ['trustedInput'],
    },
  );
  assert.equal(
    validateSiteManifest({
      version: 1,
      endpoint: '/chat',
      publicKey: key,
      frames: ['https://maps.example.com'],
      features: ['trustedInput', 'frames'],
    }).valid,
    true,
  );
  // A PageSquire Link section is for partner servers: accepted, then left out.
  assert.deepEqual(
    validateSiteManifest({
      version: 1,
      endpoint: '/chat',
      publicKey: key,
      features: ['trustedInput', 'link'],
      link: { endpoint: '/pagesquire/link', name: 'Shop', skills: [] },
    }).value,
    {
      version: 1,
      endpoint: '/chat',
      publicKey: key,
      frames: [],
      features: ['trustedInput', 'link'],
    },
  );
  // Without a key a declaration is invalid; every other case fails even with one.
  assert.equal(
    validateSiteManifest({ version: 1, endpoint: '/chat' }).valid,
    false,
  );
  for (const bad of [null, []])
    assert.equal(validateSiteManifest(bad).valid, false);
  for (const bad of [
    { endpoint: '/chat' },
    { version: 2, endpoint: '/chat' },
    { version: 1, endpoint: 'https://evil.example/chat' },
    { version: 1, endpoint: '//evil.example/chat' },
    { version: 1, endpoint: '/chat', extra: true },
    { version: 1, endpoint: '/chat', publicKey: 'rsa:abc' },
    { version: 1, endpoint: '/chat', frames: ['https://a.example/path'] },
    { version: 1, endpoint: '/chat', frames: ['javascript:alert(1)'] },
    { version: 1, endpoint: '/chat', features: [] },
    { version: 1, endpoint: '/chat', features: ['everything'] },
    { version: 1, endpoint: '/chat', features: ['frames', 'frames'] },
    { version: 1, endpoint: '/chat', link: 'yes' },
    { version: 1, endpoint: '/chat', link: [] },
  ])
    assert.equal(
      validateSiteManifest({ publicKey: key, ...bad }).valid,
      false,
      JSON.stringify(bad),
    );
});

test('signed actions verify against the shared test vector', async () => {
  const at = (seconds) => seconds * 1000;
  const base = {
    signature: { claims: vector.claims, value: vector.signature },
    publicKey: vector.publicKey,
    origin: 'http://shop.test',
    args: { kind: 'type', text: 'Halo, Ada — café/1' },
    now: at(1830000010),
  };
  const { claims } = await verifySignedAction(base);
  assert.equal(claims.callId, '0123456789abcdef0123456789abcdef');
  const refused = async (change) =>
    (await verifySignedAction({ ...base, ...change })).code;
  assert.equal(await refused({ signature: undefined }), 'UNSIGNED');
  assert.equal(
    await refused({ signature: { claims: vector.claims, value: 'x' } }),
    'UNSIGNED',
  );
  const flipped = `${vector.signature[0] === 'A' ? 'B' : 'A'}${vector.signature.slice(1)}`;
  assert.equal(
    await refused({ signature: { claims: vector.claims, value: flipped } }),
    'BAD_SIGNATURE',
  );
  assert.equal(
    await refused({
      signature: {
        claims: vector.claims.replace('Ada', 'Eve'),
        value: vector.signature,
      },
    }),
    'BAD_SIGNATURE',
  );
  const other = `ed25519:${Buffer.alloc(32, 7).toString('base64')}`;
  assert.equal(await refused({ publicKey: other }), 'BAD_SIGNATURE');
  assert.equal(await refused({ origin: 'http://evil.test' }), 'MISMATCH');
  assert.equal(
    await refused({ args: { kind: 'type', text: 'Eve' } }),
    'MISMATCH',
  );
  assert.equal(await refused({ args: { kind: 'click' } }), 'MISMATCH');
  // Within the clock tolerance either side, then expired or not yet valid.
  assert.equal(await refused({ now: at(1830000060 + 120) }), undefined);
  assert.equal(await refused({ now: at(1830000060 + 121) }), 'EXPIRED');
  assert.equal(await refused({ now: at(1830000000 - 121) }), 'EXPIRED');
});

test('each signed call is used once', () => {
  const used = new UsedCalls();
  assert.equal(used.use('a', 100, 50_000), true);
  assert.equal(used.use('a', 100, 60_000), false);
  assert.equal(used.use('b', 100, 60_000), true);
  // Entries are dropped only once they could no longer verify anyway.
  const restored = new UsedCalls(used.toJSON());
  assert.equal(restored.use('a', 100, 220_000), false);
  assert.equal(restored.use('a', 100, 221_000), true);
});

test('sensitive targets are recognised from CDP node attributes', () => {
  assert.equal(
    sensitiveReason('INPUT', ['type', 'PASSWORD']),
    'password input',
  );
  assert.equal(sensitiveReason('INPUT', ['type', 'file']), 'file input');
  assert.match(
    sensitiveReason('INPUT', ['autocomplete', 'one-time-code']),
    /one-time-code/,
  );
  assert.match(
    sensitiveReason('INPUT', ['autocomplete', 'billing cc-number']),
    /cc-number/,
  );
  assert.equal(
    sensitiveReason('DIV', ['data-pagesquire-private', '']),
    'private region',
  );
  assert.equal(
    sensitiveReason('INPUT', ['type', 'text', 'name', 'q']),
    undefined,
  );
  assert.equal(sensitiveReason('BUTTON', []), undefined);
});

test('action requests are validated and Escape is never sent', () => {
  assert.equal(invalidAction({ kind: 'click', nonce }), undefined);
  assert.equal(invalidAction({ kind: 'type', nonce, text: 'Ada' }), undefined);
  assert.equal(invalidAction({ kind: 'key', nonce, key: 'Enter' }), undefined);
  for (const bad of [
    undefined,
    { kind: 'click' },
    { kind: 'click', nonce: 'short' },
    { kind: 'click', nonce: '"] , body [x="' },
    { kind: 'type', nonce, text: '' },
    { kind: 'type', nonce, text: 'x'.repeat(10001) },
    { kind: 'key', nonce, key: 'Escape' },
    { kind: 'key', nonce, key: 'toString' },
    { kind: 'navigate', nonce },
  ])
    assert.equal(invalidAction(bad), 'BAD_REQUEST', JSON.stringify(bad));
  assert.equal(Object.hasOwn(KEYS, 'Escape'), false);
});

test('the rate limiter slides over one minute per tab', () => {
  const limiter = new RateLimiter(2, 1000);
  assert.equal(limiter.allow(1, 0), true);
  assert.equal(limiter.allow(1, 10), true);
  assert.equal(limiter.allow(1, 20), false);
  assert.equal(limiter.allow(2, 20), true);
  assert.equal(limiter.allow(1, 1001), true);
  limiter.forget(1);
  assert.equal(limiter.allow(1, 1002), true);
});

test('audit entries never keep typed text or targets', () => {
  const entry = auditEntry({
    at: 1,
    origin: 'http://localhost:3000',
    kind: 'type',
    key: 'Enter',
    ok: false,
    code: 'OBSCURED',
    text: 'secret',
    nonce,
  });
  assert.deepEqual(entry, {
    at: 1,
    origin: 'http://localhost:3000',
    kind: 'type',
    ok: false,
    code: 'OBSCURED',
  });
});

test('frames: payment and identity providers are denied; only local frames qualify', () => {
  assert.equal(deniedFrame('https://js.stripe.com'), true);
  assert.equal(deniedFrame('https://www.paypal.com'), true);
  assert.equal(deniedFrame('https://accounts.google.com'), true);
  assert.equal(deniedFrame('https://app.midtrans.com'), true);
  assert.equal(deniedFrame('https://notstripe.com'), false);
  assert.equal(deniedFrame('not a url'), true);
  assert.deepEqual(
    frameScope(
      [
        'http://maps.test',
        'https://js.stripe.com',
        'https://maps.example.com',
        'http://shop.test',
      ],
      'http://shop.test',
    ),
    {
      allowed: ['http://maps.test'],
      refused: [
        'https://js.stripe.com',
        'https://maps.example.com',
        'http://shop.test',
      ],
    },
  );
});

test('frame requests name a frame and a target instead of a page nonce', () => {
  const frame = { kind: 'click', frame: 'frame1', target: 'target-3' };
  assert.equal(invalidAction(frame), undefined);
  assert.equal(
    invalidAction({ ...frame, kind: 'type', text: 'a', clear: true }),
    undefined,
  );
  for (const bad of [
    { ...frame, nonce },
    { ...frame, frame: 'frame0' },
    { ...frame, frame: 'main' },
    { ...frame, target: 'button' },
    { ...frame, target: 'target-"]' },
    { ...frame, kind: 'type', text: 'a', clear: 'yes' },
  ])
    assert.equal(invalidAction(bad), 'BAD_REQUEST', JSON.stringify(bad));
});

test('tab requests: switching names a tab, and tab targets read like frame targets', () => {
  assert.equal(invalidAction({ kind: 'switch', tab: 'tab1' }), undefined);
  assert.equal(
    invalidAction({ kind: 'click', frame: 'tab2', target: 'target-1' }),
    undefined,
  );
  for (const bad of [
    { kind: 'switch' },
    { kind: 'switch', tab: 'tab0' },
    { kind: 'switch', tab: 'frame1' },
    { kind: 'switch', tab: 'tab2', nonce },
    { kind: 'switch', tab: 'tab2', frame: 'frame1' },
    { kind: 'click', frame: 'tab1', target: 'target-1' },
  ])
    assert.equal(invalidAction(bad), 'BAD_REQUEST', JSON.stringify(bad));
});
