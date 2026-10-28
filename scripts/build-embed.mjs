import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { validateManifest } from '../packages/protocol/dist/index.js';
import { compileValidators } from './compile-validators.mjs';
import { manifest } from '../packages/embed/src/capabilities.mjs';

const validation = validateManifest(manifest);
if (!validation.valid) throw new Error(validation.errors.join('; '));
const packageRoot = path.resolve('packages/embed');
const dist = path.join(packageRoot, 'dist');
const generated = path.join(dist, 'generated');
const schemas = {};
const bindings = [];
for (const [index, capability] of manifest.capabilities.entries()) {
  schemas[`p${index}`] = {
    ...capability.inputSchema,
    $id: `urn:pagesquire:embed:${index}`,
  };
  bindings.push(
    `${JSON.stringify(capability.id)}:{schema:${JSON.stringify(capability.inputSchema)},validate:validators.p${index}}`,
  );
}
await compileValidators(schemas, path.join(generated, 'parameters.mjs'));
await writeFile(
  path.join(generated, 'bindings.mjs'),
  `import * as validators from './parameters.mjs'; export const parameters={${bindings.join(',')}};`,
);
await writeFile(
  path.join(dist, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
await build({
  entryPoints: [path.join(packageRoot, 'src/embed.mjs')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  loader: { '.css': 'text' },
  outfile: path.join(dist, 'pagesquire.min.js'),
  legalComments: 'inline',
});
await copyFile(
  'packages/client/src/widget.css',
  path.join(dist, 'pagesquire.css'),
);
// The localhost demo server serves only examples/plain-html.
const demo = path.resolve('examples/plain-html/dist/embed');
await mkdir(demo, { recursive: true });
for (const file of [
  'pagesquire.min.js',
  'pagesquire.min.js.map',
  'pagesquire.css',
])
  await copyFile(path.join(dist, file), path.join(demo, file));
console.log(`Built one-tag embed: ${path.join(dist, 'pagesquire.min.js')}`);
