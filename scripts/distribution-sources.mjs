import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const directories = [
  'api',
  '.github',
  'docs',
  'examples',
  'packages',
  'scripts',
  'tests',
];
const rootFiles = new Set([
  '.gitattributes',
  '.gitignore',
  '.prettierignore',
  '.prettierrc.json',
  '.vercelignore',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'composer.json',
  'composer.lock',
  'package.json',
  'package-lock.json',
  'phpunit.xml',
  'release.config.json',
  'tsconfig.base.json',
  'playwright.config.mjs',
  'playwright.wordpress.config.mjs',
  'playwright.offbeat.config.mjs',
  'playwright.extension.config.mjs',
  'vercel.json',
]);
const omitted = new Set([
  'node_modules',
  'vendor',
  'dist',
  '.next',
  '.vercel',
  'out',
  '.cache',
  '.git',
  'test-results',
  'playwright-report',
  '.phpunit.cache',
]);

export function safeArchivePath(relative) {
  if (typeof relative !== 'string' || /[:\u0000-\u001f\u007f]/.test(relative))
    return false;
  const parts = relative.replaceAll('\\', '/').split('/');
  return (
    parts.every((part) => part && part !== '.' && part !== '..') &&
    !parts.some((part) =>
      /^(?:\.env(?:\.|$)|\.npmrc$|\.pypirc$|auth\.json$|wp-config\.php$|credentials(?:\.|$)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$))|\.(?:tsbuildinfo|sqlite|sqlite3|db|pem|key|p12|pfx|log)$/i.test(
        part,
      ),
    )
  );
}

export function distributionPathAllowed(relative) {
  return (
    safeArchivePath(relative) &&
    relative.replaceAll('\\', '/') !==
      'examples/brutalist-demo/public/pagesquire-license.txt' &&
    !relative
      .replaceAll('\\', '/')
      .split('/')
      .some((part) => omitted.has(part))
  );
}

export async function collectDistributionSources(root) {
  const files = new Map();
  async function visit(relative) {
    if (!distributionPathAllowed(relative)) return;
    const absolute = path.join(root, relative);
    const entry = await lstat(absolute);
    // Build inputs must be an owner-controlled checkout; never traverse links.
    if (entry.isSymbolicLink())
      throw Error(`Distribution input is a link: ${relative}`);
    if (entry.isDirectory()) {
      for (const name of (await readdir(absolute)).sort())
        await visit(`${relative}/${name}`);
    } else if (entry.isFile()) files.set(relative, await readFile(absolute));
    else throw Error(`Unsupported distribution input: ${relative}`);
  }
  for (const name of [...rootFiles].sort()) await visit(name);
  for (const name of directories) await visit(name);
  return new Map(
    [...files].sort(([left], [right]) => left.localeCompare(right, 'en')),
  );
}
