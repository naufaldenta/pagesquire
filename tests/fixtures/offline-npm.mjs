import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const offlineNpmEnvironment = {
  ...process.env,
  npm_config_registry: 'http://127.0.0.1:9',
  npm_config_replace_registry_host: 'never',
};

export async function lockedNpmHost(root) {
  const lock = JSON.parse(
    await readFile(path.join(root, 'package-lock.json'), 'utf8'),
  );
  assert.equal(lock.lockfileVersion, 3);
  const dependencies = {};
  const packages = {};
  const visit = (name, from = '') => {
    assert.ok(!name.startsWith('@pagesquire/'));
    let parent = from;
    let location;
    while (true) {
      const candidate = `${parent ? `${parent}/` : ''}node_modules/${name}`;
      if (lock.packages[candidate]) {
        location = candidate;
        break;
      }
      if (!parent) throw Error(`Missing locked dependency: ${name}`);
      parent = parent.replace(/(?:^|\/)node_modules\/[^/]+(?:\/[^/]+)?$/, '');
    }
    const entry = lock.packages[location];
    assert.ok(!entry.link && entry.resolved && entry.integrity, location);
    if (!packages[location]) {
      packages[location] = { ...entry };
      delete packages[location].dev;
      delete packages[location].devOptional;
      for (const child of Object.keys({
        ...entry.dependencies,
        ...entry.optionalDependencies,
      }))
        visit(child, location);
    }
    return entry.version;
  };
  const workspaceEntries = Object.entries(lock.packages).filter(([name]) =>
    name.startsWith('packages/'),
  );
  const external = new Set(['react', '@types/react']);
  for (const [, entry] of workspaceEntries)
    for (const name of Object.keys(entry.dependencies ?? {}))
      if (!name.startsWith('@pagesquire/')) external.add(name);
  for (const name of external) dependencies[name] = visit(name);
  const manifest = {
    name: 'pagesquire-offline-host',
    version: '1.0.0',
    private: true,
    type: 'module',
    dependencies,
  };
  return {
    manifest,
    lock: {
      name: manifest.name,
      version: manifest.version,
      lockfileVersion: 3,
      requires: true,
      packages: { '': manifest, ...packages },
    },
  };
}

export function packedNpmManifest(tarball) {
  const contents = gunzipSync(tarball);
  for (let offset = 0; offset + 512 <= contents.length;) {
    const header = contents.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    if (!name) break;
    const size = Number.parseInt(
      header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(),
      8,
    );
    assert.ok(Number.isSafeInteger(size) && size >= 0);
    const start = offset + 512;
    assert.ok(start + size <= contents.length);
    if (name === 'package/package.json') {
      assert.ok(header[156] === 0 || header[156] === 48);
      return JSON.parse(contents.subarray(start, start + size).toString());
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw Error('Packed npm manifest is missing.');
}

export async function writeLockedNpmConsumer(root, directory, tarballs) {
  const fixture = await lockedNpmHost(root);
  for (const tarball of tarballs) {
    const bytes = await readFile(tarball);
    const manifest = packedNpmManifest(bytes);
    assert.ok(manifest.name.startsWith('@pagesquire/'));
    assert.ok(!fixture.manifest.dependencies[manifest.name]);
    const resolved = `file:${path.relative(directory, tarball).replaceAll('\\', '/')}`;
    fixture.manifest.dependencies[manifest.name] = resolved;
    const entry = {
      version: manifest.version,
      resolved,
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    };
    for (const name of [
      'dependencies',
      'optionalDependencies',
      'peerDependencies',
      'peerDependenciesMeta',
      'bin',
      'engines',
      'license',
    ])
      if (manifest[name]) entry[name] = manifest[name];
    fixture.lock.packages[`node_modules/${manifest.name}`] = entry;
  }
  await writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify(fixture.manifest),
  );
  await writeFile(
    path.join(directory, 'package-lock.json'),
    JSON.stringify(fixture.lock),
  );
}
