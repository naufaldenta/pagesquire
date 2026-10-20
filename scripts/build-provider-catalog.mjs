import { readFile, writeFile, rm } from 'node:fs/promises';

export async function buildProviderCatalog() {
  const root = new URL('../', import.meta.url);
  const catalog = JSON.parse(
    await readFile(
      new URL('packages/php/resources/providers.json', root),
      'utf8',
    ),
  );
  await writeFile(
    new URL('packages/server/dist/provider-presets.js', root),
    `export default ${JSON.stringify(catalog, null, 2)};\n`,
  );
  await rm(new URL('packages/server/dist/providers.json', root), {
    force: true,
  });
}
