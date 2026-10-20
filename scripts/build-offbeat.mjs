import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileValidators } from './compile-validators.mjs';
import { manifest } from '../examples/brutalist-demo/capabilities.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(script, args) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, script), ...args],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${script} failed (${result.status}).`);
}
run('node_modules/typescript/bin/tsc', ['-b', 'packages/protocol']);
run('scripts/build-protocol.mjs', []);
run('node_modules/typescript/bin/tsc', ['-b', 'packages/core']);
const { validateManifest } = await import('../packages/protocol/dist/index.js');
const validation = validateManifest(manifest);
if (!validation.valid) throw Error(validation.errors.join('; '));
const schemas = {};
const bindings = [];
for (const [index, definition] of manifest.capabilities.entries()) {
  schemas[`p${index}`] = {
    ...definition.inputSchema,
    $id: `urn:pagesquire:offbeat:${index}`,
  };
  bindings.push(
    `${JSON.stringify(definition.id)}: { schema: ${JSON.stringify(definition.inputSchema)}, validate: validators.p${index} }`,
  );
}
const generated = path.join(root, 'examples/brutalist-demo/dist');
await compileValidators(schemas, path.join(generated, 'parameters.js'));
await writeFile(
  path.join(generated, 'bindings.js'),
  `import * as validators from './parameters.js';\nexport const parameters = { ${bindings.join(',\n')} };\n`,
);
const publicDir = path.join(root, 'examples/brutalist-demo/public');
await mkdir(publicDir, { recursive: true });
await copyFile(
  path.join(root, 'LICENSE'),
  path.join(publicDir, 'pagesquire-license.txt'),
);
if (process.argv.includes('--prepare-only')) {
  console.log('OFFBEAT browser capabilities compiled. Live AI remains locked.');
} else {
  run('node_modules/next/dist/bin/next', [
    'build',
    'examples/brutalist-demo',
    '--webpack',
  ]);
}
