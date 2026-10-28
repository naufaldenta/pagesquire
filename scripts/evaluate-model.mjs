import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { chromium, expect } from '@playwright/test';
import {
  EvaluationError,
  openEvaluationBudget,
} from './model-evaluation-budget.mjs';
import {
  manifest,
  smokeScenarios,
  matrixScenarios,
  gradeTurn,
  sameActions,
} from '../tests/fixtures/model-evaluation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const emotions = new Set([
  'idle',
  'happy',
  'sad',
  'thinking',
  'confused',
  'hover',
]);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
  '.json': 'application/json',
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
async function fixtureDigest(directory) {
  const digest = createHash('sha256');
  let files = 0;
  let size = 0;
  async function walk(current, prefix = '') {
    for (const name of (await readdir(current)).sort()) {
      const filename = path.join(current, name);
      const relative = prefix + name;
      const info = await lstat(filename);
      if (info.isSymbolicLink())
        throw new EvaluationError('UNSAFE_FIXTURE_PATH');
      if (info.isDirectory()) await walk(filename, relative + '/');
      else if (info.isFile() && mime[path.extname(filename)]) {
        files++;
        size += info.size;
        if (files > 512 || size > 52428800)
          throw new EvaluationError('FIXTURE_TOO_LARGE');
        digest
          .update(relative + '\0')
          .update(await readFile(filename))
          .update('\0');
      }
    }
  }
  await walk(directory);
  return digest.digest('hex');
}
const publicCodes = new Set([
  'PROVIDER_UNAVAILABLE',
  'INVALID_PROVIDER_RESPONSE',
  'INVALID_PARAMETERS',
  'CAPABILITY_DENIED',
  'CONVERSATION_EXPIRED',
  'ACTION_PENDING',
  'RATE_LIMITED',
]);

export function evaluationPlan(suite = 'smoke') {
  const scenarios =
    suite === 'smoke'
      ? smokeScenarios
      : suite === 'matrix'
        ? matrixScenarios
        : null;
  if (!scenarios) throw new EvaluationError('UNKNOWN_EVALUATION_SUITE');
  return {
    scenarios: structuredClone(scenarios),
    plannedCalls: scenarios.reduce(
      (total, scenario) =>
        total +
        scenario.turns.reduce(
          (calls, turn) => calls + 1 + turn.actions.length,
          0,
        ),
      0,
    ),
  };
}

export function parseEvaluationArguments(args) {
  const options = {
    mode: 'plan',
    suite: 'smoke',
    maximum: undefined,
    campaign: undefined,
  };
  const seen = new Set();
  let modeSeen = false;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (seen.has(key))
      throw new EvaluationError('INVALID_EVALUATION_ARGUMENTS');
    seen.add(key);
    if (['--live', '--synthetic', '--plan'].includes(key)) {
      if (modeSeen) throw new EvaluationError('INVALID_EVALUATION_ARGUMENTS');
      modeSeen = true;
      options.mode = key.slice(2);
    } else if (['--suite', '--max-calls', '--campaign'].includes(key)) {
      const value = args[++index];
      if (!value || value.startsWith('--'))
        throw new EvaluationError('INVALID_EVALUATION_ARGUMENTS');
      if (key === '--suite') options.suite = value;
      if (key === '--max-calls')
        options.maximum = /^\d+$/.test(value) ? Number(value) : NaN;
      if (key === '--campaign') options.campaign = value;
    } else throw new EvaluationError('INVALID_EVALUATION_ARGUMENTS');
  }
  evaluationPlan(options.suite);
  if (
    options.maximum !== undefined &&
    (!Number.isInteger(options.maximum) ||
      options.maximum < 1 ||
      options.maximum > 1000)
  )
    throw new EvaluationError('INVALID_EVALUATION_ARGUMENTS');
  if (
    options.mode !== 'plan' &&
    (!Number.isInteger(options.maximum) ||
      options.maximum < 1 ||
      options.maximum > 1000 ||
      !/^[a-z0-9][a-z0-9-]{0,95}$/.test(options.campaign ?? ''))
  )
    throw new EvaluationError('EXPLICIT_EVALUATION_BUDGET_REQUIRED');
  return options;
}

/** Strictly isolated loopback fixture. It never connects to the production database or session endpoint. */
export async function runModelEvaluation(options, dependencies = {}) {
  const { createBackend } =
    await import('../examples/brutalist-demo/server/backend.mjs');
  const { SyntheticStore } =
    await import('../tests/fixtures/offbeat-backend.mjs');
  const {
    OpenAiCompatibleProvider,
    providerConfigurationFromEnv,
    listProviderPresets,
    readBounded,
  } = await import('../packages/server/dist/index.js');
  const plan = evaluationPlan(options.suite);
  let configuration;
  if (options.mode === 'live') {
    configuration = providerConfigurationFromEnv(
      dependencies.env ?? process.env,
    );
    const sumopod = listProviderPresets().find(
      (preset) => preset.id === 'sumopod',
    );
    if (
      configuration.endpoint !== sumopod.endpoint ||
      !['sumopod', 'custom'].includes(configuration.provider)
    )
      throw new EvaluationError('SUMOPOD_ONLY_EVALUATION');
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9:/_.-]{0,199}$/.test(configuration.model) ||
      configuration.model.includes(configuration.apiKey.trim())
    )
      throw new EvaluationError('UNSAFE_EVALUATION_METADATA');
  }
  const metadata = {
    service: options.mode === 'live' ? 'sumopod' : 'synthetic',
    profile: configuration?.provider ?? 'synthetic',
    requestedModel: configuration?.model ?? 'deterministic-oracle',
    responseMode: configuration?.responseMode ?? 'fixture',
    tokenParameter: configuration?.tokenParameter ?? 'fixture',
    systemRole: configuration?.systemRole ?? 'fixture',
    thinking: configuration?.thinking ?? 'fixture',
    maxOutputTokens: 1000,
    timeoutMs: 25000,
  };
  const sourceFiles = [
    'scripts/evaluate-model.mjs',
    'scripts/model-evaluation-budget.mjs',
    'tests/fixtures/model-evaluation.mjs',
    'packages/server/src/engine.ts',
    'packages/server/src/provider.ts',
    'packages/server/src/providers.ts',
    'packages/core/src/runtime.ts',
    'examples/brutalist-demo/capabilities.mjs',
    'examples/brutalist-demo/adapter.mjs',
  ];
  const sourceHash = hash(
    (
      await Promise.all(
        sourceFiles.map(
          async (file) =>
            file + '\n' + (await readFile(path.join(root, file), 'utf8')),
        ),
      )
    ).join('\n'),
  );
  const output = path.join(root, 'examples/brutalist-demo/out');
  const fixtureBuildHash = await fixtureDigest(output);
  const fingerprint = hash(
    JSON.stringify({
      metadata,
      suite: options.suite,
      scenarios: plan.scenarios,
      manifest,
      sourceHash,
      fixtureBuildHash,
    }),
  );
  const budget = await openEvaluationBudget({
    root: dependencies.budgetRoot ?? root,
    campaign: options.campaign,
    maximum: options.maximum,
    fingerprint,
  });
  let active;
  let backend;
  let browser;
  const latencies = [];
  let emotionFallbacks = 0;
  let httpAttempts = 0;
  const native = configuration
    ? new OpenAiCompatibleProvider({ ...configuration, timeoutMs: 25000 })
    : null;
  const provider = {
    async complete(...args) {
      if (!active) throw new EvaluationError('NO_ACTIVE_EVALUATION');
      try {
        await budget.reserve(active.scenario.id, active.turnIndex);
      } catch (error) {
        active.trace.budgetExhausted = true;
        throw error;
      }
      dependencies.onProgress?.({
        event: 'attempt',
        used: budget.used,
        maximum: options.maximum,
        scenario: active.scenario.id,
        turn: active.turnIndex + 1,
      });
      const started = Date.now();
      try {
        let draft;
        if (native) {
          httpAttempts++;
          draft = await native.complete(...args);
        } else {
          const proposal = active.turn.actions[active.trace.actions.length];
          draft = proposal
            ? {
                text: 'Checking.',
                emotion: 'thinking',
                finished: false,
                toolCalls: [proposal],
              }
            : {
                text:
                  active.turn.kind === 'clarification'
                    ? 'Would you confirm which action you want?'
                    : active.turn.kind === 'unsupported'
                      ? 'I cannot delete accounts.'
                      : 'The requested response is complete.',
                emotion: active.turn.actions.length ? 'happy' : 'idle',
                finished: true,
                toolCalls: [],
              };
        }
        if (!emotions.has(draft?.emotion)) emotionFallbacks++;
        return draft;
      } finally {
        latencies.push(Date.now() - started);
      }
    },
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin);
      if (url.pathname.startsWith('/api/')) {
        if (!backend || !active) {
          response.writeHead(503).end();
          return;
        }
        let input;
        // The backend remains the authority for bounded JSON, Origin, CSRF, auth and capability validation.
        // The grader inspects whole replies, so it asks the backend for plain JSON.
        const headers = new Headers(request.headers);
        if (url.pathname === '/api/chat')
          headers.set('accept', 'application/json');
        const incoming = new Request(url, {
          method: request.method,
          headers,
          ...(!['GET', 'HEAD'].includes(request.method)
            ? { body: Readable.toWeb(request), duplex: 'half' }
            : {}),
        });
        if (url.pathname === '/api/chat')
          input = JSON.parse(
            await readBounded(
              incoming.clone(),
              196608,
              AbortSignal.timeout(5000),
            ),
          );
        const result = await backend.handle(incoming);
        const body = await result.text();
        if (url.pathname === '/api/chat') {
          const reply = JSON.parse(body);
          if (input.result)
            active.trace.results.push({ status: input.result.status });
          if (input.conversationId)
            active.conversationIds.add(input.conversationId);
          if (!result.ok)
            active.trace.error = publicCodes.has(reply.error?.code)
              ? reply.error.code
              : 'ENDPOINT_REJECTED';
          if (reply.response?.finished) active.trace.final = reply.response;
          else if (reply.response?.toolCalls?.length) {
            const call = reply.response.toolCalls[0];
            const expected = active.turn.actions[active.trace.actions.length];
            if (!expected || !sameActions([call], [expected])) {
              active.trace.error = 'ACTION_MISMATCH';
              response
                .writeHead(502, { 'Content-Type': 'application/json' })
                .end(
                  JSON.stringify({
                    error: { code: 'INVALID_PROVIDER_RESPONSE' },
                  }),
                );
              return;
            }
            active.trace.actions.push({
              capabilityId: call.capabilityId,
              parameters: call.parameters,
            });
          }
        }
        response
          .writeHead(result.status, Object.fromEntries(result.headers))
          .end(body);
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405).end();
        return;
      }
      const pathname = decodeURIComponent(
        url.pathname === '/' ? '/index.html' : url.pathname,
      );
      const filename = path.resolve(output, `.${pathname}`);
      if (
        !filename.startsWith(output + path.sep) ||
        !mime[path.extname(filename)]
      ) {
        response.writeHead(404).end();
        return;
      }
      let current = output;
      for (const part of path.relative(output, filename).split(path.sep)) {
        current = path.join(current, part);
        if ((await lstat(current)).isSymbolicLink())
          throw new EvaluationError('UNSAFE_FIXTURE_PATH');
      }
      const bytes = await readFile(filename);
      response
        .writeHead(200, {
          'Content-Type': mime[path.extname(filename)],
          'Cache-Control': 'no-store',
        })
        .end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      response.writeHead(500).end();
    }
  });
  let origin;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    for (const scenario of plan.scenarios) {
      if (budget.started(scenario.id)) continue;
      if (!budget.remaining) break;
      const context = await browser.newContext({ serviceWorkers: 'block' });
      let passedTurns = 0;
      let code = 'PASS';
      active = {
        scenario,
        turn: scenario.turns[0],
        turnIndex: 0,
        trace: {},
        conversationIds: new Set(),
      };
      backend = createBackend({
        config: {
          origin,
          secure: false,
          sessionSecret: randomBytes(32).toString('hex'),
          accessCode: 'evaluation-fixture-code',
          dailyLimit: options.maximum,
          ipDailyLimit: options.maximum,
          trustVercel: false,
        },
        store: new SyntheticStore(),
        provider,
      });
      try {
        await context.route('**/*', (route) =>
          new URL(route.request().url()).origin === origin
            ? route.continue()
            : route.abort(),
        );
        const page = await context.newPage();
        await page.goto(origin);
        await page
          .getByRole('button', { name: 'Open PageSquire', exact: true })
          .click();
        const panel = page.getByRole('complementary', {
          name: 'PageSquire guided actions',
        });
        await panel
          .getByLabel('Demo access code')
          .fill('evaluation-fixture-code');
        await panel
          .getByRole('button', { name: 'Unlock AI', exact: true })
          .click();
        await expect(panel.getByLabel('Message PageSquire')).toBeEnabled();
        if (scenario.injection)
          await page.locator('#main').evaluate((element, text) => {
            const note = document.createElement('p');
            note.textContent = text;
            element.prepend(note);
          }, scenario.injection);
        for (const [index, turn] of scenario.turns.entries()) {
          active.turn = turn;
          active.turnIndex = index;
          active.trace = { actions: [], results: [] };
          if (budget.remaining < 1 + turn.actions.length) {
            code = 'BUDGET_EXHAUSTED';
            break;
          }
          const before = await page
            .locator('.hero-copy > p')
            .evaluate((element) => getComputedStyle(element).color);
          const messages = await panel
            .locator('.chat-message.assistant')
            .count();
          await panel.getByLabel('Message PageSquire').fill(turn.message);
          await panel
            .getByRole('button', { name: 'Send', exact: true })
            .click();
          await expect(panel.locator('.chat-message.assistant')).toHaveCount(
            messages + 1,
            { timeout: 45000 },
          );
          await expect(panel.getByLabel('Message PageSquire')).toBeEnabled();
          code = gradeTurn(turn, active.trace);
          if (
            turn.actions.some(
              (item) => item.capabilityId === 'accessibility.set_heading_color',
            )
          ) {
            const after = await page
              .locator('.hero-copy > p')
              .evaluate((element) => getComputedStyle(element).color);
            if (after !== before) code = 'HEADING_BODY_ISOLATION_FAILED';
          }
          if (code !== 'PASS') break;
          passedTurns++;
        }
        if (active.conversationIds.size > 1) code = 'CONVERSATION_CHANGED';
      } catch {
        code = 'BROWSER_FIXTURE_FAILED';
      } finally {
        await context.close();
      }
      await budget.finish({
        caseId: scenario.id,
        code,
        passedTurns,
        totalTurns: scenario.turns.length,
      });
      dependencies.onProgress?.({
        event: 'scenario',
        id: scenario.id,
        code,
        used: budget.used,
      });
    }
    const results = budget.results;
    return {
      schemaVersion: 1,
      mode: options.mode,
      suite: options.suite,
      sourceHash,
      fixtureBuildHash,
      fingerprint,
      configuration: metadata,
      maximumCalls: options.maximum,
      reservedCalls: budget.used,
      httpAttemptsThisRun: httpAttempts,
      plannedCalls: plan.plannedCalls,
      totalScenarios: plan.scenarios.length,
      passedScenarios: results.filter((item) => item.code === 'PASS').length,
      completedScenarios: results.length,
      uncompletedScenarios: plan.scenarios.length - results.length,
      emotionFallbacksThisRun: emotionFallbacks,
      latencyMsThisRun: latencies.length
        ? {
            minimum: Math.min(...latencies),
            maximum: Math.max(...latencies),
            mean: Math.round(
              latencies.reduce((sum, value) => sum + value, 0) /
                latencies.length,
            ),
          }
        : null,
      results,
      scope:
        'One configured model; isolated OFFBEAT Chromium fixture. Synthetic results are not model accuracy. No universal model, production-host or security certification.',
    };
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await budget.close();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseEvaluationArguments(process.argv.slice(2));
    if (options.mode === 'plan') {
      const plan = evaluationPlan(options.suite);
      console.log(
        JSON.stringify(
          {
            mode: 'plan',
            suite: options.suite,
            scenarios: plan.scenarios.length,
            plannedCalls: plan.plannedCalls,
            paidCalls: 0,
          },
          null,
          2,
        ),
      );
    } else {
      if (options.mode === 'synthetic')
        options.campaign = `${options.campaign.slice(0, 80)}-${randomBytes(6).toString('hex')}`;
      const report = await runModelEvaluation(options, {
        onProgress: (event) => console.error(JSON.stringify(event)),
      });
      console.log(JSON.stringify(report, null, 2));
      if (report.passedScenarios !== report.totalScenarios)
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        error:
          error instanceof EvaluationError ? error.code : 'EVALUATION_FAILED',
        detail:
          'No raw provider errors, credentials, prompts or response bodies are logged.',
      }),
    );
    process.exitCode = 1;
  }
}
