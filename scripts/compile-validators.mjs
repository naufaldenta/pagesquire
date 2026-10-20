import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneModule from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';

const standaloneCode = standaloneModule.default ?? standaloneModule;

export async function compileValidators(schemas, outputFile) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    ownProperties: true,
    code: { source: true, esm: true },
  });
  const exports = {};
  for (const [name, schema] of Object.entries(schemas)) {
    ajv.addSchema(schema);
    exports[name] = schema.$id;
  }
  const generated = standaloneCode(ajv, exports);
  await mkdir(path.dirname(outputFile), { recursive: true });
  await build({
    stdin: { contents: generated, resolveDir: process.cwd(), loader: 'js' },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outfile: outputFile,
    legalComments: 'inline',
  });
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
