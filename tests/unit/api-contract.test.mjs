import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rmdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  apiPackages,
  apiRoot,
  captureApi,
  checkApi,
} from '../../scripts/check-api.mjs';

async function fixture(t) {
  const parent = await realpath(tmpdir());
  const root = await realpath(
    await mkdtemp(path.join(parent, 'pagesquire-api-review-')),
  );
  t.after(async () => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith('pagesquire-api-review-'));
    await rm(root, { recursive: true, force: true });
  });
  async function put(relative, value) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      typeof value === 'string' ? value : JSON.stringify(value),
    );
  }
  await put('package.json', { version: '0.1.0-alpha.0' });
  for (const name of apiPackages) {
    await put(`packages/${name}/package.json`, {
      name: `@pagesquire/${name}`,
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      },
    });
    await put(
      `packages/${name}/dist/index.d.ts`,
      'export declare const fixture: string;\n',
    );
    await put(
      `packages/${name}/dist/index.js`,
      'throw Error("DO_NOT_IMPORT_CHECKOUT_CODE");',
    );
  }
  await put('packages/protocol/dist/schemas/fixture.json', {
    type: 'string',
    minLength: 1,
  });
  for (const name of ['php', 'laravel', 'wordpress']) {
    await put(`packages/${name}/composer.json`, {
      name: `pagesquire/${name}`,
      require: { php: '^8.3' },
    });
    await put(
      `packages/${name}/src/Fixture.php`,
      '<?php\nthrow new Exception("DO_NOT_EXECUTE_PHP");\n',
    );
  }
  await put('packages/wordpress/pagesquire.php', '<?php // synthetic header\n');
  await put('docs/api-baseline.json', await captureApi(root));
  return { root, put };
}

test('API review matches the explicit current baseline without claiming a frozen or stable API', async () => {
  const result = await checkApi();
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.equal(result.status, 'review-baseline-not-frozen');
  assert.ok(result.entries > 50);
  const baseline = await captureApi();
  assert.equal(baseline.packageVersion, '0.1.0-alpha.0');
  assert.ok(baseline.files['packages/server/dist/privacy.d.ts']);
});

test('capture is deterministic, normalizes line endings/key order and never executes public code', async (t) => {
  const { root, put } = await fixture(t);
  const before = await captureApi(root);
  await put(
    'packages/core/dist/index.d.ts',
    'export declare const fixture: string;\r\n',
  );
  await put('packages/protocol/dist/schemas/fixture.json', {
    minLength: 1,
    type: 'string',
  });
  await put('packages/core/package.json', {
    description: 'Noncontract description',
    exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } },
    name: '@pagesquire/core',
  });
  assert.deepEqual(await captureApi(root), before);
  assert.equal((await checkApi(root)).valid, true);
});

test('review guard detects added/removed declarations, PHP review changes, exports, host constraints and wire drift', async (t) => {
  const { root, put } = await fixture(t);
  await put('packages/core/dist/new.d.ts', 'export type Added = true;');
  await rm(path.join(root, 'packages/client/dist/index.d.ts'));
  await put('packages/client/dist/other.d.ts', 'export type Renamed = true;');
  await put(
    'packages/laravel/src/Fixture.php',
    '<?php // implementation change still requires review\n',
  );
  await put('packages/server/package.json', {
    name: '@pagesquire/server',
    exports: { '.': './dist/different.js' },
    engines: { node: '>=26' },
  });
  await put('packages/protocol/dist/schemas/fixture.json', { type: 'number' });
  const result = await checkApi(root);
  assert.equal(result.valid, false);
  assert.ok(result.added.includes('packages/core/dist/new.d.ts'));
  assert.ok(result.removed.includes('packages/client/dist/index.d.ts'));
  for (const name of [
    'packages/laravel/src/Fixture.php',
    'packages/server/package.json',
    'packages/protocol/dist/schemas/fixture.json',
  ])
    assert.ok(result.changed.includes(name));
});

test('version changes require deliberate re-review and cannot be hidden by extra baseline fields', async (t) => {
  const { root, put } = await fixture(t);
  await put('package.json', { version: '0.1.0-beta.0' });
  assert.equal((await checkApi(root)).versionChanged, true);
  const baseline = await captureApi(root);
  await put('docs/api-baseline.json', { ...baseline, frozen: true });
  await assert.rejects(checkApi(root), /Invalid API review baseline/);
});

test('missing generated types and linked public trees/baselines fail closed', async (t) => {
  const { root, put } = await fixture(t);
  await rm(path.join(root, 'packages/core/dist/index.d.ts'));
  await assert.rejects(captureApi(root), /empty/);
  await put('packages/core/dist/index.d.ts', 'export {};');
  const target = path.join(root, 'linked-target');
  await mkdir(target);
  await symlink(
    target,
    path.join(root, 'packages/server/dist/linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(captureApi(root), /links/);
});

test('API CLI is read-only and refuses a baseline-writing or promotion command', async () => {
  const file = path.join(apiRoot, 'docs/api-baseline.json');
  const before = await readFile(file);
  const result = spawnSync(
    process.execPath,
    ['scripts/check-api.mjs', '--update'],
    { cwd: apiRoot, encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No automatic baseline writer/);
  assert.deepEqual(await readFile(file), before);
});

test('linked baseline files and directories are rejected before reading their contents', async (t) => {
  const { root, put } = await fixture(t);
  const baseline = await captureApi(root);
  await put('saved-baseline.json', baseline);
  await rm(path.join(root, 'docs/api-baseline.json'));
  await symlink(
    path.join(root, 'saved-baseline.json'),
    path.join(root, 'docs/api-baseline.json'),
  );
  await assert.rejects(checkApi(root), /regular file/);
  await rm(path.join(root, 'docs/api-baseline.json'));
  await rmdir(path.join(root, 'docs'));
  await put('other-docs/api-baseline.json', baseline);
  await symlink(
    path.join(root, 'other-docs'),
    path.join(root, 'docs'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(checkApi(root), /directory must not be a link/);
});
