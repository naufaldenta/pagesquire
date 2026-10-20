import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { compileValidators } from './compile-validators.mjs';
import { root, cache, download, run, exists } from './wordpress-tools.mjs';
import { collectDistributionSources } from './distribution-sources.mjs';
import { manifest } from '../packages/wordpress/js/capabilities.mjs';

const packageRoot = path.join(root, 'packages/wordpress');
await mkdir(path.join(packageRoot, 'dist/generated'), { recursive: true });
const scoper = await download(
  'https://github.com/humbug/php-scoper/releases/download/0.18.20/php-scoper.phar',
  'php-scoper-0.18.20.phar',
  '5e35e4a89ea53b2c70a19bfa8a856e4f9080aa12eb13a5bce650bb69d08eb122',
);
const stage = await mkdtemp(path.join(cache, 'build-'));
const dependencies = path.join(stage, 'dependency-source');
await mkdir(dependencies);
await cp(
  path.join(root, 'packages/php/src'),
  path.join(dependencies, 'pagesquire/src'),
  { recursive: true },
);
await cp(
  path.join(root, 'packages/php/resources'),
  path.join(dependencies, 'pagesquire/resources'),
  { recursive: true },
);
await copyFile(
  path.join(root, 'LICENSE'),
  path.join(dependencies, 'pagesquire/LICENSE'),
);
for (const name of ['json-schema', 'string', 'uri']) {
  const source = path.join(root, 'vendor/opis', name);
  const target = path.join(dependencies, 'opis', name);
  await cp(path.join(source, 'src'), path.join(target, 'src'), {
    recursive: true,
  });
  for (const license of ['LICENSE', 'LICENSE.txt', 'NOTICE', 'NOTICE.txt'])
    if (await exists(path.join(source, license)))
      await copyFile(path.join(source, license), path.join(target, license));
}
const target = path.join(stage, 'pagesquire');
await mkdir(target);
const scoped = path.join(target, 'runtime');
await run(
  'php',
  [
    scoper,
    'add-prefix',
    '.',
    '--config',
    path.join(packageRoot, 'scoper.inc.php'),
    '--output-dir',
    scoped,
    '--no-interaction',
    '--force',
  ],
  { cwd: dependencies },
);
await copyFile(
  path.join(packageRoot, 'runtime-autoload.php'),
  path.join(scoped, 'autoload.php'),
);
for (const file of [
  'autoload.php',
  'pagesquire.php',
  'README.md',
  'readme.txt',
  'LICENSE',
  'THIRD-PARTY.md',
])
  if (await exists(path.join(packageRoot, file)))
    await copyFile(path.join(packageRoot, file), path.join(target, file));
await cp(path.join(packageRoot, 'src'), path.join(target, 'src'), {
  recursive: true,
});
await cp(path.join(packageRoot, 'views'), path.join(target, 'views'), {
  recursive: true,
});
await cp(path.join(packageRoot, 'js'), path.join(target, 'source'), {
  recursive: true,
});
const assets = path.join(target, 'assets');
await mkdir(assets);
await writeFile(
  path.join(assets, 'manifest.json'),
  JSON.stringify(manifest, null, 2),
);
const schemas = {};
const bindings = [];
for (const [index, capability] of manifest.capabilities.entries()) {
  schemas[`p${index}`] = {
    ...capability.inputSchema,
    $id: `urn:pagesquire:wordpress:${index}`,
  };
  bindings.push(
    `${JSON.stringify(capability.id)}:{schema:${JSON.stringify(capability.inputSchema)},validate:validators.p${index}}`,
  );
}
const generated = path.join(packageRoot, 'dist/generated');
await compileValidators(schemas, path.join(generated, 'parameters.mjs'));
await writeFile(
  path.join(generated, 'bindings.mjs'),
  `import * as validators from './parameters.mjs'; export const parameters={${bindings.join(',')}};`,
);
for (const name of ['frontend', 'admin'])
  if (await exists(path.join(packageRoot, 'js', `${name}.mjs`))) {
    await build({
      entryPoints: [path.join(packageRoot, 'js', `${name}.mjs`)],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      minify: true,
      sourcemap: true,
      outfile: path.join(assets, `${name}.js`),
      legalComments: 'inline',
    });
  }
for (const name of ['plugin.css', 'assistant-setup.md'])
  if (await exists(path.join(packageRoot, name)))
    await copyFile(path.join(packageRoot, name), path.join(assets, name));
await copyFile(
  path.join(root, 'packages/client/src/widget.css'),
  path.join(assets, 'widget.css'),
);
await copyFile(
  path.join(root, 'LICENSE'),
  path.join(assets, 'SHARED-MIT-LICENSE'),
);
await copyFile(
  path.join(root, 'node_modules/ajv/LICENSE'),
  path.join(assets, 'AJV-LICENSE'),
);
if (await exists(path.join(root, 'node_modules/fflate/LICENSE')))
  await copyFile(
    path.join(root, 'node_modules/fflate/LICENSE'),
    path.join(assets, 'FFLATE-LICENSE'),
  );
// Include complete editable project/build sources as a non-executable nested archive.
const corresponding = path.join(stage, 'corresponding-source');
await mkdir(corresponding);
for (const [name, bytes] of await collectDistributionSources(root)) {
  const destination = path.join(corresponding, name);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
}
await run('php', [
  'scripts/wordpress-archive.php',
  'zip',
  corresponding,
  path.join(target, 'corresponding-source.zip'),
]);
await cp(target, path.join(packageRoot, 'dist/pagesquire'), {
  recursive: true,
});
const metadata = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8'),
);
const archive = path.join(
  packageRoot,
  `dist/pagesquire-${metadata.version}.zip`,
);
await run('php', ['scripts/wordpress-archive.php', 'zip', target, archive]);
console.log(`Built installation-ready plugin: ${archive}`);
