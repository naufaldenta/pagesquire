import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { manifest } from '../../examples/brutalist-demo/capabilities.mjs';
import { art, styles } from '../../examples/brutalist-demo/art.mjs';
import { validateManifest } from '../../packages/protocol/dist/index.js';
import { distributionPathAllowed } from '../../scripts/distribution-sources.mjs';

test('OFFBEAT registers six bounded reversible capabilities, without fixture or generic click handlers', () => {
  assert.equal(validateManifest(manifest).valid, true);
  assert.equal(manifest.capabilities.length, 6);
  for (const capability of manifest.capabilities) {
    assert.equal(capability.risk, 'reversible');
    assert.equal(capability.execution, 'browser');
    assert.equal(capability.inputSchema.additionalProperties, false);
    assert.equal(capability.verification.handler, `${capability.id}.verify`);
    assert.ok(!capability.id.startsWith('testing.'));
    assert.ok(
      !['browser.click', 'browser.fill', 'browser.navigate'].includes(
        capability.id,
      ),
    );
  }
  const colors = manifest.capabilities.find((entry) =>
    entry.id.endsWith('set_heading_color'),
  );
  assert.deepEqual(colors.inputSchema.properties.color.enum, [
    '#171717',
    '#c52b28',
    '#6440d5',
  ]);
});

test('OFFBEAT style filters are unique and each declared category has original art', () => {
  assert.equal(new Set(art.map((item) => item.id)).size, art.length);
  for (const [style] of styles) {
    assert.ok(style === 'all' || art.some((item) => item.style === style));
  }
});

test('public READMEs link the live demo and document private chat with Supabase storage', async () => {
  for (const file of ['README.md', 'examples/brutalist-demo/README.md']) {
    const contents = await readFile(
      new URL(`../../${file}`, import.meta.url),
      'utf8',
    );
    assert.match(
      contents,
      /\]\(https:\/\/pagesquire-offbeat-demo\.vercel\.app\/\)/,
    );
    assert.match(
      contents,
      /live AI chat (?:uses the same runtime and )?requires the owner's private demo access code/i,
    );
    assert.match(contents, /Supabase PostgreSQL/);
  }
  const guide = await readFile(
    new URL('../../examples/brutalist-demo/README.md', import.meta.url),
    'utf8',
  );
  assert.match(guide, /Transaction pooler/);
  assert.match(guide, /Never paste the connection string/);
  const template = await readFile(
    new URL('../../examples/brutalist-demo/env.example', import.meta.url),
    'utf8',
  );
  assert.match(template, /^PAGESQUIRE_DATABASE_URL=$/m);
  assert.match(template, /^PAGESQUIRE_STORAGE_DRIVER=$/m);
});

test('public deployment serves the frontend and exact API routes, without client secrets', async () => {
  const config = JSON.parse(
    await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'),
  );
  assert.equal(config.framework, null);
  assert.equal(config.buildCommand, 'npm run demo:build');
  assert.equal(config.outputDirectory, 'examples/brutalist-demo/out');
  assert.deepEqual(config.rewrites, [
    { source: '/api/session', destination: '/api/assistant?route=session' },
    { source: '/api/chat', destination: '/api/assistant?route=chat' },
  ]);
  assert.equal(config.functions['api/assistant.mjs'].maxDuration, 60);
  const uploadIgnore = await readFile(
    new URL('../../.vercelignore', import.meta.url),
    'utf8',
  );
  for (const pattern of [
    '**/.env',
    '**/.env.*',
    '**/node_modules',
    '**/dist',
    '**/*.tsbuildinfo',
    'task_plan.md',
  ])
    assert.ok(uploadIgnore.split(/\r?\n/).includes(pattern), pattern);
  const page = await readFile(
    new URL('../../examples/brutalist-demo/app/page.jsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    page,
    /\bfetch\(|process\.env|localStorage|sessionStorage/,
  );
  assert.match(page, /<LiveChat/);
  const chat = await readFile(
    new URL('../../examples/brutalist-demo/app/live-chat.jsx', import.meta.url),
    'utf8',
  );
  assert.match(chat, /AssistantClient/);
  assert.doesNotMatch(chat, /process\.env|localStorage|sessionStorage/);
  const entry = await readFile(
    new URL('../../api/assistant.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(entry, /tests\/|Synthetic|fixture/i);
  assert.match(
    page,
    /result\.status === 'success' && result\.code === 'VERIFIED'/,
  );
  const env = await readFile(
    new URL('../../examples/brutalist-demo/env.example', import.meta.url),
    'utf8',
  );
  for (const line of env
    .split(/\r?\n/)
    .filter((line) => line.startsWith('PAGESQUIRE_')))
    assert.match(line, /^PAGESQUIRE_[A-Z_]+=$/);
});

test('static outputs, Vercel project links and real env files never enter source archives', () => {
  for (const file of [
    'examples/brutalist-demo/out/index.html',
    '.vercel/project.json',
    'examples/brutalist-demo/.env.local',
    'examples/brutalist-demo/.env.production',
  ])
    assert.equal(distributionPathAllowed(file), false, file);
  for (const file of [
    'vercel.json',
    'playwright.offbeat.config.mjs',
    'api/assistant.mjs',
    'examples/brutalist-demo/server/backend.mjs',
    'examples/brutalist-demo/env.example',
    'examples/brutalist-demo/public/art/offbeat-creatures.png',
  ])
    assert.equal(distributionPathAllowed(file), true, file);
});
