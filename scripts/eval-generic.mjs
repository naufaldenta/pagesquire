// Generic browser-task evaluation for the guarded ui.* tools.
//
//   node scripts/eval-generic.mjs                      offline oracle self-check (no provider calls)
//   node scripts/eval-generic.mjs --live --max-calls 80 [--tasks id,id] [--headed]
//   Engine options: --validate (completion reviewer), --cache (trajectory
//   cache shared across tasks), --repeat N (run the task set N times, e.g.
//   to measure cache savings).
//
// Live mode uses the server-side provider settings from the environment
// (PAGESQUIRE_PROVIDER, PAGESQUIRE_API_KEY, PAGESQUIRE_MODEL, ...). It never
// retries a provider call and stops issuing calls once --max-calls is used up.
// Results are graded from the final page state and written to
// test-results/eval-generic/.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
  ConversationEngine,
  MemoryTrajectoryCache,
  OpenAiCompatibleProvider,
  providerConfigurationFromEnv,
} from '@pagesquire/server';
import { tasks } from '../tests/eval/generic-tasks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

export function parseArguments(argv) {
  const options = {
    live: false,
    maxCalls: 0,
    tasks: [],
    headed: false,
    validate: false,
    cache: false,
    repeat: 1,
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--live') options.live = true;
    else if (flag === '--headed') options.headed = true;
    else if (flag === '--validate') options.validate = true;
    else if (flag === '--cache') options.cache = true;
    else if (flag === '--repeat') {
      options.repeat = Number(argv[++index]);
      if (
        !Number.isInteger(options.repeat) ||
        options.repeat < 1 ||
        options.repeat > 5
      )
        throw new Error('--repeat must be an integer from 1 to 5.');
    } else if (flag === '--max-calls') {
      options.maxCalls = Number(argv[++index]);
      if (
        !Number.isInteger(options.maxCalls) ||
        options.maxCalls < 1 ||
        options.maxCalls > 1000
      )
        throw new Error('--max-calls must be an integer from 1 to 1000.');
    } else if (flag === '--tasks')
      options.tasks = String(argv[++index] ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    else throw new Error(`Unknown option ${flag}.`);
  }
  if (options.live && !options.maxCalls)
    throw new Error('Live evaluation needs an explicit --max-calls budget.');
  const unknown = options.tasks.filter(
    (id) => !tasks.some((task) => task.id === id),
  );
  if (unknown.length) throw new Error(`Unknown tasks: ${unknown.join(', ')}.`);
  return options;
}

/** Resolves "@Name" against the latest snapshot the engine sent to the model. */
export function oracleProvider(task) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async complete(messages) {
      calls++;
      let page;
      let done = 0;
      for (const message of messages) {
        if (message.role !== 'user') continue;
        let data;
        try {
          data = JSON.parse(message.content);
        } catch {
          done = 0;
          continue;
        }
        if (data?.browserResult) done++;
        if (data?.untrustedPage) page = data.untrustedPage;
      }
      const step = task.oracle[done];
      if (!step || step.say)
        return {
          text: step?.say ?? 'Done.',
          emotion: 'happy',
          finished: true,
          toolCalls: [],
        };
      const resolve = (value) => {
        if (typeof value !== 'string' || !value.startsWith('@')) return value;
        const name = value.slice(1);
        return (
          page?.targets.find((target) => target.name === name)?.id ??
          'missing-target'
        );
      };
      return {
        text: 'Working on it.',
        emotion: 'thinking',
        finished: false,
        toolCalls: [
          {
            capabilityId: step.tool,
            parameters: Object.fromEntries(
              Object.entries(step.params).map(([name, value]) => [
                name,
                resolve(value),
              ]),
            ),
          },
        ],
      };
    },
  };
}

/** Wraps a live provider with a hard call budget and metadata-only usage counts. */
function liveProvider(budget) {
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, failures: 0 };
  const provider = new OpenAiCompatibleProvider({
    ...providerConfigurationFromEnv(process.env),
    timeoutMs: 45000,
    onDiagnostic: (event) => {
      if (event.outcome !== 'ok') usage.failures++;
      usage.inputTokens += event.usage?.inputTokens ?? 0;
      usage.outputTokens += event.usage?.outputTokens ?? 0;
    },
  });
  return {
    usage,
    exhausted: () => usage.calls >= budget,
    async complete(...args) {
      if (usage.calls >= budget)
        throw new Error('Evaluation budget exhausted.');
      usage.calls++;
      return provider.complete(...args);
    },
  };
}

async function startServer(port) {
  const child = spawn(process.execPath, ['scripts/serve-demo.mjs'], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Demo server did not start.')),
      15000,
    );
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('PageSquire demo')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', () => reject(new Error('Demo server exited.')));
  });
  return child;
}

/** Declarative final-state checks; each returns a failure reason or null. */
async function grade(page, checks) {
  return page.evaluate((checks) => {
    const failures = [];
    for (const check of checks) {
      if (check.location) {
        if (location.pathname !== check.location)
          failures.push(`location is ${location.pathname}`);
        continue;
      }
      const elements = [...document.querySelectorAll(check.selector)];
      if ('count' in check) {
        if (elements.length !== check.count)
          failures.push(
            `${check.selector}: count ${elements.length}, expected ${check.count}`,
          );
        continue;
      }
      const element = elements[0];
      if (!element) {
        failures.push(`${check.selector}: missing`);
        continue;
      }
      const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      if ('text' in check && text !== check.text)
        failures.push(`${check.selector}: text "${text}"`);
      if ('contains' in check && !text.includes(check.contains))
        failures.push(`${check.selector}: text "${text}"`);
      if ('value' in check && element.value !== check.value)
        failures.push(`${check.selector}: value "${element.value}"`);
      if ('checked' in check && element.checked !== check.checked)
        failures.push(`${check.selector}: checked ${element.checked}`);
      if ('hidden' in check && element.hidden !== check.hidden)
        failures.push(`${check.selector}: hidden ${element.hidden}`);
      if (
        'attribute' in check &&
        element.getAttribute(check.attribute[0]) !== check.attribute[1]
      )
        failures.push(
          `${check.selector}: ${check.attribute[0]}="${element.getAttribute(check.attribute[0])}"`,
        );
      if (
        'property' in check &&
        element[check.property[0]] !== check.property[1]
      )
        failures.push(
          `${check.selector}: ${check.property[0]}=${element[check.property[0]]}`,
        );
    }
    return failures;
  }, checks);
}

async function runTask(browser, base, task, provider, manifest, settings) {
  const context = await browser.newContext();
  const page = await context.newPage();
  let state = null;
  let actions = 0;
  let failedActions = 0;
  const engine = new ConversationEngine({
    manifest,
    provider,
    maxSteps: 20,
    maxAttempts: 30,
    maxRecoveries: 3,
    ...settings,
  });
  const allowed = manifest.capabilities.map((entry) => entry.id);
  await page.route('**/pagesquire/chat', async (route) => {
    const request = route.request().postDataJSON();
    if (request.result) {
      actions++;
      if (request.result.status !== 'success') failedActions++;
    }
    try {
      const outcome = await engine.handle(
        request,
        state,
        allowed,
        async (next) => {
          state = next;
        },
      );
      state = outcome.state;
      await route.fulfill({ json: outcome.reply });
    } catch (error) {
      await route.fulfill({
        status: error.status ?? 500,
        json: {
          error: {
            code: error.code ?? 'EVAL_ERROR',
            message: 'Evaluation request failed.',
          },
        },
      });
    }
  });
  const started = Date.now();
  let approvals = 0;
  let running = true;
  // The simulated visitor answers approval prompts as the task specifies.
  const answering = (async () => {
    while (running) {
      const prompt = page.locator('[role="alertdialog"]');
      if (await prompt.count().catch(() => 0)) {
        approvals++;
        const name = task.approval === 'deny' ? 'Deny' : 'Approve';
        await prompt
          .getByRole('button', { name, exact: true })
          .evaluate((button) => button.click())
          .catch(() => {});
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  })();
  let finalText = '';
  let trace;
  try {
    await page.goto(base + task.page);
    await page.waitForFunction(() => Boolean(window.PageSquire?.client), null, {
      timeout: 15000,
    });
    await page.evaluate(
      (text) => window.PageSquire.client.send(text),
      task.instruction,
    );
    finalText = await page.evaluate(
      () => window.PageSquire.client.state.messages.at(-1)?.text ?? '',
    );
    trace = await page.evaluate(
      () => window.PageSquire.trace?.toJSON() ?? null,
    );
  } catch (error) {
    finalText = `Harness error: ${error.message}`;
  } finally {
    running = false;
    await answering;
  }
  const failures = await grade(page, task.checks).catch((error) => [
    `grader error: ${error.message}`,
  ]);
  await context.close();
  return {
    id: task.id,
    category: task.category,
    passed: failures.length === 0,
    failures,
    actions,
    failedActions,
    approvals,
    durationMs: Date.now() - started,
    finalText: finalText.slice(0, 300),
    trace,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const manifest = JSON.parse(
    await readFile(
      path.join(root, 'packages/embed/dist/manifest.json'),
      'utf8',
    ),
  );
  const selected = options.tasks.length
    ? tasks.filter((task) => options.tasks.includes(task.id))
    : tasks;
  const port = 4190 + Math.floor(Math.random() * 50);
  // Validate provider settings before starting anything that needs cleanup.
  const live = options.live ? liveProvider(options.maxCalls) : undefined;
  const server = await startServer(port);
  const browser = await chromium.launch({ headless: !options.headed });
  const results = [];
  const settings = {
    ...(options.validate ? { validateCompletion: true } : {}),
    ...(options.cache ? { trajectoryCache: new MemoryTrajectoryCache() } : {}),
  };
  const oracles = new Map();
  try {
    for (let round = 1; round <= options.repeat; round++)
      for (const task of selected) {
        if (live?.exhausted()) {
          results.push({
            id: task.id,
            category: task.category,
            passed: false,
            skipped: true,
            failures: ['budget exhausted'],
          });
          continue;
        }
        if (!oracles.has(task.id)) oracles.set(task.id, oracleProvider(task));
        const provider = live ?? oracles.get(task.id);
        const before = live ? live.usage.calls : provider.calls;
        const result = await runTask(
          browser,
          `http://127.0.0.1:${port}`,
          task,
          provider,
          manifest,
          settings,
        );
        result.round = round;
        // The oracle knows which of its steps should fail; any other failure
        // is a tool or verifier defect even when the final state passes.
        if (!live && result.failedActions !== (task.expectFailures ?? 0)) {
          result.passed = false;
          result.failures.push(
            `${result.failedActions} failed actions, expected ${task.expectFailures ?? 0}`,
          );
        }
        result.providerCalls =
          (live ? live.usage.calls : provider.calls) - before;
        results.push(result);
        console.log(
          `${result.passed ? 'PASS' : 'FAIL'} ${task.id}${result.passed ? '' : ` - ${result.failures.join('; ')}`}`,
        );
      }
  } finally {
    await browser.close();
    server.kill();
  }
  const graded = results.filter((result) => !result.skipped);
  const byCategory = {};
  for (const result of graded) {
    const entry = (byCategory[result.category] ??= { passed: 0, total: 0 });
    entry.total++;
    if (result.passed) entry.passed++;
  }
  const report = {
    schemaVersion: 1,
    mode: options.live ? 'live' : 'oracle',
    generatedAt: new Date().toISOString(),
    ...(options.live
      ? {
          provider: process.env.PAGESQUIRE_PROVIDER ?? 'custom',
          model: process.env.PAGESQUIRE_MODEL ?? '',
          usage: live.usage,
        }
      : {}),
    summary: {
      tasks: results.length,
      graded: graded.length,
      passed: graded.filter((result) => result.passed).length,
      successRate: graded.length
        ? Number(
            (
              graded.filter((result) => result.passed).length / graded.length
            ).toFixed(3),
          )
        : 0,
      providerCalls: graded.reduce(
        (sum, result) => sum + (result.providerCalls ?? 0),
        0,
      ),
      settings: {
        validate: options.validate,
        cache: options.cache,
        repeat: options.repeat,
      },
      averageActions: graded.length
        ? Number(
            (
              graded.reduce((sum, result) => sum + result.actions, 0) /
              graded.length
            ).toFixed(2),
          )
        : 0,
      byCategory,
    },
    results,
  };
  const directory = path.join(root, 'test-results/eval-generic');
  await mkdir(directory, { recursive: true });
  const file = path.join(
    directory,
    `report-${report.mode}-${report.generatedAt.replace(/[:.]/g, '-')}.json`,
  );
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Report: ${path.relative(root, file)}`);
  // The oracle is a self-check of tasks, fixtures, tools and grader.
  if (!options.live && report.summary.passed !== report.summary.graded)
    process.exitCode = 1;
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
