import { writeFile, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { validateManifest } from '../packages/protocol/dist/index.js';
import { manifest } from '../tests/fixtures/capabilities.mjs';
import { compileValidators } from './compile-validators.mjs';
import { drivingManifest } from '../examples/plain-html/driving-capabilities.mjs';

const validation = validateManifest(manifest);
if (!validation.valid) throw new Error(validation.errors.join('; '));
await copyFile('LICENSE', 'packages/core/dist/LICENSE');
const schemas = {};
const bindings = [];
const ids = new Set();
for (const [index, capability] of manifest.capabilities.entries()) {
  if (ids.has(capability.id)) throw new Error('Duplicate fixture capability.');
  ids.add(capability.id);
  const name = `p${index}`;
  schemas[name] = {
    ...capability.inputSchema,
    $id: `urn:pagesquire:fixture:${index}`,
  };
  bindings.push(
    `${JSON.stringify(capability.id)}: { schema: ${JSON.stringify(capability.inputSchema)}, validate: validators.${name} }`,
  );
}
const generated = path.resolve('tests/fixtures/dist');
await compileValidators(schemas, path.join(generated, 'parameters.js'));
await writeFile(
  path.join(generated, 'manifest.json'),
  JSON.stringify(manifest, null, 2),
);
await mkdir('examples/plain-html/dist', { recursive: true });
await copyFile(
  'packages/client/src/widget.css',
  'examples/plain-html/dist/widget.css',
);
await writeFile(
  path.join(generated, 'bindings.js'),
  `import * as validators from './parameters.js';\nexport const parameters = { ${bindings.join(',\n')} };\n`,
);
await build({
  entryPoints: ['examples/plain-html/main.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  outfile: 'examples/plain-html/dist/demo.js',
});
await build({
  entryPoints: ['examples/plain-html/react-demo.tsx'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  outfile: 'examples/plain-html/dist/react-demo.js',
});
const drivingSchemas = {};
const drivingBindings = [];
for (const [index, definition] of drivingManifest.capabilities.entries()) {
  const name = `d${index}`;
  drivingSchemas[name] = {
    ...definition.inputSchema,
    $id: `urn:pagesquire:driving:${index}`,
  };
  drivingBindings.push(
    `${JSON.stringify(definition.id)}: { schema: ${JSON.stringify(definition.inputSchema)}, validate: validators.${name} }`,
  );
}
if (!validateManifest(drivingManifest).valid)
  throw Error('Invalid driving example manifest.');
await compileValidators(
  drivingSchemas,
  'examples/plain-html/dist/driving-parameters.js',
);
await writeFile(
  'examples/plain-html/dist/driving-bindings.js',
  `import * as validators from './driving-parameters.js';\nexport const parameters = { ${drivingBindings.join(',\n')} };\n`,
);
await build({
  entryPoints: ['examples/plain-html/driving.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'examples/plain-html/dist/driving.js',
});
