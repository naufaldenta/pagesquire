import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockedComposerRepository } from '../fixtures/offline-composer.mjs';

test('standalone PHP archive installs without Laravel in a clean offline Composer consumer', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const temporaryRoot = path.resolve(tmpdir());
  const temporary = await mkdtemp(
    path.join(temporaryRoot, 'pagesquire-php-package-'),
  );
  const candidates = (process.env.PATH ?? '')
    .split(path.delimiter)
    .flatMap((directory) => [
      path.join(directory, 'composer.phar'),
      ...(process.platform === 'win32'
        ? []
        : [path.join(directory, 'composer')]),
    ]);
  let composer;
  for (const candidate of candidates) {
    try {
      await access(candidate);
      composer = candidate;
      break;
    } catch {}
  }
  assert.ok(composer, 'Composer PHP script must be available on PATH.');
  const php = (args, cwd = temporary, env = {}) =>
    execFileSync('php', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, COMPOSER_DISABLE_NETWORK: '1', ...env },
    });
  try {
    php(
      [
        composer,
        'archive',
        '--format=tar',
        `--dir=${temporary}`,
        '--file=pagesquire-server',
        '--no-interaction',
        '--no-scripts',
        '--no-plugins',
      ],
      path.join(root, 'packages/php'),
    );
    const extracted = path.join(temporary, 'extracted');
    await mkdir(extracted);
    php([
      '-r',
      '$archive = new PharData($argv[1]); $archive->extractTo($argv[2]);',
      path.join(temporary, 'pagesquire-server.tar'),
      extracted,
    ]);
    const metadata = JSON.parse(
      await readFile(path.join(extracted, 'composer.json'), 'utf8'),
    );
    assert.equal(metadata.name, 'pagesquire/server');
    assert.ok(
      !Object.keys(metadata.require).some((name) =>
        /laravel|illuminate/.test(name),
      ),
    );
    for (const file of [
      'LICENSE',
      'README.md',
      'resources/schemas/chatRequest.json',
      'resources/schemas/providerResponse.json',
      'src/Http/ChatEndpoint.php',
    ])
      await access(path.join(extracted, file));
    const consumer = path.join(temporary, 'consumer');
    await mkdir(consumer);
    await writeFile(
      path.join(consumer, 'composer.json'),
      JSON.stringify({
        name: 'pagesquire/clean-consumer',
        repositories: [
          { type: 'path', url: extracted, options: { symlink: false } },
          await lockedComposerRepository(root),
          { 'packagist.org': false },
        ],
        require: { 'pagesquire/server': '@dev' },
        'minimum-stability': 'stable',
        'prefer-stable': true,
      }),
    );
    php(
      [
        composer,
        'install',
        '--no-dev',
        '--no-interaction',
        '--no-scripts',
        '--no-plugins',
        '--prefer-dist',
      ],
      consumer,
    );
    const lock = JSON.parse(
      await readFile(path.join(consumer, 'composer.lock'), 'utf8'),
    );
    assert.ok(
      !lock.packages.some((item) =>
        /^(?:laravel|illuminate)\//.test(item.name),
      ),
    );
    const fixture = JSON.parse(
      await readFile(
        path.join(root, 'tests/fixtures/conformance.json'),
        'utf8',
      ),
    );
    await writeFile(
      path.join(consumer, 'fixture.json'),
      JSON.stringify(fixture),
    );
    await writeFile(
      path.join(consumer, 'smoke.php'),
      String.raw`<?php
declare(strict_types=1);
require 'vendor/autoload.php';
$fixture = json_decode(file_get_contents('fixture.json'), true, 64, JSON_THROW_ON_ERROR);
$provider = new class($fixture) implements \PageSquire\Server\Provider {
    public function __construct(private array $fixture) {}
    public function complete(array $messages, array $capabilities, int $maxOutputTokens): array {
        return $this->fixture['drafts']['final'];
    }
};
$engine = new \PageSquire\Server\ConversationEngine($provider, new \PageSquire\Server\ProtocolValidator, $fixture['manifest']);
$result = $engine->handle($fixture['request'], null, []);
if ($result['reply']['response']['emotion'] !== 'happy' || class_exists(\Illuminate\Foundation\Application::class) || !class_exists(\PageSquire\Server\Http\ConversationPrivacy::class)) {
    exit(1);
}
echo 'standalone-php-artifact-ok';
`,
    );
    const result = php(['smoke.php'], consumer);
    assert.match(result, /standalone-php-artifact-ok/);
  } finally {
    assert.equal(path.dirname(temporary), temporaryRoot);
    assert.ok(path.basename(temporary).startsWith('pagesquire-php-package-'));
    await rm(temporary, { recursive: true, force: true });
  }
});
