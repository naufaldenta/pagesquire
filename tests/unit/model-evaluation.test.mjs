import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ConversationEngine } from '@pagesquire/server';
import { openEvaluationBudget } from '../../scripts/model-evaluation-budget.mjs';
import {
  evaluationPlan,
  parseEvaluationArguments,
  runModelEvaluation,
} from '../../scripts/evaluate-model.mjs';
import {
  matrixScenarios,
  smokeScenarios,
  manifest,
  gradeTurn,
  sameActions,
} from '../fixtures/model-evaluation.mjs';

async function temporary(t) {
  const parent = await realpath(tmpdir());
  const directory = await realpath(
    await mkdtemp(path.join(parent, 'pagesquire-evaluation-')),
  );
  t.after(async () => {
    assert.equal(path.dirname(directory), parent);
    assert.ok(path.basename(directory).startsWith('pagesquire-evaluation-'));
    await rm(directory, { recursive: true });
  });
  return directory;
}
const budgetOptions = (root) => ({
  root,
  campaign: 'sumopod-b2',
  maximum: 12,
  fingerprint: 'a'.repeat(64),
});

test('evaluation defaults to a zero-call plan and requires an explicit bounded live campaign', () => {
  assert.equal(parseEvaluationArguments([]).mode, 'plan');
  assert.equal(evaluationPlan().plannedCalls, 12);
  assert.equal(matrixScenarios.length, 246);
  assert.equal(new Set(matrixScenarios.map((entry) => entry.id)).size, 246);
  assert.equal(smokeScenarios.length, 5);
  for (const args of [
    ['--live'],
    ['--live', '--synthetic'],
    ['--plan', '--live'],
    ['--max-calls', 'NaN'],
    ['--live', '--max-calls', '0', '--campaign', 'run'],
    ['--live', '--max-calls', '12', '--campaign', '../outside'],
    ['--provider', 'groq'],
    ['--suite', 'unknown'],
  ]) {
    assert.throws(() => parseEvaluationArguments(args));
  }
});

test('durable evaluation reservation is serialized, bounded and cannot reset on restart or change its cap', async (t) => {
  const root = await temporary(t);
  const options = budgetOptions(root);
  const budget = await openEvaluationBudget(options);
  await assert.rejects(openEvaluationBudget(options), {
    code: 'EVALUATION_LOCKED',
  });
  const reservations = await Promise.allSettled(
    Array.from({ length: 30 }, (_, index) =>
      budget.reserve(`case-${index}`, 0),
    ),
  );
  assert.equal(
    reservations.filter((entry) => entry.status === 'fulfilled').length,
    12,
  );
  assert.equal(budget.remaining, 0);
  await budget.finish({
    caseId: 'case-0',
    code: 'PASS',
    passedTurns: 1,
    totalTurns: 1,
  });
  await budget.close();
  const resumed = await openEvaluationBudget(options);
  assert.equal(resumed.used, 12);
  assert.equal(resumed.started('case-0'), true);
  assert.equal(resumed.started('case-11'), true);
  await assert.rejects(resumed.reserve('another-case', 0), {
    code: 'EVALUATION_BUDGET_EXHAUSTED',
  });
  await resumed.close();
  await assert.rejects(openEvaluationBudget({ ...options, maximum: 24 }), {
    code: 'EVALUATION_LEDGER_MISMATCH',
  });
  await assert.rejects(
    openEvaluationBudget({ ...options, fingerprint: 'b'.repeat(64) }),
    { code: 'EVALUATION_LEDGER_MISMATCH' },
  );
  const persisted = JSON.parse(
    await readFile(
      path.join(root, '.cache/model-evaluation/sumopod-b2/budget.json'),
      'utf8',
    ),
  );
  assert.equal(persisted.attempts.length, 12);
  assert.equal(JSON.stringify(persisted).includes('apiKey'), false);
});

test('invalid or interrupted campaign ledgers fail closed rather than silently starting a new paid run', async (t) => {
  const root = await temporary(t);
  const options = budgetOptions(root);
  const budget = await openEvaluationBudget(options);
  await budget.reserve('interrupted-case', 0);
  await budget.close();
  const directory = path.join(root, '.cache/model-evaluation/sumopod-b2');
  await writeFile(path.join(directory, 'campaign.lock'), 'stale fixture lock');
  await assert.rejects(openEvaluationBudget(options), {
    code: 'EVALUATION_LOCKED',
  });
  await rm(path.join(directory, 'campaign.lock'));
  await writeFile(path.join(directory, 'budget.json'), '{broken JSON');
  await assert.rejects(openEvaluationBudget(options));
});

test('live evaluator refuses non-Sumopod endpoints before launching a browser or making a request', async (t) => {
  await assert.rejects(
    runModelEvaluation(
      { mode: 'live', suite: 'smoke', maximum: 12, campaign: 'no-network' },
      {
        budgetRoot: await temporary(t),
        env: {
          PAGESQUIRE_PROVIDER: 'groq',
          PAGESQUIRE_API_KEY: 'synthetic-key',
          PAGESQUIRE_MODEL: 'synthetic-model',
        },
      },
    ),
    { code: 'SUMOPOD_ONLY_EVALUATION' },
  );
});

test('evaluation grading distinguishes wrong actions, missing verification, unclear responses and exhausted budgets', () => {
  const expected = matrixScenarios[0].turns[0];
  const trace = {
    actions: expected.actions,
    results: [{ status: 'success' }],
    final: { finished: true, text: 'Verified.' },
  };
  assert.equal(gradeTurn(expected, trace), 'PASS');
  assert.equal(
    gradeTurn(expected, { ...trace, actions: [] }),
    'ACTION_MISMATCH',
  );
  assert.equal(
    gradeTurn(expected, { ...trace, results: [] }),
    'MISSING_VERIFICATION',
  );
  assert.equal(
    gradeTurn(expected, { ...trace, results: [{ status: 'unverified' }] }),
    'POSTCONDITION_FAILED',
  );
  assert.equal(
    gradeTurn(expected, { ...trace, budgetExhausted: true }),
    'BUDGET_EXHAUSTED',
  );
  assert.equal(
    sameActions([{ capabilityId: 'unknown', parameters: {} }], [undefined]),
    false,
  );
  assert.equal(
    gradeTurn(
      { actions: [], kind: 'clarification' },
      { actions: [], results: [], final: { finished: true, text: 'Done.' } },
    ),
    'CLARIFICATION_NOT_OBSERVED',
  );
  assert.equal(
    gradeTurn(
      { actions: [], kind: 'unsupported' },
      {
        actions: [],
        results: [],
        final: { finished: true, text: 'Account deleted.' },
      },
    ),
    'LIMITATION_NOT_OBSERVED',
  );
});

test('provider documentation evidence covers every preset without claiming other live providers or a fixed model list', async () => {
  const catalog = JSON.parse(
    await readFile(
      new URL('../../packages/php/resources/providers.json', import.meta.url),
      'utf8',
    ),
  );
  const evidence = JSON.parse(
    await readFile(
      new URL('../../docs/provider-evidence.json', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(
    evidence.profiles.map((entry) => entry.id).sort(),
    catalog.providers.map((entry) => entry.id).sort(),
  );
  assert.match(evidence.reviewedOn, /^\d{4}-\d{2}-\d{2}$/);
  for (const entry of evidence.profiles) {
    assert.ok(
      ['documentation-reviewed', 'host-review-required'].includes(entry.status),
    );
    assert.ok(entry.sources.length > 0);
    assert.ok(entry.sources.every((url) => new URL(url).protocol === 'https:'));
    assert.equal(entry.model, undefined);
  }
  const result = JSON.parse(
    await readFile(
      new URL('../../docs/model-evaluation-result.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(result.evidenceLevel, 'live-smoke-tested');
  assert.equal(result.configuration.service, 'sumopod');
  assert.equal(result.httpAttemptsThisRun <= result.maximumCalls, true);
  assert.equal(result.reservedCalls <= result.maximumCalls, true);
  assert.equal(result.results.length, smokeScenarios.length);
  assert.equal(
    result.passedScenarios,
    result.results.filter((entry) => entry.code === 'PASS').length,
  );
  for (const field of ['sourceHash', 'fixtureBuildHash', 'fingerprint'])
    assert.match(result[field], /^[a-f0-9]{64}$/);
  assert.doesNotMatch(
    JSON.stringify(result),
    /apiKey|Authorization|databaseUrl|csrfToken|sessionSecret/,
  );
});

test('campaign resume rejects injected report fields instead of exporting arbitrary ledger content', async (t) => {
  const root = await temporary(t);
  const options = budgetOptions(root);
  const budget = await openEvaluationBudget(options);
  await budget.reserve('case-1', 0);
  await budget.finish({
    caseId: 'case-1',
    code: 'PASS',
    passedTurns: 1,
    totalTurns: 1,
  });
  await budget.close();
  const filename = path.join(
    root,
    '.cache/model-evaluation/sumopod-b2/budget.json',
  );
  const state = JSON.parse(await readFile(filename, 'utf8'));
  state.results[0].privateBody = 'must-not-be-exported';
  await writeFile(filename, JSON.stringify(state));
  await assert.rejects(openEvaluationBudget(options), {
    code: 'EVALUATION_LEDGER_MISMATCH',
  });
});

test('a model identifier that repeats the credential cannot enter public evaluation metadata', async (t) => {
  await assert.rejects(
    runModelEvaluation(
      {
        mode: 'live',
        suite: 'smoke',
        maximum: 12,
        campaign: 'secret-metadata',
      },
      {
        budgetRoot: await temporary(t),
        env: {
          PAGESQUIRE_PROVIDER: 'sumopod',
          PAGESQUIRE_API_KEY: 'synthetic-secret',
          PAGESQUIRE_MODEL: 'synthetic-secret',
        },
      },
    ),
    { code: 'UNSAFE_EVALUATION_METADATA' },
  );
});

let expectedAction;
const engine = new ConversationEngine({
  manifest,
  provider: {
    async complete(messages) {
      const hasResult = messages.some((entry) =>
        entry.content.includes('"browserResult"'),
      );
      return hasResult
        ? {
            text: 'Fixture verification.',
            emotion: 'happy',
            finished: true,
            toolCalls: [],
          }
        : {
            text: 'Checking.',
            emotion: 'thinking',
            finished: false,
            toolCalls: [expectedAction],
          };
    },
  },
});
for (const scenario of matrixScenarios)
  test(`evaluation matrix conformance (synthetic, not language accuracy): ${scenario.id}`, async () => {
    expectedAction = scenario.turns[0].actions[0];
    const request = {
      protocolVersion: '0.1',
      requestId: scenario.id,
      message: scenario.turns[0].message,
      capabilityIds: manifest.capabilities.map((entry) => entry.id),
      snapshot: {
        protocolVersion: '0.1',
        id: 'evaluation-snapshot',
        url: 'https://evaluation.example/',
        title: 'Synthetic public page',
        text: '',
        targets: [],
        truncated: { text: false, targets: false },
      },
    };
    const first = await engine.handle(request, null, request.capabilityIds);
    const call = first.reply.response.toolCalls[0];
    assert.equal(sameActions([call], [expectedAction]), true);
    const { message, ...continuation } = request;
    const result = await engine.handle(
      {
        ...continuation,
        requestId: scenario.id + '-result',
        conversationId: first.state.id,
        result: {
          protocolVersion: '0.1',
          callId: call.callId,
          capabilityId: call.capabilityId,
          status: 'success',
          code: 'SYNTHETIC',
          message: 'Synthetic telemetry, not a browser result.',
          evidence: {},
        },
      },
      first.state,
      request.capabilityIds,
    );
    assert.equal(result.reply.response.finished, true);
    assert.equal(result.state.attempts, 2);
  });
