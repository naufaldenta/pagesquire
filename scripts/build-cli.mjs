import { build } from 'esbuild';
import { copyFile, cp, mkdir } from 'node:fs/promises';
await build({
  entryPoints: ['packages/cli/src/dom-probe.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'PageSquireProbe',
  platform: 'browser',
  target: 'es2022',
  outfile: 'packages/cli/dist/browser-probe.js',
  minify: true,
});
await mkdir('packages/cli/dist/templates', { recursive: true });
await cp('packages/cli/templates', 'packages/cli/dist/templates', {
  recursive: true,
});
await copyFile('LICENSE', 'packages/cli/dist/LICENSE');
