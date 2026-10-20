import { Ajv2020 } from 'ajv/dist/2020.js';
import { ProjectFiles, OnboardingError, excludedPath } from './files.js';

export const CONFIG = 'pagesquire.config.json';
export const SCAN = '.pagesquire/scan.json';
export const REPORT = '.pagesquire/report.md';
export interface OnboardingConfig {
  schemaVersion: '0.1';
  manifest: string;
  bindings: string;
  generated: string;
  sourceDirectories: string[];
  site: { origin: string | null; paths: string[] };
}
const schema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'manifest',
    'bindings',
    'generated',
    'sourceDirectories',
    'site',
  ],
  properties: {
    schemaVersion: { const: '0.1' },
    manifest: { type: 'string' },
    bindings: { type: 'string' },
    generated: { type: 'string' },
    sourceDirectories: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      uniqueItems: true,
      items: { type: 'string' },
    },
    site: {
      type: 'object',
      additionalProperties: false,
      required: ['origin', 'paths'],
      properties: {
        origin: { type: ['string', 'null'] },
        paths: {
          type: 'array',
          maxItems: 20,
          uniqueItems: true,
          items: { type: 'string' },
        },
      },
    },
  },
};
const validator = new Ajv2020({
  strict: true,
  allowUnionTypes: true,
}).compile<OnboardingConfig>(schema);
export function pageUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OnboardingError(
      'INVALID_URL',
      'Supply an absolute HTTP(S) page URL.',
    );
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new OnboardingError(
      'INVALID_URL',
      'Page URLs must use HTTP(S) without credentials, query strings, or fragments.',
    );
  return url;
}
export function defaultConfig(url?: string): OnboardingConfig {
  const page = url ? pageUrl(url) : undefined;
  return {
    schemaVersion: '0.1',
    manifest: 'pagesquire/capabilities.json',
    bindings: 'pagesquire/bindings.json',
    generated: 'pagesquire/generated',
    sourceDirectories: [
      'resources',
      'routes',
      'src',
      'app',
      'pages',
      'components',
      'public',
      'index.html',
    ],
    site: { origin: page?.origin ?? null, paths: page ? [page.pathname] : [] },
  };
}
export async function loadConfig(
  files: ProjectFiles,
): Promise<OnboardingConfig> {
  const config = await files.readJson(CONFIG);
  if (!validator(config))
    throw new OnboardingError(
      'INVALID_CONFIG',
      'The PageSquire configuration is invalid.',
    );
  const result = config as OnboardingConfig;
  for (const input of [result.manifest, result.bindings]) {
    await files.resolve(input);
    const inspected = input.startsWith('pagesquire/')
      ? input.slice('pagesquire/'.length)
      : input;
    if (!input.endsWith('.json') || excludedPath(inspected))
      throw new OnboardingError(
        'UNSAFE_INPUT',
        'Manifest and bindings must be non-sensitive local JSON inputs.',
      );
  }
  for (const value of [
    result.manifest,
    result.bindings,
    result.generated,
    ...result.sourceDirectories,
  ])
    await files.resolve(value);
  if (!result.generated.startsWith('pagesquire/'))
    throw new OnboardingError(
      'INVALID_CONFIG',
      'Generated artifacts must stay under pagesquire/.',
    );
  if (
    result.site.origin !== null &&
    pageUrl(result.site.origin).origin !== result.site.origin
  )
    throw new OnboardingError(
      'INVALID_CONFIG',
      'The site origin must contain only scheme, host, and port.',
    );
  for (const value of result.site.paths) {
    if (
      !result.site.origin ||
      !value.startsWith('/') ||
      new URL(value, result.site.origin).origin !== result.site.origin ||
      pageUrl(new URL(value, result.site.origin).href).pathname !== value
    )
      throw new OnboardingError(
        'INVALID_CONFIG',
        'Configured pages must be exact same-origin pathnames.',
      );
  }
  return result;
}
