import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { route, readText, api } from '../../packages/wordpress/js/api.mjs';
import {
  sourcePathAllowed,
  wordpressPhpFlags,
} from '../../scripts/wordpress-tools.mjs';

test('fixture quota clock is opt-in, falls back to real time and preserves serialized integers', () => {
  const clock = fileURLToPath(
    new URL('../../examples/wordpress/clock.php', import.meta.url),
  );
  const disabled = execFileSync(
    'php',
    [
      '-r',
      'require $argv[1]; echo function_exists("PageSquire\\\\WordPress\\\\time") ? "enabled" : "disabled";',
      clock,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(disabled, 'disabled');
  const enabled = execFileSync(
    'php',
    [
      '-r',
      String.raw`
define('PAGESQUIRE_FIXTURE', true);
function get_option(string $name, mixed $default = false): mixed { return $GLOBALS['fixtureClock'] ?? $default; }
require $argv[1];
if (abs(\PageSquire\WordPress\time() - time()) > 1) { throw new RuntimeException('Clock fallback failed'); }
$GLOBALS['fixtureClock'] = unserialize(serialize(['now' => 1234]));
$first = \PageSquire\WordPress\time();
$GLOBALS['fixtureClock']['now'] += 60;
echo json_encode([$first, \PageSquire\WordPress\time()]);
`,
      clock,
    ],
    { encoding: 'utf8' },
  );
  assert.deepEqual(JSON.parse(enabled), [1234, 1294]);
});

test('WordPress development PHP flags isolate Windows regex JIT and preserve opcode caching', () => {
  assert.deepEqual(wordpressPhpFlags('win32', true), [
    '-d',
    'opcache.enable_cli=1',
    '-d',
    'pcre.jit=0',
  ]);
  assert.deepEqual(wordpressPhpFlags('linux', true), [
    '-d',
    'opcache.enable_cli=1',
  ]);
  assert.deepEqual(wordpressPhpFlags('win32', false), [
    '-d',
    'zend_extension=opcache',
    '-d',
    'opcache.enable_cli=1',
    '-d',
    'pcre.jit=0',
  ]);
});

test('WordPress corresponding-source packaging excludes secrets, databases and generated/dependency trees', () => {
  for (const name of [
    'examples/nextjs/.env.local',
    'examples/php/.env',
    'examples/auth.json',
    'examples/.npmrc',
    'examples/id_rsa',
    'examples/certificate.pem',
    'examples/wp-config.php',
    '.cache/wordpress/config.php',
    'packages/wordpress/dist/old.php',
    'examples/site.sqlite',
    'node_modules/package/index.js',
  ])
    assert.equal(sourcePathAllowed(name), false, name);
  assert.equal(sourcePathAllowed('packages/wordpress/src/Plugin.php'), true);
  assert.equal(
    sourcePathAllowed('C:\\project\\examples\\nextjs\\.env.local'),
    false,
  );
});

test('WordPress REST addressing supports pretty and plain permalinks without trusting foreign origins', () => {
  const origin = 'https://example.test';
  assert.equal(
    route({ origin, rest: `${origin}/wp-json/pagesquire/v1/` }, 'context'),
    `${origin}/wp-json/pagesquire/v1/context`,
  );
  assert.equal(
    new URL(
      route(
        { origin, rest: `${origin}/index.php?rest_route=/pagesquire/v1/` },
        'chat',
      ),
    ).searchParams.get('rest_route'),
    '/pagesquire/v1/chat',
  );
  for (const rest of [
    'https://evil.test/',
    'https://user:secret@example.test/',
    'data:bad',
  ])
    assert.throws(() => route({ origin, rest }, 'chat'));
});

test('WordPress bounded response reader rejects bytes before reading an unbounded body', async () => {
  let canceled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(10));
      },
      cancel() {
        canceled = true;
      },
    }),
  );
  await assert.rejects(readText(response, 5), /exceeded/);
  assert.equal(canceled, true);
  await assert.rejects(readText(new Response(null)), /empty/);
});

test('WordPress reader handles UTF-8 split across chunks and enforces byte rather than character limits', async () => {
  const bytes = new TextEncoder().encode('é');
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 1));
        controller.enqueue(bytes.subarray(1));
        controller.close();
      },
    }),
  );
  assert.equal(await readText(response, 2), 'é');
  await assert.rejects(readText(new Response('é'), 1), /exceeded/);
});

test('WordPress admin requests are same-origin, nonce-authenticated, bounded and do not follow redirects', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(new URL(url).origin, 'https://example.test');
      assert.equal(options.headers['X-WP-Nonce'], 'nonce');
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'same-origin');
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json({ saved: true });
    };
    assert.deepEqual(
      await api(
        {
          origin: 'https://example.test',
          rest: 'https://example.test/wp-json/pagesquire/v1/',
          nonce: 'nonce',
        },
        'settings',
        { method: 'PUT', body: {} },
      ),
      { saved: true },
    );
    globalThis.fetch = async () => new Response('<html>not JSON</html>');
    await assert.rejects(
      api(
        { origin: 'https://example.test', rest: 'https://example.test/' },
        'context',
      ),
      /invalid JSON/,
    );
    globalThis.fetch = async () =>
      Response.json({ message: 'x'.repeat(5000) }, { status: 403 });
    await assert.rejects(
      api(
        { origin: 'https://example.test', rest: 'https://example.test/' },
        'context',
      ),
      (error) => error.message.length === 300,
    );
  } finally {
    globalThis.fetch = original;
  }
});
