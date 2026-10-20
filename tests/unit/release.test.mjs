import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import browserConfig from '../../playwright.config.mjs';
import wordpressConfig from '../../playwright.wordpress.config.mjs';
import { lockedComposerRepository } from '../fixtures/offline-composer.mjs';
import {
  collectDistributionSources,
  distributionPathAllowed,
  safeArchivePath,
} from '../../scripts/distribution-sources.mjs';
import {
  checkRelease,
  checkDocumentation,
  zipSources,
  sha256,
  assertWordPressSources,
  projectRoot,
  verifyRelease,
  buildEvidence,
  sourceDigest,
} from '../../scripts/release.mjs';

async function temporary(t) {
  const parent = path.resolve(tmpdir());
  const directory = await mkdtemp(
    path.join(parent, 'pagesquire-release-test-'),
  );
  t.after(async () => {
    assert.equal(path.dirname(directory), parent);
    assert.ok(path.basename(directory).startsWith('pagesquire-release-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('CI isolates browser artifacts and enumerates every verification component', async () => {
  const browser = path.resolve(projectRoot, browserConfig.outputDir);
  const wordpress = path.resolve(projectRoot, wordpressConfig.outputDir);
  assert.notEqual(browser, wordpress);
  assert.ok(path.relative(browser, wordpress).startsWith('..'));
  assert.ok(path.relative(wordpress, browser).startsWith('..'));
  const workflow = await readFile(
    path.join(projectRoot, '.github/workflows/ci.yml'),
    'utf8',
  );
  for (const script of [
    'build',
    'typecheck',
    'test:unit',
    'test:php',
    'test:browser',
    'test:wordpress',
    'test:package',
    'release:check',
    'test:release',
    'test:next-build',
    'format:check',
    'release:prepare',
  ])
    assert.ok(workflow.includes(`run: npm run ${script}\n`), script);
  assert.match(workflow, /timeout-minutes: 30/);
});

test('offline Composer consumers resolve only locked third-party metadata, never workspace packages', async () => {
  const repository = await lockedComposerRepository(projectRoot);
  const lock = JSON.parse(
    await readFile(path.join(projectRoot, 'composer.lock'), 'utf8'),
  );
  assert.equal(repository.type, 'package');
  assert.deepEqual(
    repository.package,
    [...lock.packages, ...lock['packages-dev']].filter(
      (item) => !item.name.startsWith('pagesquire/'),
    ),
  );
  assert.ok(
    repository.package.some((item) => item.name === 'laravel/framework'),
  );
  assert.ok(
    repository.package.some((item) => item.name === 'opis/json-schema'),
  );
  assert.ok(repository.package.every((item) => item.dist || item.source));
});

test('demo build creates absent output directories on a clean checkout and remains repeatable', async (t) => {
  const root = await temporary(t);
  await mkdir(path.join(root, 'packages/core/dist'), { recursive: true });
  await mkdir(path.join(root, 'packages/client/src'), { recursive: true });
  await mkdir(path.join(root, 'examples/plain-html'), { recursive: true });
  await writeFile(path.join(root, 'LICENSE'), 'synthetic license fixture');
  await writeFile(
    path.join(root, 'packages/client/src/widget.css'),
    '.fixture { color: red; }',
  );
  for (const name of ['main.ts', 'react-demo.tsx'])
    await writeFile(
      path.join(root, 'examples/plain-html', name),
      'export const fixture = true;',
    );
  for (let run = 0; run < 2; run++)
    execFileSync(
      process.execPath,
      [path.join(projectRoot, 'scripts/build-demo.mjs')],
      { cwd: root, stdio: 'pipe' },
    );
  for (const name of ['demo.js', 'react-demo.js', 'widget.css'])
    assert.ok(
      (await readFile(path.join(root, 'examples/plain-html/dist', name)))
        .length > 0,
    );
  assert.equal(
    await readFile(
      path.join(root, 'examples/plain-html/dist/widget.css'),
      'utf8',
    ),
    '.fixture { color: red; }',
  );
});
async function fixture(t) {
  const root = await temporary(t);
  for (const [name, bytes] of await collectDistributionSources(projectRoot)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), bytes);
  }
  return root;
}
async function mutateJson(root, name, mutate) {
  const file = path.join(root, name);
  const data = JSON.parse(await readFile(file, 'utf8'));
  mutate(data);
  await writeFile(file, JSON.stringify(data));
}

test('distribution paths exclude traversal, links-to-secrets names, dependencies and private artifacts', () => {
  for (const name of [
    '../secret',
    '/absolute',
    'C:/secret',
    'foo/../bar',
    'foo//bar',
    'foo\u0000bar',
    'file:stream',
    'examples/.env.local',
    'examples/id_ed25519',
    'foo/auth.json',
    'foo/credentials.json',
    'foo/site.sqlite',
    'foo/cert.pfx',
    'foo/key.pem',
    'node_modules/x/index.js',
    'packages/cli/dist/bin.js',
  ])
    assert.equal(distributionPathAllowed(name), false, name);
  assert.equal(distributionPathAllowed('packages/core/src/index.ts'), true);
  assert.equal(safeArchivePath('dist/index.js'), true);
});

test('source inventory excludes local notes/cache and includes release/community/build sources', async () => {
  const files = await collectDistributionSources(projectRoot);
  for (const name of [
    '.gitattributes',
    'release.config.json',
    'CHANGELOG.md',
    'CODE_OF_CONDUCT.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'scripts/release.mjs',
    'docs/releasing.md',
  ])
    assert.ok(files.has(name), name);
  for (const name of ['notes.md', 'scratch.md'])
    assert.ok(!files.has(name), name);
  assert.ok(
    ![...files.keys()].some((name) =>
      /(?:^|\/)(?:node_modules|vendor|dist|\.cache)(?:\/|$)/.test(name),
    ),
  );
});

test('source archives are deterministic, editable, licensed and reject unsafe prefixes/paths', async () => {
  const files = await collectDistributionSources(projectRoot);
  const first = zipSources(files, 'pagesquire');
  assert.equal(sha256(first), sha256(zipSources(files, 'pagesquire')));
  const extracted = unzipSync(first);
  assert.ok(extracted['pagesquire/LICENSE']);
  assert.ok(extracted['pagesquire/packages/wordpress/LICENSE']);
  assert.equal(
    Buffer.from(extracted['pagesquire/scripts/release.mjs']).toString(),
    files.get('scripts/release.mjs').toString(),
  );
  assert.throws(() => zipSources(files, '../escape'), /prefix/);
  assert.throws(
    () => zipSources(new Map([['../escape', Buffer.from('x')]]), 'pagesquire'),
    /Unsafe/,
  );
});

test('source collector refuses a symlink inside a distributable tree', async (t) => {
  const root = await fixture(t);
  const outside = await temporary(t);
  await writeFile(path.join(outside, 'not-for-release.txt'), 'private');
  await symlink(
    outside,
    path.join(root, 'examples', 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(collectDistributionSources(root), /link/);
});

test('valid local alpha does not imply public-release readiness', async (t) => {
  const root = await fixture(t);
  await mutateJson(root, 'release.config.json', (item) => {
    for (const name of Object.keys(item.publication))
      item.publication[name] = false;
  });
  const result = await checkRelease(root);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.publicationReady, false);
  assert.ok(result.gates.includes('ownerApprovedRelease'));
  assert.equal(result.repository.owner, 'naufaldenta');
  assert.ok(result.documentation.guides >= 30);
});

test('metadata checks reject drift in versions, licenses, dependencies and registry guards', async (t) => {
  const root = await fixture(t);
  await mutateJson(root, 'packages/core/package.json', (item) => {
    item.private = false;
    item.version = '1.0.0';
    item.license = 'UNLICENSED';
    item.dependencies['@pagesquire/protocol'] = '*';
  });
  await mutateJson(root, 'release.config.json', (item) => {
    item.registries.npm = 'publish';
  });
  await mutateJson(root, 'docs/compatibility.json', (item) => {
    item.npm.next = '1.0.0';
  });
  const result = await checkRelease(root);
  assert.equal(result.valid, false);
  for (const text of [
    'identity/version',
    'private/MIT',
    'internal dependency',
    'deferred',
    'Compatibility npm',
  ])
    assert.ok(
      result.errors.some((error) => error.includes(text)),
      text,
    );
});

test('alpha tooling refuses stable promotion, WordPress drift and unsupported compatibility claims', async (t) => {
  const root = await fixture(t);
  await mutateJson(root, 'package.json', (item) => {
    item.version = '1.0.0';
  });
  await mutateJson(root, 'docs/compatibility.json', (item) => {
    item.targets[0].status = 'all-sites';
  });
  const result = await checkRelease(root);
  for (const text of [
    'alpha release',
    'WordPress plugin version',
    'WordPress stable tag',
    'Unsupported compatibility claim',
  ])
    assert.ok(
      result.errors.some((error) => error.includes(text)),
      text,
    );
});

test('documentation checks catch missing local links, invalid JSON and path escapes', async (t) => {
  const root = await temporary(t);
  const files = new Map([
    [
      'README.md',
      Buffer.from(
        '[missing](nope.md)\n[escape](../outside.md)\n```json\n{broken}\n```\n[external](https://example.test/)',
      ),
    ],
  ]);
  const result = await checkDocumentation(root, files);
  assert.equal(result.errors.length, 3);
});

test('WordPress stale source guard requires the exact current inventory and bytes', () => {
  const files = new Map([['README.md', Buffer.from('source')]]);
  const archive = (nested) =>
    zipSources(new Map([['corresponding-source.zip', nested]]), 'pagesquire');
  assert.doesNotThrow(() =>
    assertWordPressSources(archive(zipSources(files, 'pagesquire')), files),
  );
  assert.throws(
    () =>
      assertWordPressSources(
        archive(zipSources(new Map(), 'pagesquire')),
        files,
      ),
    /inventory/,
  );
  assert.throws(
    () =>
      assertWordPressSources(
        archive(
          zipSources(
            new Map([['README.md', Buffer.from('old')]]),
            'pagesquire',
          ),
        ),
        files,
      ),
    /Stale/,
  );
});

test('build evidence detects changed inputs, missing outputs and altered compiled output', async (t) => {
  const root = await fixture(t);
  for (const name of ['protocol', 'core', 'client', 'react', 'cli', 'server']) {
    await mkdir(path.join(root, `packages/${name}/dist`), { recursive: true });
    await writeFile(
      path.join(root, `packages/${name}/dist/index.js`),
      'export {};',
    );
  }
  await mkdir(path.join(root, 'packages/wordpress/dist'), { recursive: true });
  await writeFile(
    path.join(root, 'packages/wordpress/dist/pagesquire-0.1.0-alpha.0.zip'),
    'fixture',
  );
  const before = await buildEvidence(root);
  await writeFile(
    path.join(root, 'packages/core/dist/index.js'),
    'export const changed = true;',
  );
  const changed = await buildEvidence(root);
  assert.equal(before.sourceDigest, changed.sourceDigest);
  assert.notEqual(
    before.outputs['packages/core/dist/index.js'],
    changed.outputs['packages/core/dist/index.js'],
  );
  await writeFile(path.join(root, 'README.md'), 'New source');
  assert.notEqual(
    before.sourceDigest,
    (await buildEvidence(root)).sourceDigest,
  );
  await rm(
    path.join(root, 'packages/wordpress/dist/pagesquire-0.1.0-alpha.0.zip'),
  );
  await assert.rejects(buildEvidence(root), /ENOENT/);
});

test('release CLI has no publisher and enforces current owner/remote publication gates', async () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, ['scripts/release.mjs', 'publish'], {
        cwd: projectRoot,
        stdio: 'pipe',
      }),
    (error) =>
      error.status === 1 && error.stderr.toString().includes('No publishing'),
  );
  const result = spawnSync(
    process.execPath,
    ['scripts/release.mjs', 'check', '--publication'],
    { cwd: projectRoot, encoding: 'utf8' },
  );
  const report = await checkRelease();
  assert.equal(result.status, report.publicationReady ? 0 : 1);
  assert.equal(
    JSON.parse(result.stdout).publicationReady,
    report.publicationReady,
  );
});

async function fakeCandidate(t) {
  const directory = await temporary(t);
  const version = '0.1.0-alpha.0';
  const names = ['protocol', 'core', 'client', 'react', 'cli', 'server'].map(
    (name) => `pagesquire-${name}-${version}.tgz`,
  );
  names.push(
    `pagesquire-source-${version}.zip`,
    `pagesquire-server-${version}.zip`,
    `pagesquire-laravel-${version}.zip`,
    `pagesquire-${version}.zip`,
    'composer-repositories.json',
    'RELEASE_NOTES.md',
  );
  const artifacts = [];
  for (const filename of names) {
    const bytes = Buffer.from(`fixture: ${filename}`);
    await writeFile(path.join(directory, filename), bytes);
    artifacts.push({ filename, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const manifest = {
    schemaVersion: 1,
    version,
    status: 'local-preview',
    artifacts,
  };
  await writeFile(
    path.join(directory, 'release-manifest.json'),
    JSON.stringify(manifest),
  );
  const hash = sha256(
    await readFile(path.join(directory, 'release-manifest.json')),
  );
  await writeFile(
    path.join(directory, 'SHA256SUMS'),
    [...artifacts, { filename: 'release-manifest.json', sha256: hash }]
      .map((item) => `${item.sha256}  ${item.filename}\n`)
      .join(''),
  );
  return { directory, manifest };
}

test('candidate verifier accepts a complete checksum inventory', async (t) => {
  const { directory } = await fakeCandidate(t);
  assert.deepEqual(await verifyRelease(directory), {
    valid: true,
    version: '0.1.0-alpha.0',
    artifacts: 12,
  });
});

test('candidate verifier rejects corruption, missing and unexpected files', async (t) => {
  for (const mode of ['corrupt', 'missing', 'extra']) {
    const { directory, manifest } = await fakeCandidate(t);
    const filename = path.join(directory, manifest.artifacts[0].filename);
    if (mode === 'corrupt') await writeFile(filename, 'corrupt');
    else if (mode === 'missing') await rm(filename);
    else
      await writeFile(path.join(directory, 'unexpected.txt'), 'not approved');
    await assert.rejects(verifyRelease(directory));
  }
});

test('candidate verifier rejects traversal/duplicates in manifests and duplicate checksums', async (t) => {
  for (const mode of ['traversal', 'duplicate', 'checksums']) {
    const { directory, manifest } = await fakeCandidate(t);
    if (mode === 'checksums') {
      const checksum = await readFile(
        path.join(directory, 'SHA256SUMS'),
        'utf8',
      );
      await writeFile(
        path.join(directory, 'SHA256SUMS'),
        checksum + checksum.split('\n')[0] + '\n',
      );
    } else {
      manifest.artifacts[0].filename =
        mode === 'traversal' ? '../escape' : manifest.artifacts[1].filename;
      await writeFile(
        path.join(directory, 'release-manifest.json'),
        JSON.stringify(manifest),
      );
    }
    await assert.rejects(verifyRelease(directory), /Invalid/);
  }
});

test('source fingerprints are order independent and bind filenames as well as bytes', () => {
  const a = new Map([
    ['a', Buffer.from('1')],
    ['b', Buffer.from('2')],
  ]);
  assert.equal(sourceDigest(a), sourceDigest(new Map([...a].reverse())));
  assert.notEqual(
    sourceDigest(a),
    sourceDigest(
      new Map([
        ['different', Buffer.from('1')],
        ['b', Buffer.from('2')],
      ]),
    ),
  );
});
