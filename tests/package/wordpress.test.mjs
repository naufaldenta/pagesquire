import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

test('WordPress ZIP is installation-ready, isolated, licensed and includes editable build sources', async () => {
  const files = unzipSync(
    await readFile(
      new URL(
        '../../packages/wordpress/dist/pagesquire-0.1.0-beta.0.zip',
        import.meta.url,
      ),
    ),
  );
  for (const name of [
    'pagesquire.php',
    'autoload.php',
    'src/Plugin.php',
    'views/dashboard.php',
    'assets/frontend.js',
    'assets/admin.js',
    'assets/widget.css',
    'assets/plugin.css',
    'assets/assistant-setup.md',
    'runtime/autoload.php',
    'runtime/pagesquire/resources/schemas/chatRequest.json',
    'LICENSE',
    'THIRD-PARTY.md',
    'runtime/opis/json-schema/LICENSE',
    'assets/AJV-LICENSE',
    'assets/FFLATE-LICENSE',
    'corresponding-source.zip',
  ])
    assert.ok(files[`pagesquire/${name}`], name);
  assert.match(
    strFromU8(files['pagesquire/pagesquire.php']),
    /License: GPL-3\.0-or-later/,
  );
  assert.match(
    strFromU8(files['pagesquire/LICENSE']),
    /GNU GENERAL PUBLIC LICENSE/,
  );
  assert.match(
    strFromU8(
      files['pagesquire/runtime/pagesquire/src/ConversationEngine.php'],
    ),
    /namespace PageSquireWPVendor\\PageSquire\\Server/,
  );
  assert.match(
    strFromU8(
      files['pagesquire/runtime/opis/json-schema/src/CompliantValidator.php'],
    ),
    /namespace PageSquireWPVendor\\Opis\\JsonSchema/,
  );
  for (const name of Object.keys(files)) {
    assert.ok(name.startsWith('pagesquire/'));
    assert.doesNotMatch(
      name,
      /node_modules|wp-config|\.env|sqlite|mu-plugins|vendor\/laravel|\.phar|fixture\.php/,
    );
  }
  const source = unzipSync(files['pagesquire/corresponding-source.zip']);
  for (const name of [
    'package.json',
    'package-lock.json',
    'composer.lock',
    'scripts/build-wordpress.mjs',
    'scripts/compile-validators.mjs',
    'packages/wordpress/scoper.inc.php',
    'packages/wordpress/js/frontend.mjs',
    'packages/core/src/index.ts',
    'packages/client/src/index.ts',
    'packages/php/src/ConversationEngine.php',
  ])
    assert.ok(source[`pagesquire/${name}`], name);
  assert.ok(
    !Object.keys(source).some((name) =>
      /(?:^|\/)(?:node_modules|vendor|\.cache)(?:\/|$)|(?:^|\/)(?:\.env(?:\.|$)|wp-config\.php$|auth\.json$)|\.(?:sqlite|db|pem|key)$/.test(
        name,
      ),
    ),
  );
});
