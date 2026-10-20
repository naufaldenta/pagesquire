#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ProjectFiles, OnboardingError, json } from './files.js';
import { initialize, prepareAi, writeReport } from './workflow.js';
import { scanProject, saveScan } from './scan.js';
import { scanDom } from './dom.js';
import { validateProject } from './validate.js';

export async function run(
  args: string[],
  cwd = process.cwd(),
): Promise<unknown> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      root: { type: 'string' },
      url: { type: 'string', multiple: true },
      host: { type: 'string' },
      compile: { type: 'boolean' },
      help: { type: 'boolean' },
      version: { type: 'boolean' },
    },
  });
  if (values.help)
    return {
      usage: 'pagesquire <init|scan|report|prepare-ai|validate> [--root path]',
      commands: {
        init: '[--url URL] Create a default-deny project setup; no overwrites.',
        scan: '[--url URL ...] Read local metadata; observe only explicitly approved pages.',
        report: 'Write an English coverage report from a fresh scan.',
        'prepare-ai':
          '--host codex|claude|both Install reviewed project-local integration skills.',
        validate:
          '[--compile] Inspect contracts/exports without executing project modules.',
      },
      version: '0.1.0-alpha.0',
    };
  if (values.version) return { version: '0.1.0-alpha.0' };
  const [command] = positionals;
  if (
    positionals.length !== 1 ||
    !['init', 'scan', 'report', 'prepare-ai', 'validate'].includes(
      command ?? '',
    )
  )
    throw new OnboardingError(
      'INVALID_COMMAND',
      'Choose init, scan, report, prepare-ai, or validate. Use --help for options.',
    );
  if (
    (values.url && !['init', 'scan'].includes(command!)) ||
    (values.host && command !== 'prepare-ai') ||
    (values.compile && command !== 'validate')
  )
    throw new OnboardingError(
      'INVALID_OPTIONS',
      'This option is not supported by the selected command.',
    );
  const files = await ProjectFiles.at(values.root ?? cwd);
  if (command === 'init') {
    if ((values.url?.length ?? 0) > 1)
      throw new OnboardingError(
        'INVALID_OPTIONS',
        'Initialize with one page URL, then review additional paths in the configuration.',
      );
    return initialize(files, values.url?.[0]);
  }
  if (command === 'scan') {
    const scan = await scanProject(files);
    if (values.url) scan.dom = await scanDom(files, values.url);
    await saveScan(files, scan);
    return {
      scan: '.pagesquire/scan.json',
      candidates: scan.candidates.length,
      observedPages: scan.dom.filter((page) => page.status === 'observed')
        .length,
      failedPages: scan.dom.filter((page) => page.status === 'failed').length,
      truncated: scan.coverage.truncated,
      runtimeVerified: false,
    };
  }
  if (command === 'report') return writeReport(files);
  if (command === 'prepare-ai') return prepareAi(files, values.host ?? '');
  return validateProject(files, values.compile ?? false);
}
if (
  import.meta.main ??
  (process.argv[1] !== undefined &&
    (await realpath(fileURLToPath(import.meta.url))) ===
      (await realpath(process.argv[1])))
) {
  try {
    const result = await run(process.argv.slice(2));
    process.stdout.write(json(result));
    if (
      result &&
      typeof result === 'object' &&
      'valid' in result &&
      result.valid === false
    )
      process.exitCode = 1;
  } catch (error: unknown) {
    process.stderr.write(
      json({
        error:
          error instanceof OnboardingError ? error.code : 'ONBOARDING_FAILED',
        message:
          error instanceof OnboardingError
            ? error.message
            : 'The onboarding command failed. Check local inputs and permissions; no project code was executed.',
      }),
    );
    process.exitCode = 1;
  }
}
