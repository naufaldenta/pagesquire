import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectFiles, initialize, json } from '@pagesquire/cli';
import { manifest } from './capabilities.mjs';

export async function temporaryProject(t, url) {
  const parent = path.resolve(os.tmpdir());
  const root = await mkdtemp(path.join(parent, 'pagesquire-onboarding-'));
  t.after(async () => {
    const relative = path.relative(parent, root);
    assert.ok(
      relative &&
        !relative.startsWith('..') &&
        !path.isAbsolute(relative) &&
        path.basename(root).startsWith('pagesquire-onboarding-'),
    );
    await rm(root, { recursive: true, force: true });
  });
  const files = await ProjectFiles.at(root);
  const put = async (name, text) => {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
  };
  await initialize(files, url);
  return { root, files, put };
}
export async function registerFixture(project, count = 1, moduleSource) {
  const capabilities = structuredClone(manifest.capabilities.slice(0, count));
  const handlers = {};
  const verifiers = {};
  for (const [index, capability] of capabilities.entries()) {
    handlers[capability.handler] = {
      module: 'pagesquire/adapter.mjs',
      export: `handler${index}`,
    };
    verifiers[capability.verification.handler] = {
      module: 'pagesquire/adapter.mjs',
      export: `verifier${index}`,
    };
  }
  await project.put(
    'pagesquire/capabilities.json',
    json({ schemaVersion: '0.1', capabilities }),
  );
  await project.put(
    'pagesquire/bindings.json',
    json({ schemaVersion: '0.1', handlers, verifiers }),
  );
  await project.put(
    'pagesquire/adapter.mjs',
    moduleSource ??
      capabilities
        .map(
          (_, index) =>
            `export function handler${index}() {}\nexport const verifier${index} = () => ({verified:false});`,
        )
        .join('\n'),
  );
  return capabilities;
}
