import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '..');
export const cache = path.join(root, '.cache/pagesquire-wordpress');
export function wordpressPhpFlags(platform, opcacheLoaded) {
  return [
    ...(opcacheLoaded ? [] : ['-d', 'zend_extension=opcache']),
    '-d',
    'opcache.enable_cli=1',
    ...(platform === 'win32' ? ['-d', 'pcre.jit=0'] : []),
  ];
}
export function sourcePathAllowed(source) {
  const parts = source.replaceAll('\\', '/').split('/');
  const omitted = new Set([
    'node_modules',
    'vendor',
    'dist',
    '.next',
    '.cache',
    '.git',
    'test-results',
    'playwright-report',
    '.phpunit.cache',
  ]);
  const name = parts.at(-1);
  return (
    !parts.some((part) => omitted.has(part)) &&
    !/^(?:\.env(?:\.|$)|\.npmrc$|auth\.json$|wp-config\.php$|id_rsa(?:\.|$))|\.(?:tsbuildinfo|sqlite|sqlite3|db|pem|key|p12|log)$/i.test(
      name,
    )
  );
}
export async function download(url, filename, sha256) {
  await mkdir(cache, { recursive: true });
  const file = path.join(cache, filename);
  try {
    const data = await readFile(file);
    if (!sha256 || createHash('sha256').update(data).digest('hex') === sha256)
      return file;
  } catch {}
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw Error(`Download failed: ${url} (${response.status})`);
  const data = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(data).digest('hex');
  if (sha256 && digest !== sha256)
    throw Error(`Checksum mismatch: ${filename}`);
  await writeFile(file, data);
  return file;
}
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...options,
    });
    let output = '';
    process.stdout.on('data', (chunk) => {
      output += chunk;
    });
    process.stderr.on('data', (chunk) => {
      output += chunk;
    });
    process.on('error', reject);
    process.on('exit', (code) => {
      if (code === 0) resolve(output);
      else reject(Error(`${command} failed (${code}): ${output}`));
    });
  });
}
export async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
