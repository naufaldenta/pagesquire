import { opendir, lstat } from 'node:fs/promises';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createHash } from 'node:crypto';
import { ProjectFiles, json, OnboardingError, excludedPath } from './files.js';
import { CONFIG, SCAN, loadConfig } from './config.js';

export interface Candidate {
  source: string;
  line: number;
  kind: 'control' | 'heading' | 'route';
  tag: string;
  selectorHint: string | null;
  requiresReview: true;
}
export interface ScanResult {
  format: 'pagesquire-scan';
  version: '0.1';
  configHash: string;
  frameworks: string[];
  files: Array<{ path: string; digest: string }>;
  candidates: Candidate[];
  coverage: {
    skipped: number;
    truncated: boolean;
    runtimeVerified: false;
    limitations: string[];
  };
  dom: Array<{
    path: string;
    status: 'observed' | 'failed';
    controls: Array<{
      tag: string;
      role: string;
      selectorHint: string | null;
      matches: number;
      disabled: boolean;
    }>;
    headings: number;
    blockedRequests: number;
    truncated: boolean;
  }>;
}
export const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
const extension = /\.(?:html?|php|[cm]?jsx?|tsx?|vue|svelte|blade\.php)$/i;
function safeSelector(tag: string): string | null {
  const matched =
    /\b(data-pagesquire-id|id)\s*=\s*["']([A-Za-z][A-Za-z0-9_-]{0,63})["']/i.exec(
      tag,
    );
  if (
    !matched ||
    /password|token|secret|private|key|email|phone/i.test(matched[2]!)
  )
    return null;
  return matched[1]!.toLowerCase() === 'id'
    ? `#${matched[2]}`
    : `[data-pagesquire-id="${matched[2]}"]`;
}
export function sourceCandidates(source: string, content: string): Candidate[] {
  if (/data-pagesquire-(private|ignore|root)/i.test(content)) return [];
  const results: Candidate[] = [];
  const add = (
    kind: Candidate['kind'],
    tag: string,
    offset: number,
    selectorHint: string | null = null,
  ) => {
    results.push({
      source,
      line: content.slice(0, offset).split('\n').length,
      kind,
      tag,
      selectorHint,
      requiresReview: true,
    });
  };
  for (const match of content.matchAll(
    /<(button|a|input|textarea|select|h[1-6])\b[^>]{0,2000}>/gi,
  )) {
    if (
      /\b(?:hidden|inert)\b|aria-hidden\s*=\s*["']true|type\s*=\s*["'](?:password|hidden|file)|autocomplete\s*=\s*["'][^"']*(?:password|cc-|one-time-code)/i.test(
        match[0],
      )
    )
      continue;
    const tag = match[1]!.toLowerCase();
    add(
      tag.startsWith('h') ? 'heading' : 'control',
      tag,
      match.index!,
      safeSelector(match[0]),
    );
    if (results.length >= 100) break;
  }
  if (results.length < 100)
    for (const match of content.matchAll(
      /\bRoute::(get|post|put|patch|delete|resource)\s*\(/gi,
    )) {
      add('route', match[1]!.toLowerCase(), match.index!);
      if (results.length >= 100) break;
    }
  return results;
}
export async function scanProject(files: ProjectFiles): Promise<ScanResult> {
  const config = await loadConfig(files);
  const result: ScanResult = {
    format: 'pagesquire-scan',
    version: '0.1',
    configHash: digest(await files.read(CONFIG)),
    frameworks: [],
    files: [],
    candidates: [],
    coverage: {
      skipped: 0,
      truncated: false,
      runtimeVerified: false,
      limitations: [
        'Static candidates are not permissions or verified features.',
        'Hidden states, authentication, database-generated layouts, and unvisited pages are not covered.',
        'The static source pass executed no project code, scripts, route commands, or model. Optional DOM observation renders page scripts in an isolated browser.',
      ],
    },
    dom: [],
  };
  const visited = new Set<string>();
  let entries = 0;
  let bytes = 0;
  async function inspect(name: string): Promise<void> {
    if (visited.has(name)) return;
    visited.add(name);
    if (++entries > 3000) {
      result.coverage.truncated = true;
      return;
    }
    if (excludedPath(name)) {
      result.coverage.skipped++;
      return;
    }
    let target: string;
    try {
      target = await files.resolve(name);
    } catch {
      result.coverage.skipped++;
      return;
    }
    let stat;
    try {
      stat = await lstat(target);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      const names: string[] = [];
      for await (const entry of await opendir(target)) {
        names.push(entry.name);
        if (names.length > 3000) {
          result.coverage.truncated = true;
          break;
        }
      }
      for (const entry of names.sort()) {
        if (entries > 3000) break;
        await inspect(`${name}/${entry}`);
      }
    } else if (stat.isFile() && extension.test(name)) {
      if (
        stat.size > 262144 ||
        bytes + stat.size > 8_388_608 ||
        result.files.length >= 500
      ) {
        result.coverage.skipped++;
        result.coverage.truncated = true;
        return;
      }
      const content = await files.read(name, 262144);
      bytes += stat.size;
      if (content.includes('\0')) {
        result.coverage.skipped++;
        return;
      }
      result.files.push({ path: name, digest: digest(content) });
      if (result.candidates.length < 1000)
        result.candidates.push(
          ...sourceCandidates(name, content).slice(
            0,
            1000 - result.candidates.length,
          ),
        );
      if (result.candidates.length >= 1000) result.coverage.truncated = true;
    }
  }
  for (const name of config.sourceDirectories) await inspect(name);
  for (const file of ['package.json', 'composer.json']) {
    if (!(await files.exists(file))) continue;
    try {
      const content = await files.read(file);
      const metadata = JSON.parse(content) as Record<
        string,
        Record<string, unknown>
      >;
      const names = new Set([
        ...Object.keys(metadata.dependencies ?? {}),
        ...Object.keys(metadata.devDependencies ?? {}),
        ...Object.keys(metadata.require ?? {}),
      ]);
      for (const [dependency, framework] of [
        ['react', 'react'],
        ['next', 'next'],
        ['@inertiajs/react', 'inertia'],
        ['laravel/framework', 'laravel'],
      ])
        if (names.has(dependency!)) result.frameworks.push(framework!);
      result.files.push({ path: file, digest: digest(content) });
    } catch {
      result.coverage.skipped++;
    }
  }
  if (result.files.some((file) => file.path.endsWith('.php')))
    result.frameworks.push('php');
  result.frameworks = [...new Set(result.frameworks)].sort();
  return result;
}
export async function saveScan(
  files: ProjectFiles,
  result: ScanResult,
): Promise<void> {
  await files.artifact(SCAN, json(result), (existing) => {
    try {
      const data = JSON.parse(existing);
      return data.format === 'pagesquire-scan' && data.version === '0.1';
    } catch {
      return false;
    }
  });
}
export async function loadFreshScan(files: ProjectFiles): Promise<ScanResult> {
  const scan = (await files.readJson(SCAN, 2_000_000)) as ScanResult;
  if (
    scan?.format !== 'pagesquire-scan' ||
    scan.version !== '0.1' ||
    !Array.isArray(scan.files) ||
    scan.files.length > 502 ||
    !Array.isArray(scan.candidates) ||
    scan.candidates.length > 1000 ||
    !Array.isArray(scan.dom) ||
    scan.dom.length > 5 ||
    scan.configHash !== digest(await files.read(CONFIG))
  )
    throw new OnboardingError(
      'STALE_SCAN',
      'Run scan again after changing the configuration.',
    );
  const fresh = await scanProject(files);
  if (JSON.stringify(scan.files) !== JSON.stringify(fresh.files))
    throw new OnboardingError(
      'STALE_SCAN',
      'Source inputs changed. Run scan again before preparing AI context.',
    );
  const config = await loadConfig(files);
  if (
    !validDom(scan.dom) ||
    scan.dom.some((page) => !config.site.paths.includes(page.path))
  )
    throw new OnboardingError(
      'INVALID_SCAN',
      'The stored DOM metadata is invalid. Run scan again.',
    );
  fresh.dom = scan.dom;
  return fresh;
}

const validDom = new Ajv2020({ strict: true }).compile({
  type: 'array',
  maxItems: 5,
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'path',
      'status',
      'controls',
      'headings',
      'blockedRequests',
      'truncated',
    ],
    properties: {
      path: { type: 'string', maxLength: 2048 },
      status: { enum: ['observed', 'failed'] },
      controls: {
        type: 'array',
        maxItems: 300,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['tag', 'role', 'selectorHint', 'matches', 'disabled'],
          properties: {
            tag: {
              enum: [
                'button',
                'a',
                'input',
                'textarea',
                'select',
                'div',
                'span',
                'section',
                'label',
                'other',
              ],
            },
            role: {
              enum: [
                '',
                'button',
                'link',
                'textbox',
                'checkbox',
                'radio',
                'combobox',
                'switch',
              ],
            },
            selectorHint: {
              anyOf: [
                { type: 'null' },
                {
                  type: 'string',
                  maxLength: 100,
                  pattern:
                    '^(#[A-Za-z][A-Za-z0-9_-]*|\\[data-pagesquire-id="[A-Za-z][A-Za-z0-9_-]*"\\])$',
                },
              ],
            },
            matches: { type: 'integer', minimum: 0, maximum: 100000 },
            disabled: { type: 'boolean' },
          },
        },
      },
      headings: { type: 'integer', minimum: 0, maximum: 1000 },
      blockedRequests: { type: 'integer', minimum: 0, maximum: 1000000 },
      truncated: { type: 'boolean' },
    },
  },
});
