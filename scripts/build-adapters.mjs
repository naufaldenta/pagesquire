import { copyFile } from 'node:fs/promises';
await copyFile(
  'packages/php/resources/providers.json',
  'packages/server/dist/providers.json',
);
for (const name of ['client', 'react', 'server'])
  await copyFile('LICENSE', `packages/${name}/dist/LICENSE`);
await copyFile(
  'packages/client/src/widget.css',
  'packages/client/dist/widget.css',
);
for (const name of ['php', 'laravel'])
  await copyFile('LICENSE', `packages/${name}/LICENSE`);
