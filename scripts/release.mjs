import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { zipSync, unzipSync } from 'fflate';
import {
  collectDistributionSources,
  distributionPathAllowed,
  safeArchivePath,
} from './distribution-sources.mjs';

const execute = promisify(execFile);
export const projectRoot = path.resolve(import.meta.dirname, '..');
export const npmPackages = [
  'protocol',
  'core',
  'client',
  'react',
  'cli',
  'server',
];
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
export const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');
const encodeJson = (value) => `${JSON.stringify(value, null, 2)}\n`;
const filenameAllowed = (name) =>
  typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name);
const alphaVersion = (version) =>
  typeof version === 'string' && /^0\.\d+\.\d+-alpha\.\d+$/.test(version);
const expectedArtifacts = (version) => [
  ...npmPackages.map((name) => `pagesquire-${name}-${version}.tgz`),
  `pagesquire-source-${version}.zip`,
  `pagesquire-server-${version}.zip`,
  `pagesquire-laravel-${version}.zip`,
  `pagesquire-${version}.zip`,
  'composer-repositories.json',
  'RELEASE_NOTES.md',
];

export async function buildEvidence(root = projectRoot) {
  const outputs = new Map();
  async function visit(relative) {
    const info = await lstat(path.join(root, relative));
    if (info.isSymbolicLink())
      throw Error(`Build output is a link: ${relative}`);
    if (info.isDirectory())
      for (const name of (await readdir(path.join(root, relative))).sort())
        await visit(`${relative}/${name}`);
    else if (info.isFile()) {
      if (!safeArchivePath(relative))
        throw Error(`Unsafe build output: ${relative}`);
      outputs.set(relative, await readFile(path.join(root, relative)));
    } else throw Error(`Unsupported build output: ${relative}`);
  }
  for (const name of npmPackages) await visit(`packages/${name}/dist`);
  const pkg = await json(path.join(root, 'package.json'));
  await visit(`packages/wordpress/dist/pagesquire-${pkg.version}.zip`);
  return {
    schemaVersion: 1,
    sourceDigest: sourceDigest(await collectDistributionSources(root)),
    outputs: Object.fromEntries(
      [...outputs].sort().map(([name, bytes]) => [name, sha256(bytes)]),
    ),
  };
}

async function outputParent(root) {
  let directory = root;
  for (const name of ['dist', 'releases']) {
    directory = path.join(directory, name);
    await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error('Release output directory must not be a link.');
  }
  return directory;
}

export function zipSources(files, prefix) {
  if (!filenameAllowed(prefix)) throw Error('Invalid archive prefix.');
  const entries = {};
  for (const [name, bytes] of files) {
    if (!distributionPathAllowed(name))
      throw Error(`Unsafe archive path: ${name}`);
    entries[`${prefix}/${name}`] = [
      bytes,
      { mtime: new Date('2025-01-01T00:00:00Z'), os: 3, attrs: 0o100644 << 16 },
    ];
  }
  return zipSync(entries, { level: 6 });
}

export function sourceDigest(files) {
  return sha256(
    [...files]
      .map(([name, bytes]) => `${name}\0${sha256(bytes)}\n`)
      .sort()
      .join(''),
  );
}

export async function checkDocumentation(root, files) {
  const errors = [];
  let guides = 0;
  let links = 0;
  for (const [name, bytes] of files) {
    if (!name.endsWith('.md')) continue;
    guides++;
    const content = bytes.toString('utf8');
    for (const match of content.matchAll(/```json\s*\r?\n([\s\S]*?)```/g)) {
      try {
        JSON.parse(match[1]);
      } catch {
        errors.push(`${name}: invalid fenced JSON`);
      }
    }
    const prose = content.replace(/```[^\n]*\n[\s\S]*?```/g, '');
    for (const match of prose.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)) {
      const link = match[1];
      if (/^(?:[a-z]+:|#)/i.test(link)) continue;
      const target = path.resolve(
        root,
        path.dirname(name),
        decodeURIComponent(link.split('#')[0]),
      );
      if (
        path.relative(root, target).startsWith('..') ||
        path.isAbsolute(path.relative(root, target))
      ) {
        errors.push(`${name}: link escapes project`);
        continue;
      }
      try {
        await lstat(target);
        links++;
      } catch {
        errors.push(`${name}: missing link ${link}`);
      }
    }
  }
  return { guides, links, errors };
}

export async function checkRelease(root = projectRoot) {
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const pkg = await json(path.join(root, 'package.json'));
  const lock = await json(path.join(root, 'package-lock.json'));
  const config = await json(path.join(root, 'release.config.json'));
  const compatibility = await json(path.join(root, 'docs/compatibility.json'));
  const version = pkg.version;
  check(
    alphaVersion(version),
    'Only the reviewed 0.x alpha release channel is implemented.',
  );
  check(pkg.private === true, 'Workspace must remain private.');
  check(
    lock.version === version && lock.packages[''].version === version,
    'Root lockfile version differs.',
  );
  check(
    config.schemaVersion === 1 && config.channel === 'github-alpha',
    'Unsupported release configuration.',
  );
  check(
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(
      config.repository?.owner ?? '',
    ) && config.repository?.name === 'pagesquire',
    'Invalid GitHub repository identity.',
  );
  check(
    ['npm', 'packagist', 'wordpress'].every(
      (name) => config.registries?.[name] === 'deferred',
    ),
    'Registry publishing must remain deferred.',
  );
  const gateNames = [
    'repositoryCreated',
    'privateSecurityReportingEnabled',
    'redistributionReviewed',
    'remoteCiPassed',
    'ownerApprovedRelease',
  ];
  check(
    gateNames.every((name) => typeof config.publication?.[name] === 'boolean'),
    'Publication gates must be explicit booleans.',
  );
  for (const name of npmPackages) {
    const item = await json(path.join(root, `packages/${name}/package.json`));
    check(
      item.name === `@pagesquire/${name}` && item.version === version,
      `${name}: package identity/version differs.`,
    );
    check(
      item.private === true && item.license === 'MIT',
      `${name}: private/MIT boundary differs.`,
    );
    check(
      lock.packages[`packages/${name}`]?.version === version,
      `${name}: lockfile version differs.`,
    );
    for (const [dependency, constraint] of Object.entries(
      item.dependencies ?? {},
    ))
      if (dependency.startsWith('@pagesquire/'))
        check(
          constraint === version,
          `${name}: internal dependency is not synchronized.`,
        );
  }
  for (const [directory, name, license] of [
    ['php', 'server', 'MIT'],
    ['laravel', 'laravel', 'MIT'],
    ['wordpress', 'wordpress', 'GPL-3.0-or-later'],
  ]) {
    const item = await json(
      path.join(root, `packages/${directory}/composer.json`),
    );
    check(
      item.name === `pagesquire/${name}` && item.license === license,
      `${directory}: Composer identity/license differs.`,
    );
    await lstat(path.join(root, `packages/${directory}/LICENSE`));
  }
  const header = await readFile(
    path.join(root, 'packages/wordpress/pagesquire.php'),
    'utf8',
  );
  const readme = await readFile(
    path.join(root, 'packages/wordpress/readme.txt'),
    'utf8',
  );
  check(
    header.includes(`Version: ${version}\n`) ||
      header.includes(`Version: ${version}\r\n`),
    'WordPress plugin version differs.',
  );
  check(
    readme.includes(`Stable tag: ${version}`),
    'WordPress stable tag differs.',
  );
  check(
    header.includes('License: GPL-3.0-or-later'),
    'WordPress GPL boundary differs.',
  );
  check(
    (
      await readFile(path.join(root, 'docs/release-notes.md'), 'utf8')
    ).startsWith(`# PageSquire ${version} `),
    'Release notes version differs.',
  );
  check(
    compatibility.schemaVersion === 1 && compatibility.release === version,
    'Compatibility release differs.',
  );
  const composer = await json(path.join(root, 'composer.lock'));
  for (const [name, expected] of Object.entries(compatibility.npm ?? {}))
    check(
      lock.packages[`node_modules/${name}`]?.version === expected,
      `Compatibility npm version differs: ${name}`,
    );
  for (const [name, expected] of Object.entries(compatibility.composer ?? {}))
    check(
      [...composer.packages, ...composer['packages-dev']].find(
        (item) => item.name === name,
      )?.version === expected,
      `Compatibility Composer version differs: ${name}`,
    );
  for (const target of compatibility.targets ?? []) {
    check(
      target.status === 'local-fixture',
      `Unsupported compatibility claim: ${target.id}`,
    );
    check(
      target.evidence?.length > 0,
      `Missing compatibility evidence: ${target.id}`,
    );
    for (const evidence of target.evidence ?? []) {
      check(
        distributionPathAllowed(evidence) && !path.isAbsolute(evidence),
        `Unsafe evidence path: ${target.id}`,
      );
      if (distributionPathAllowed(evidence) && !path.isAbsolute(evidence))
        await lstat(path.join(root, evidence));
    }
  }
  const files = await collectDistributionSources(root);
  const documentation = await checkDocumentation(root, files);
  errors.push(...documentation.errors);
  const gates = gateNames.filter((name) => config.publication?.[name] !== true);
  let commit = null;
  let dirty = true;
  try {
    commit = (
      await execute('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        windowsHide: true,
      })
    ).stdout.trim();
    dirty =
      (
        await execute('git', ['status', '--porcelain'], {
          cwd: root,
          windowsHide: true,
        })
      ).stdout.trim().length > 0;
    const remote = (
      await execute('git', ['remote', 'get-url', 'origin'], {
        cwd: root,
        windowsHide: true,
      })
    ).stdout.trim();
    const identity = `${config.repository.owner}/${config.repository.name}`;
    if (
      ![
        `https://github.com/${identity}`,
        `https://github.com/${identity}.git`,
        `git@github.com:${identity}.git`,
      ].includes(remote)
    )
      gates.push('originDoesNotMatch');
  } catch {
    gates.push('committedOriginRequired');
  }
  if (dirty) gates.push('cleanCheckoutRequired');
  return {
    valid: errors.length === 0,
    version,
    channel: config.channel,
    repository: config.repository,
    errors,
    publicationReady: errors.length === 0 && gates.length === 0,
    gates,
    commit,
    dirty,
    documentation,
    sourceDigest: sourceDigest(files),
  };
}

export function assertWordPressSources(archive, files) {
  const plugin = unzipSync(archive);
  if (!plugin['pagesquire/corresponding-source.zip'])
    throw Error('WordPress corresponding source is missing.');
  const source = unzipSync(plugin['pagesquire/corresponding-source.zip']);
  const expected = new Set(
    [...files.keys()].map((name) => `pagesquire/${name}`),
  );
  const actual = Object.keys(source).filter((name) => !name.endsWith('/'));
  if (
    actual.length !== expected.size ||
    actual.some((name) => !expected.has(name))
  )
    throw Error('Stale WordPress source inventory; run npm run build.');
  for (const [name, bytes] of files)
    if (sha256(source[`pagesquire/${name}`]) !== sha256(bytes))
      throw Error(`Stale WordPress source: ${name}; run npm run build.`);
}

export async function prepareRelease(root = projectRoot) {
  const report = await checkRelease(root);
  if (!report.valid) throw Error(report.errors.join('\n'));
  const files = await collectDistributionSources(root);
  const stamp = await json(path.join(root, 'dist/build-evidence.json'));
  if (JSON.stringify(stamp) !== JSON.stringify(await buildEvidence(root)))
    throw Error('Stale build evidence; run npm run build.');
  const wpPath = path.join(
    root,
    `packages/wordpress/dist/pagesquire-${report.version}.zip`,
  );
  const wordpress = await readFile(wpPath);
  assertWordPressSources(wordpress, files);
  for (const name of npmPackages)
    for (const file of ['dist/index.js', 'dist/index.d.ts', 'dist/LICENSE'])
      await lstat(path.join(root, 'packages', name, file));
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !path.isAbsolute(npmCli))
    throw Error('Run through npm run release:prepare.');
  const parent = await outputParent(root);
  const output = await mkdtemp(
    path.join(parent, `pagesquire-${report.version}-`),
  );
  await writeFile(
    path.join(output, `pagesquire-source-${report.version}.zip`),
    zipSources(files, `pagesquire-${report.version}`),
  );
  for (const name of npmPackages) {
    const result = await execute(
      process.execPath,
      [
        npmCli,
        'pack',
        '--json',
        '--offline',
        '--ignore-scripts',
        '--workspaces=false',
        '--pack-destination',
        output,
      ],
      {
        cwd: path.join(root, 'packages', name),
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        timeout: 120000,
      },
    );
    const packed = JSON.parse(result.stdout)[0];
    if (
      packed.name !== `@pagesquire/${name}` ||
      packed.version !== report.version ||
      !filenameAllowed(packed.filename)
    )
      throw Error(`Unexpected npm artifact: ${name}`);
    if (
      packed.files.some(
        (file) =>
          !safeArchivePath(file.path) ||
          !(
            file.path.startsWith('dist/') ||
            ['README.md', 'package.json', 'LICENSE'].includes(file.path)
          ),
      )
    )
      throw Error(`Unsafe npm artifact file: ${name}`);
  }
  for (const [directory, name] of [
    ['php', 'server'],
    ['laravel', 'laravel'],
  ]) {
    const prefix = `packages/${directory}/`;
    const selected = new Map(
      [...files]
        .filter(([file]) => file.startsWith(prefix))
        .map(([file, bytes]) => [file.slice(prefix.length), bytes]),
    );
    await writeFile(
      path.join(output, `pagesquire-${name}-${report.version}.zip`),
      zipSources(selected, `pagesquire-${name}`),
    );
  }
  await copyFile(wpPath, path.join(output, `pagesquire-${report.version}.zip`));
  await writeFile(
    path.join(output, 'composer-repositories.json'),
    encodeJson({
      repositories: ['server', 'laravel'].map((name) => ({
        type: 'path',
        url: `./pagesquire-${name}`,
        options: {
          symlink: false,
          versions: { [`pagesquire/${name}`]: report.version },
        },
      })),
      require: {
        'pagesquire/server': report.version,
        'pagesquire/laravel': report.version,
      },
    }),
  );
  await copyFile(
    path.join(root, 'docs/release-notes.md'),
    path.join(output, 'RELEASE_NOTES.md'),
  );
  if (
    sourceDigest(await collectDistributionSources(root)) !== report.sourceDigest
  )
    throw Error(
      'Sources changed during packaging; discard this incomplete candidate and retry.',
    );
  const artifacts = [];
  for (const filename of (await readdir(output)).sort()) {
    const bytes = await readFile(path.join(output, filename));
    artifacts.push({ filename, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const manifest = {
    schemaVersion: 1,
    version: report.version,
    status: 'local-preview',
    repository: report.repository,
    source: {
      commit: report.commit,
      dirty: report.dirty,
      sha256: report.sourceDigest,
    },
    publicationReady: report.publicationReady,
    gates: report.gates,
    artifacts,
  };
  await writeFile(
    path.join(output, 'release-manifest.json'),
    encodeJson(manifest),
  );
  const manifestBytes = await readFile(
    path.join(output, 'release-manifest.json'),
  );
  const checksums = [
    ...artifacts,
    { filename: 'release-manifest.json', sha256: sha256(manifestBytes) },
  ].sort((a, b) => a.filename.localeCompare(b.filename, 'en'));
  await writeFile(
    path.join(output, 'SHA256SUMS'),
    checksums.map((item) => `${item.sha256}  ${item.filename}\n`).join(''),
  );
  await verifyRelease(output);
  return { output, ...report };
}

export async function verifyRelease(directory) {
  for (const name of ['release-manifest.json', 'SHA256SUMS']) {
    const info = await lstat(path.join(directory, name));
    if (!info.isFile() || info.isSymbolicLink())
      throw Error('Release inventory must be regular files.');
  }
  const manifest = await json(path.join(directory, 'release-manifest.json'));
  if (
    manifest.schemaVersion !== 1 ||
    manifest.status !== 'local-preview' ||
    !alphaVersion(manifest.version) ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length !== 12
  )
    throw Error('Invalid release manifest.');
  const expected = new Map();
  for (const item of manifest.artifacts) {
    if (
      !filenameAllowed(item.filename) ||
      !expectedArtifacts(manifest.version).includes(item.filename) ||
      expected.has(item.filename) ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes <= 0
    )
      throw Error('Invalid artifact entry.');
    expected.set(item.filename, item);
  }
  expected.set('release-manifest.json', {
    sha256: sha256(
      await readFile(path.join(directory, 'release-manifest.json')),
    ),
  });
  const lines = (await readFile(path.join(directory, 'SHA256SUMS'), 'utf8'))
    .trim()
    .split(/\r?\n/);
  const seen = new Set();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([a-zA-Z0-9][a-zA-Z0-9._-]*)$/.exec(line);
    if (!match || seen.has(match[2]) || !expected.has(match[2]))
      throw Error('Invalid checksum inventory.');
    seen.add(match[2]);
    const item = expected.get(match[2]);
    const location = path.join(directory, match[2]);
    const info = await lstat(location);
    if (!info.isFile() || info.isSymbolicLink())
      throw Error('Artifact is not a regular file.');
    const bytes = await readFile(location);
    if (
      (item.bytes !== undefined && bytes.length !== item.bytes) ||
      sha256(bytes) !== match[1] ||
      item.sha256 !== match[1]
    )
      throw Error(`Checksum mismatch: ${match[2]}`);
  }
  if (
    seen.size !== expected.size ||
    (await readdir(directory)).length !== seen.size + 1
  )
    throw Error('Incomplete or unexpected release files.');
  return {
    valid: true,
    version: manifest.version,
    artifacts: manifest.artifacts.length,
  };
}

async function main(args) {
  const [command, ...options] = args;
  if (command === 'stamp' && options.length === 0) {
    await outputParent(projectRoot);
    await writeFile(
      path.join(projectRoot, 'dist/build-evidence.json'),
      encodeJson(await buildEvidence()),
    );
    return console.log(
      'Recorded local build inputs/outputs; no test or publication attestation.',
    );
  }
  if (command === 'verify' && options.length === 1)
    return console.log(
      encodeJson(await verifyRelease(path.resolve(options[0]))),
    );
  if (command === 'prepare' && options.length === 0)
    return console.log(encodeJson(await prepareRelease()));
  if (
    command === 'check' &&
    (options.length === 0 ||
      (options.length === 1 && options[0] === '--publication'))
  ) {
    const report = await checkRelease();
    console.log(encodeJson(report));
    if (
      !report.valid ||
      (options.includes('--publication') && !report.publicationReady)
    )
      process.exitCode = 1;
    return;
  }
  throw Error(
    'Usage: release.mjs check [--publication] | prepare | verify <candidate-directory>. No publishing commands are implemented.',
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
