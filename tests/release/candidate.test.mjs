import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unzipSync } from 'fflate';
import {
  prepareRelease,
  verifyRelease,
  projectRoot,
  npmPackages,
  sourceDigest,
} from '../../scripts/release.mjs';
import { collectDistributionSources } from '../../scripts/distribution-sources.mjs';
import { lockedComposerRepository } from '../fixtures/offline-composer.mjs';
import {
  offlineNpmEnvironment,
  writeLockedNpmConsumer,
} from '../fixtures/offline-npm.mjs';

const execute = promisify(execFile);
let candidate;
before(
  async () => {
    candidate = await prepareRelease();
  },
  { timeout: 240000 },
);

async function consumer(t) {
  const parent = path.resolve(tmpdir());
  const directory = await mkdtemp(
    path.join(parent, 'pagesquire-release-consumer-'),
  );
  t.after(async () => {
    assert.equal(path.dirname(directory), parent);
    assert.ok(
      path.basename(directory).startsWith('pagesquire-release-consumer-'),
    );
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('actual candidate has complete checksums, exact editable sources and license boundaries', async () => {
  assert.deepEqual(await verifyRelease(candidate.output), {
    valid: true,
    version: candidate.version,
    artifacts: 12,
  });
  const manifest = JSON.parse(
    await readFile(
      path.join(candidate.output, 'release-manifest.json'),
      'utf8',
    ),
  );
  assert.equal(manifest.status, 'local-preview');
  assert.equal(manifest.channel, candidate.channel);
  assert.deepEqual(manifest.beta, candidate.beta);
  assert.equal(manifest.publicationReady, candidate.publicationReady);
  assert.equal(manifest.apiReview.valid, true);
  assert.equal(manifest.apiReview.status, 'review-baseline-not-frozen');
  assert.ok(manifest.apiReview.entries > 50);
  assert.equal(
    manifest.source.sha256,
    sourceDigest(await collectDistributionSources(projectRoot)),
  );
  assert.equal(manifest.repository.owner, 'naufaldenta');
  const source = unzipSync(
    await readFile(
      path.join(candidate.output, `pagesquire-source-${candidate.version}.zip`),
    ),
  );
  const prefix = `pagesquire-${candidate.version}/`;
  for (const name of [
    'LICENSE',
    'CHANGELOG.md',
    'CODE_OF_CONDUCT.md',
    '.github/workflows/ci.yml',
    'scripts/release.mjs',
    'scripts/release-policy.mjs',
    'docs/beta.md',
    'docs/api-baseline.json',
    'docs/api-contract.md',
    'docs/upgrading.md',
    'docs/maintenance.md',
    'scripts/check-api.mjs',
    'packages/core/src/index.ts',
    'packages/wordpress/LICENSE',
  ])
    assert.ok(source[prefix + name], name);
  assert.ok(
    !Object.keys(source).some((name) =>
      /(?:^|\/)(?:\.env[^/]*|node_modules|vendor|dist|\.cache|task_plan\.md|progress\.md|findings\.md)(?:\/|$)/.test(
        name,
      ),
    ),
  );
  const plugin = unzipSync(
    await readFile(
      path.join(candidate.output, `pagesquire-${candidate.version}.zip`),
    ),
  );
  assert.match(
    Buffer.from(plugin['pagesquire/LICENSE']).toString(),
    /GNU GENERAL PUBLIC LICENSE/,
  );
  assert.ok(plugin['pagesquire/corresponding-source.zip']);
});

test(
  'GitHub-style npm tarball set installs and runs in a clean offline consumer',
  { timeout: 240000 },
  async (t) => {
    const directory = await consumer(t);
    const npmCli = process.env.npm_execpath;
    assert.ok(npmCli, 'Run npm run test:release.');
    const tarballs = npmPackages.map((name) =>
      path.join(
        candidate.output,
        `pagesquire-${name}-${candidate.version}.tgz`,
      ),
    );
    await writeLockedNpmConsumer(projectRoot, directory, tarballs);
    await execute(
      process.execPath,
      [
        npmCli,
        'ci',
        '--offline',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ],
      {
        cwd: directory,
        windowsHide: true,
        timeout: 200000,
        maxBuffer: 4 * 1024 * 1024,
        env: offlineNpmEnvironment,
      },
    );
    const probe = `import { PROTOCOL_VERSION, validateManifest, validateAppContext } from '@pagesquire/protocol';
import { CapabilityRegistry, CapabilityInspector, AppContext, ACTION_PROGRESS_STAGES } from '@pagesquire/core';
import { AssistantClient, mountInspector, describeActionProgress } from '@pagesquire/client';
import { PageSquireWidget } from '@pagesquire/react';
import { createInertiaNavigation } from '@pagesquire/react/inertia';
import { createNextNavigation } from '@pagesquire/react/next';
import { ConversationEngine } from '@pagesquire/server';
if (PROTOCOL_VERSION !== '0.1' || !validateManifest({schemaVersion:'0.1',capabilities:[]}).valid || [CapabilityRegistry,CapabilityInspector,AppContext,mountInspector,AssistantClient,PageSquireWidget,createInertiaNavigation,createNextNavigation,ConversationEngine].some(value=>typeof value!=='function')) throw Error('Packed imports failed');
const registry=new CapabilityRegistry({schemaVersion:'0.1',capabilities:[]},{handlers:{},verifiers:{},parameters:{}});
const context=new AppContext({registry,fields:{view:{public:true,type:'enum',values:['gallery'],read:()=> 'gallery'}}}).snapshot();
if(!validateAppContext(context).valid)throw Error('Packed context validation failed');
if(!Object.isFrozen(ACTION_PROGRESS_STAGES)||describeActionProgress({stage:'replayed'}).label!=='Cached result')throw Error('Packed progress failed');
const engine = new ConversationEngine({manifest:{schemaVersion:'0.1',capabilities:[]},provider:{async complete(){return {text:'Hello',emotion:'happy',finished:true,toolCalls:[]}}}});
const {reply}=await engine.handle({protocolVersion:'0.1',requestId:'release',message:'Hello',capabilityIds:[],appContext:context,snapshot:{protocolVersion:'0.1',id:'snapshot',url:'https://example.test/',title:'',text:'',targets:[],truncated:{text:false,targets:false}}},null,[]);
if(reply.response.emotion!=='happy') throw Error('Packed engine failed');
console.log('release-consumer-ok');`;
    const result = await execute(
      process.execPath,
      ['--input-type=module', '-e', probe],
      { cwd: directory, windowsHide: true },
    );
    assert.match(result.stdout, /release-consumer-ok/);
    const help = await execute(
      process.execPath,
      [
        path.join(directory, 'node_modules/@pagesquire/cli/dist/bin.js'),
        '--help',
      ],
      { cwd: directory, windowsHide: true },
    );
    assert.ok(JSON.parse(help.stdout).commands['prepare-ai']);
  },
);

test(
  'GitHub PHP archives and supplied path versions install server and Laravel without Packagist publication',
  { timeout: 240000 },
  async (t) => {
    const directory = await consumer(t);
    let composer;
    for (const location of (process.env.PATH ?? '').split(path.delimiter)) {
      for (const name of process.platform === 'win32'
        ? ['composer.phar']
        : ['composer.phar', 'composer']) {
        const file = path.join(location, name);
        try {
          await access(file);
          composer = file;
          break;
        } catch {}
      }
      if (composer) break;
    }
    assert.ok(composer, 'Composer PHP script must be on PATH.');
    for (const name of ['server', 'laravel']) {
      await execute(
        'php',
        [
          path.join(projectRoot, 'scripts/wordpress-archive.php'),
          'extract',
          path.join(
            candidate.output,
            `pagesquire-${name}-${candidate.version}.zip`,
          ),
          directory,
        ],
        { windowsHide: true },
      );
      for (const file of ['composer.json', 'LICENSE', 'README.md'])
        await access(path.join(directory, `pagesquire-${name}`, file));
    }
    const fragment = JSON.parse(
      await readFile(
        path.join(candidate.output, 'composer-repositories.json'),
        'utf8',
      ),
    );
    const compatibility = JSON.parse(
      await readFile(path.join(projectRoot, 'docs/compatibility.json'), 'utf8'),
    );
    await writeFile(
      path.join(directory, 'composer.json'),
      JSON.stringify({
        name: 'pagesquire/release-consumer',
        ...fragment,
        repositories: [
          ...fragment.repositories,
          await lockedComposerRepository(projectRoot),
          { 'packagist.org': false },
        ],
        require: {
          ...fragment.require,
          'laravel/framework': compatibility.composer[
            'laravel/framework'
          ].replace(/^v/, ''),
        },
        'prefer-stable': true,
      }),
    );
    await execute(
      'php',
      [
        composer,
        'install',
        '--no-dev',
        '--no-interaction',
        '--no-scripts',
        '--no-plugins',
        '--prefer-dist',
      ],
      {
        cwd: directory,
        windowsHide: true,
        timeout: 200000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, COMPOSER_DISABLE_NETWORK: '1' },
      },
    );
    await writeFile(
      path.join(directory, 'smoke.php'),
      String.raw`<?php
require 'vendor/autoload.php';
if (!class_exists(\PageSquire\Server\ConversationEngine::class) || !class_exists(\PageSquire\Laravel\PageSquireServiceProvider::class)) { exit(1); }
echo 'release-php-consumer-ok';
`,
    );
    const result = await execute('php', ['smoke.php'], {
      cwd: directory,
      windowsHide: true,
    });
    assert.match(result.stdout, /release-php-consumer-ok/);
  },
);
