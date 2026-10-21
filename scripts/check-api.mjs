import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { safeArchivePath } from './distribution-sources.mjs';

export const apiRoot = path.resolve(import.meta.dirname, '..');
export const apiPackages = [
  'protocol',
  'core',
  'client',
  'react',
  'cli',
  'server',
];
const phpPackages = ['php', 'laravel', 'wordpress'];
const status = 'review-baseline-not-frozen';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const encode = (value) => JSON.stringify(canonical(value));
const digest = (value) => createHash('sha256').update(value).digest('hex');

/** Read a fixed public checkout surface, never follow links or execute host code. */
export async function captureApi(root = apiRoot) {
  root = path.resolve(root);
  if ((await realpath(root)) !== root)
    throw Error('API review needs a real checkout directory.');
  async function info(relative) {
    if (!safeArchivePath(relative)) throw Error('Unsafe API review input.');
    let absolute = root;
    let result;
    for (const part of relative.split('/')) {
      absolute = path.join(absolute, part);
      result = await lstat(absolute);
      if (result.isSymbolicLink())
        throw Error('API review inputs must not be links.');
    }
    return result;
  }
  async function text(relative) {
    if (!(await info(relative)).isFile())
      throw Error('API review input must be a regular file.');
    return (await readFile(path.join(root, relative), 'utf8')).replaceAll(
      '\r\n',
      '\n',
    );
  }
  const json = async (relative) => JSON.parse(await text(relative));
  const files = {};
  async function manifest(relative, fields) {
    const data = await json(relative);
    files[relative] = digest(
      encode(
        Object.fromEntries(
          fields
            .filter((field) => Object.hasOwn(data, field))
            .map((field) => [field, data[field]]),
        ),
      ),
    );
  }
  async function tree(relative, extension) {
    const before = Object.keys(files).length;
    async function visit(relative) {
      const stat = await info(relative);
      if (stat.isDirectory())
        for (const name of (await readdir(path.join(root, relative))).sort())
          await visit(`${relative}/${name}`);
      else if (stat.isFile() && relative.endsWith(extension))
        files[relative] = digest(
          extension === '.json'
            ? encode(await json(relative))
            : await text(relative),
        );
      else if (!stat.isFile()) throw Error('Unsupported API review input.');
    }
    await visit(relative);
    if (Object.keys(files).length === before)
      throw Error('API review surface is empty; run npm run build.');
  }
  for (const name of apiPackages) {
    await manifest(`packages/${name}/package.json`, [
      'name',
      'type',
      'exports',
      'bin',
      'engines',
      'dependencies',
      'peerDependencies',
      'peerDependenciesMeta',
    ]);
    await tree(`packages/${name}/dist`, '.d.ts');
  }
  await tree('packages/protocol/dist/schemas', '.json');
  for (const name of phpPackages) {
    await manifest(`packages/${name}/composer.json`, [
      'name',
      'type',
      'require',
      'autoload',
      'extra',
      'suggest',
    ]);
    await tree(`packages/${name}/src`, '.php');
  }
  files['packages/wordpress/pagesquire.php'] = digest(
    await text('packages/wordpress/pagesquire.php'),
  );
  return canonical({
    schemaVersion: 1,
    status,
    packageVersion: (await json('package.json')).version,
    files,
  });
}

/** Fingerprints require human compatibility review, not blind rebaselining. */
export async function checkApi(root = apiRoot) {
  const current = await captureApi(root);
  const docs = await lstat(path.join(root, 'docs'));
  if (!docs.isDirectory() || docs.isSymbolicLink())
    throw Error('API baseline directory must not be a link.');
  const file = path.join(root, 'docs/api-baseline.json');
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw Error('API baseline must be a regular file.');
  const baseline = JSON.parse(await readFile(file, 'utf8'));
  if (
    baseline.schemaVersion !== 1 ||
    baseline.status !== status ||
    typeof baseline.packageVersion !== 'string' ||
    !baseline.files ||
    typeof baseline.files !== 'object' ||
    Array.isArray(baseline.files) ||
    Object.keys(baseline).sort().join(',') !==
      'files,packageVersion,schemaVersion,status' ||
    Object.keys(baseline.files).length > 1000 ||
    Object.entries(baseline.files).some(
      ([name, hash]) =>
        !safeArchivePath(name) ||
        !name.startsWith('packages/') ||
        typeof hash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw Error('Invalid API review baseline.');
  const added = Object.keys(current.files).filter(
    (name) => !Object.hasOwn(baseline.files, name),
  );
  const removed = Object.keys(baseline.files).filter(
    (name) => !Object.hasOwn(current.files, name),
  );
  const changed = Object.keys(current.files).filter(
    (name) =>
      Object.hasOwn(baseline.files, name) &&
      current.files[name] !== baseline.files[name],
  );
  const versionChanged = current.packageVersion !== baseline.packageVersion;
  return {
    valid:
      !versionChanged && !added.length && !removed.length && !changed.length,
    status,
    versionChanged,
    added,
    removed,
    changed,
    entries: Object.keys(current.files).length,
  };
}

if (
  import.meta.main ??
  (process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(import.meta.filename))
) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== 'capture'))
      throw Error(
        'Usage: check-api.mjs [capture]. No automatic baseline writer or version promotion.',
      );
    const result =
      args[0] === 'capture' ? await captureApi() : await checkApi();
    console.log(JSON.stringify(result, null, 2));
    if (result.valid === false) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
