import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifest as fixtureManifest } from '../fixtures/capabilities.mjs';
import {
  offlineNpmEnvironment,
  writeLockedNpmConsumer,
} from '../fixtures/offline-npm.mjs';

test('packed browser packages install into a clean offline ESM consumer', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const temporaryRoot = path.resolve(os.tmpdir());
  const temporary = await mkdtemp(
    path.join(temporaryRoot, 'pagesquire-smoke-'),
  );
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'Run this test through npm run test:package.');
  const npm = (args, cwd = root) =>
    execFileSync(process.execPath, [npmCli, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: offlineNpmEnvironment,
    });
  try {
    const tarballs = [];
    for (const name of [
      'protocol',
      'core',
      'client',
      'react',
      'cli',
      'server',
    ]) {
      const packed = JSON.parse(
        npm([
          'pack',
          '--json',
          '--ignore-scripts',
          '--pack-destination',
          temporary,
          `./packages/${name}`,
        ]),
      )[0];
      assert.ok(packed.files.some((file) => file.path === 'dist/index.js'));
      assert.ok(packed.files.some((file) => file.path === 'dist/index.d.ts'));
      assert.ok(packed.files.some((file) => file.path === 'README.md'));
      assert.ok(packed.files.some((file) => file.path === 'dist/LICENSE'));
      if (name === 'cli') {
        assert.ok(packed.files.some((file) => file.path === 'dist/bin.js'));
        assert.ok(
          packed.files.some((file) => file.path === 'dist/browser-probe.js'),
        );
        assert.ok(
          packed.files.some(
            (file) => file.path === 'dist/templates/assistant-setup/SKILL.md',
          ),
        );
      }
      assert.ok(
        !packed.files.some((file) =>
          /node_modules|\.env|test-results/.test(file.path),
        ),
      );
      tarballs.push(path.join(temporary, packed.filename));
    }
    await writeLockedNpmConsumer(root, temporary, tarballs);
    const lockFile = path.join(temporary, 'package-lock.json');
    const validLock = await readFile(lockFile, 'utf8');
    const invalidPeerLock = JSON.parse(validLock);
    invalidPeerLock.packages[
      'node_modules/@pagesquire/react'
    ].peerDependencies.react = '^999.0.0';
    await writeFile(lockFile, JSON.stringify(invalidPeerLock));
    assert.throws(
      () =>
        npm(
          [
            'ci',
            '--dry-run',
            '--offline',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
          ],
          temporary,
        ),
      /ERESOLVE|ENOTCACHED|Invalid: lock file's react/,
    );
    await writeFile(lockFile, validLock);
    npm(
      ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'],
      temporary,
    );
    const probe = `import { PROTOCOL_VERSION, validateManifest } from '@pagesquire/protocol'; import { CapabilityRegistry } from '@pagesquire/core'; import { AssistantClient } from '@pagesquire/client'; import { PageSquireWidget } from '@pagesquire/react'; import { createInertiaNavigation } from '@pagesquire/react/inertia'; if (PROTOCOL_VERSION !== '0.1' || !validateManifest({schemaVersion:'0.1',capabilities:[]}).valid || typeof AssistantClient !== 'function' || typeof PageSquireWidget !== 'function' || typeof createInertiaNavigation !== 'function' || new CapabilityRegistry({schemaVersion:'0.1',capabilities:[]},{handlers:{},verifiers:{},parameters:{}}).list().length !== 0) throw new Error('Artifact import failed'); console.log('artifact-import-ok');`;
    const result = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', probe],
      { cwd: temporary, encoding: 'utf8' },
    );
    assert.match(result, /artifact-import-ok/);
    const serverProbe = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { ConversationEngine, FileConversationStore, createChatHandler, forgetConversation } from '@pagesquire/server'; import { createNextNavigation } from '@pagesquire/react/next'; if (typeof FileConversationStore !== 'function' || typeof createChatHandler !== 'function' || typeof createNextNavigation !== 'function' || typeof forgetConversation !== 'function') throw Error('Missing server/Next/privacy artifact'); const engine = new ConversationEngine({manifest:{schemaVersion:'0.1',capabilities:[]},provider:{async complete(){return {text:'Hello',emotion:'happy',finished:true,toolCalls:[]}}}}); const {reply}=await engine.handle({protocolVersion:'0.1',requestId:'packed',message:'Hello',capabilityIds:[],snapshot:{protocolVersion:'0.1',id:'snapshot',url:'https://example.test/',title:'',text:'',targets:[],truncated:{text:false,targets:false}}},null,[]); if(reply.response.emotion!=='happy') throw Error('Packed server failed'); console.log('server-artifact-ok');`,
      ],
      { cwd: temporary, encoding: 'utf8' },
    );
    assert.match(serverProbe, /server-artifact-ok/);
    const cli = path.join(
      temporary,
      'node_modules/@pagesquire/cli/dist/bin.js',
    );
    const help = execFileSync(process.execPath, [cli, '--help'], {
      cwd: temporary,
      encoding: 'utf8',
    });
    assert.ok(JSON.parse(help).commands['prepare-ai']);
    const pilot = path.join(temporary, 'pilot');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(pilot);
    for (const args of [
      ['init'],
      ['scan'],
      ['report'],
      ['prepare-ai', '--host', 'both'],
    ]) {
      execFileSync(process.execPath, [cli, ...args, '--root', pilot], {
        cwd: temporary,
        encoding: 'utf8',
      });
    }
    const capability = fixtureManifest.capabilities[0];
    await writeFile(
      path.join(pilot, 'pagesquire/capabilities.json'),
      JSON.stringify({ schemaVersion: '0.1', capabilities: [capability] }),
    );
    await writeFile(
      path.join(pilot, 'pagesquire/bindings.json'),
      JSON.stringify({
        schemaVersion: '0.1',
        handlers: {
          [capability.handler]: {
            module: 'pagesquire/adapter.mjs',
            export: 'handler',
          },
        },
        verifiers: {
          [capability.verification.handler]: {
            module: 'pagesquire/adapter.mjs',
            export: 'verify',
          },
        },
      }),
    );
    await writeFile(
      path.join(pilot, 'pagesquire/adapter.mjs'),
      'export function handler(){} export const verify = () => ({verified:false});',
    );
    const compiled = JSON.parse(
      execFileSync(
        process.execPath,
        [cli, 'validate', '--compile', '--root', pilot],
        { cwd: temporary, encoding: 'utf8' },
      ),
    );
    assert.equal(compiled.compiled, true);
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        'import { parameters } from "./pilot/pagesquire/generated/parameters.js"; const check=parameters["accessibility.set_heading_color"].validate; if (!check({color:"#ff0000"}) || check({color:"red"})) throw Error("Packed CLI compilation failed");',
      ],
      { cwd: temporary, encoding: 'utf8' },
    );
    const typeProbe =
      "import { CapabilityRegistry, type RuntimeOptions } from '@pagesquire/core'; import { type ActionCall } from '@pagesquire/protocol'; import { AssistantClient, ChatNavigationStore } from '@pagesquire/client'; import { PageSquireWidget } from '@pagesquire/react'; import { createNextNavigation } from '@pagesquire/react/next'; import { ConversationEngine, type HandlerOptions } from '@pagesquire/server'; export type Integration = [RuntimeOptions, ActionCall, HandlerOptions]; export const Registry = CapabilityRegistry; export const Client = AssistantClient; export const Widget = PageSquireWidget; export const Next = createNextNavigation; export const Server = ConversationEngine; export const Checkpoint = ChatNavigationStore;";
    await writeFile(path.join(temporary, 'consumer.ts'), typeProbe);
    await writeFile(
      path.join(temporary, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          noEmit: true,
          strict: true,
          module: 'NodeNext',
          target: 'ES2022',
          lib: ['ES2022', 'DOM'],
          types: [],
        },
        files: ['consumer.ts'],
      }),
    );
    execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/typescript/bin/tsc'),
        '--project',
        'tsconfig.json',
      ],
      { cwd: temporary, encoding: 'utf8' },
    );
  } finally {
    const relative = path.relative(temporaryRoot, temporary);
    assert.ok(
      !relative.startsWith('..') &&
        !path.isAbsolute(relative) &&
        path.basename(temporary).startsWith('pagesquire-smoke-'),
    );
    await rm(temporary, { recursive: true, force: true });
  }
});
