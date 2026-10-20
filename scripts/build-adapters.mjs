import { copyFile } from 'node:fs/promises';
import { buildProviderCatalog } from './build-provider-catalog.mjs';
await buildProviderCatalog();
for (const name of ['client', 'react', 'server'])
  await copyFile('LICENSE', `packages/${name}/dist/LICENSE`);
await copyFile(
  'packages/client/src/widget.css',
  'packages/client/dist/widget.css',
);
for (const name of ['php', 'laravel'])
  await copyFile('LICENSE', `packages/${name}/LICENSE`);
