import path from 'node:path';
import { copyFile, mkdir } from 'node:fs/promises';
import { protocolSchemas } from '../packages/protocol/dist/schemas.js';
import { compileValidators, writeJson } from './compile-validators.mjs';

const destination = path.resolve('packages/protocol/dist');
await compileValidators(
  protocolSchemas,
  path.join(destination, 'generated/validators.js'),
);
for (const [name, schema] of Object.entries(protocolSchemas)) {
  await writeJson(path.join(destination, `schemas/${name}.json`), schema);
  await writeJson(
    path.resolve(`packages/php/resources/schemas/${name}.json`),
    schema,
  );
}
await copyFile('LICENSE', path.join(destination, 'LICENSE'));
await mkdir(path.join(destination, 'third-party'), { recursive: true });
await copyFile(
  'node_modules/ajv/LICENSE',
  path.join(destination, 'third-party/AJV-LICENSE'),
);
