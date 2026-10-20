import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { ConversationEngine, AssistantError } from '@pagesquire/server';

const fixture = JSON.parse(
  await readFile(
    new URL('../fixtures/conformance.json', import.meta.url),
    'utf8',
  ),
);
for (const scenario of fixture.cases)
  test(`Node protocol conformance: ${scenario.name}`, async () => {
    let calls = 0;
    let state = null;
    let lastRequest;
    const queue = scenario.turns
      .filter((turn) => turn.draft)
      .map((turn) => turn.draft);
    const provider = {
      async complete(messages, capabilities) {
        calls++;
        assert.ok(
          !capabilities.some((entry) => entry.risk === 'consequential'),
        );
        assert.match(messages[0].content, /UNTRUSTED DATA/);
        const name = queue.shift();
        if (name === 'error') throw new Error('secret provider detail');
        return structuredClone(fixture.drafts[name]);
      },
    };
    const engine = new ConversationEngine({
      provider,
      manifest: fixture.manifest,
      ...(scenario.maxSteps ? { maxSteps: scenario.maxSteps } : {}),
      ...(scenario.maxAttempts ? { maxAttempts: scenario.maxAttempts } : {}),
    });
    for (const [index, turn] of scenario.turns.entries()) {
      let request = structuredClone(fixture.request);
      if (turn.kind === 'replay' || turn.kind === 'conflict') {
        request = structuredClone(lastRequest);
        if (turn.kind === 'conflict') request.message = 'Changed';
      } else if (turn.kind !== 'initial') {
        request.requestId = `request-${index + 1}`;
        request.conversationId = state.id;
        if (turn.kind === 'expired') state.expiresAt = 1;
        if (turn.kind === 'result') {
          delete request.message;
          request.result = {
            protocolVersion: '0.1',
            callId: turn.mismatch ? 'wrong' : state.pending.callId,
            capabilityId: state.pending.capabilityId,
            status: turn.resultStatus ?? 'success',
            code: 'FIXTURE',
            message: 'Fixture result',
            evidence: {},
          };
        }
      }
      lastRequest = request;
      let outcome;
      try {
        const result = await engine.handle(
          request,
          state,
          turn.allowed ?? ['testing.set', 'account.delete'],
          async (value) => {
            state = value;
          },
        );
        state = result.state;
        outcome = {
          code: 'OK',
          status: 200,
          emotion: result.reply.response.emotion,
          finished: result.reply.response.finished,
        };
        if (!outcome.finished)
          assert.equal(
            result.reply.response.text,
            'Checking the requested action…',
          );
      } catch (error) {
        assert.ok(error instanceof AssistantError);
        outcome = { code: error.code, status: error.status };
      }
      Object.assign(outcome, {
        calls,
        attempts: state?.attempts,
        steps: state?.steps,
      });
      for (const [key, expected] of Object.entries(turn.expected))
        assert.deepEqual(
          outcome[key],
          expected,
          `${scenario.name}: turn ${index + 1} ${key}`,
        );
    }
  });
