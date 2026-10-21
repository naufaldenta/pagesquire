import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ConversationEngine,
  FileConversationStore,
  createChatHandler,
  forgetConversation,
} from '../../packages/server/dist/index.js';
import { validateProviderResponse } from '@pagesquire/protocol';

// Same-build serialized fixtures, not a published-version or production restore certificate.
const fixture = JSON.parse(
  await readFile(
    new URL('../fixtures/conformance.json', import.meta.url),
    'utf8',
  ),
);
const origin = 'https://example.test';
const identity = {
  key: 'synthetic-recovery',
  principal: 'synthetic-user:revision-1',
  csrfToken: 'c'.repeat(48),
  capabilityIds: ['testing.set'],
};
const request = (body) =>
  new Request(origin + '/chat', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': identity.csrfToken,
    },
    body: JSON.stringify(body),
  });
async function directory(t) {
  const parent = await realpath(tmpdir());
  const root = await realpath(
    await mkdtemp(path.join(parent, 'pagesquire-recovery-')),
  );
  t.after(async () => {
    assert.equal(path.dirname(root), parent);
    assert.ok(path.basename(root).startsWith('pagesquire-recovery-'));
    await rm(root, { recursive: true });
  });
  return root;
}
function handler(directory, provider, session = identity, limits = {}) {
  return createChatHandler({
    origin,
    store: new FileConversationStore(directory),
    authorize: async () => session,
    engine: new ConversationEngine({
      manifest: fixture.manifest,
      provider,
      ...limits,
    }),
  });
}
async function stored(directory) {
  return new FileConversationStore(directory).transaction(identity.key, (tx) =>
    tx.load(),
  );
}
async function restoreQuiesced(t, source) {
  const destination = await directory(t);
  const filename =
    createHash('sha256').update(identity.key).digest('hex') + '.json';
  const checkpoint = await readFile(path.join(source, filename));
  await writeFile(path.join(destination, filename), checkpoint, {
    flag: 'wx',
    mode: 0o600,
  });
  return destination;
}
function resultRequest(first, status = 'success') {
  const call = first.response.toolCalls[0];
  const body = {
    ...fixture.request,
    conversationId: first.conversationId,
    requestId: 'recovery-result',
    result: {
      protocolVersion: '0.1',
      callId: call.callId,
      capabilityId: call.capabilityId,
      status,
      code: 'SYNTHETIC',
      message: 'Synthetic browser result',
      evidence: {},
    },
  };
  delete body.message;
  return body;
}

test('quiesced same-format checkpoint reopens with pending/cached IDs and processes its result only once', async (t) => {
  const original = await directory(t);
  let initialCalls = 0;
  const first = await (
    await handler(original, {
      async complete() {
        initialCalls++;
        return structuredClone(fixture.drafts.action);
      },
    })(request(fixture.request))
  ).json();
  const before = await stored(original);
  const restored = await restoreQuiesced(t, original);
  let afterCalls = 0;
  const current = handler(restored, {
    async complete() {
      afterCalls++;
      return structuredClone(fixture.drafts.final);
    },
  });
  assert.deepEqual(
    await (await current(request(fixture.request))).json(),
    first,
  );
  assert.equal(afterCalls, 0);
  assert.equal(
    (await stored(restored)).state.pending.callId,
    before.state.pending.callId,
  );
  const body = resultRequest(first);
  const final = await (await current(request(body))).json();
  assert.equal(final.response.finished, true);
  assert.equal(final.response.emotion, 'happy');
  assert.deepEqual(
    await (
      await handler(restored, {
        async complete() {
          throw Error('Replay must not infer');
        },
      })(request(body))
    ).json(),
    final,
  );
  const after = await stored(restored);
  assert.equal(initialCalls, 1);
  assert.equal(afterCalls, 1);
  assert.equal(after.state.id, before.state.id);
  assert.equal(after.state.attempts, 2);
  assert.equal(after.state.steps, 1);
  assert.equal(after.state.pending, null);
  assert.equal(after.rate.count, before.rate.count + 3);
});

test('restoring a checkpoint never restores revoked capability permission or a changed principal', async (t) => {
  const original = await directory(t);
  const first = await (
    await handler(original, {
      async complete() {
        return structuredClone(fixture.drafts.action);
      },
    })(request(fixture.request))
  ).json();
  const restored = await restoreQuiesced(t, original);
  let calls = 0;
  const provider = {
    async complete() {
      calls++;
      throw Error('Must not infer');
    },
  };
  const denied = await handler(restored, provider, {
    ...identity,
    capabilityIds: [],
  })(request(resultRequest(first)));
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'CAPABILITY_DENIED');
  const changed = await handler(restored, provider, {
    ...identity,
    principal: 'synthetic-user:revision-2',
  })(request(resultRequest(first)));
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error.code, 'CONVERSATION_EXPIRED');
  assert.equal(calls, 0);
  assert.equal((await stored(restored)).rate.count, 3);
});

test('failed inference and request counts survive serialized reopen without retrying an exhausted provider budget', async (t) => {
  const original = await directory(t);
  let calls = 0;
  const provider = {
    async complete() {
      calls++;
      throw Error('SYNTHETIC_PRIVATE_PROVIDER_DETAIL');
    },
  };
  const failure = await handler(original, provider, identity, {
    maxAttempts: 1,
  })(request(fixture.request));
  assert.equal(failure.status, 502);
  assert.doesNotMatch(
    await failure.text(),
    /SYNTHETIC_PRIVATE_PROVIDER_DETAIL/,
  );
  const before = await stored(original);
  const restored = await restoreQuiesced(t, original);
  const body = {
    ...fixture.request,
    requestId: 'after-recovery',
    conversationId: before.state.id,
    message: 'Continue without budget reset',
  };
  const response = await handler(restored, provider, identity, {
    maxAttempts: 1,
  })(request(body));
  assert.equal(response.status, 200);
  const final = await response.json();
  assert.match(final.response.text, /limit was reached/);
  assert.equal(final.response.toolCalls.length, 0);
  assert.equal(calls, 1);
  const after = await stored(restored);
  assert.equal(after.state.attempts, 1);
  assert.equal(after.rate.count, before.rate.count + 1);
});

test('legacy-shaped server history is normalized after durable reopen without resetting attempts or replaying a tool', async (t) => {
  const root = await directory(t);
  const first = await (
    await handler(root, {
      async complete() {
        return structuredClone(fixture.drafts.action);
      },
    })(request(fixture.request))
  ).json();
  const cancelled = await handler(root, {
    async complete() {
      throw Error('Cancellation must not infer');
    },
  })(request(resultRequest(first, 'cancelled')));
  assert.equal(cancelled.status, 200);
  await new FileConversationStore(root).transaction(
    identity.key,
    async (tx) => {
      const value = await tx.load();
      value.state.messages[1].content = JSON.stringify({
        requestedAction: first.response.toolCalls[0],
      });
      value.state.messages.at(-1).content = 'Legacy plain assistant text';
      await tx.save(value);
    },
  );
  const before = await stored(root);
  const restored = await restoreQuiesced(t, root);
  let calls = 0;
  const response = await handler(restored, {
    async complete(messages) {
      calls++;
      for (const message of messages.filter(
        (entry) => entry.role === 'assistant',
      )) {
        assert.equal(
          validateProviderResponse(JSON.parse(message.content)).valid,
          true,
        );
        assert.doesNotMatch(
          message.content,
          /requestedAction|callId|snapshotId/,
        );
      }
      return structuredClone(fixture.drafts.final);
    },
  })(
    request({
      ...fixture.request,
      requestId: 'legacy-after-recovery',
      conversationId: first.conversationId,
      message: 'A new independent question',
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  const after = await stored(restored);
  assert.equal(after.state.id, before.state.id);
  assert.equal(after.state.attempts, before.state.attempts + 1);
  assert.equal(after.state.steps, before.state.steps);
  assert.equal(after.state.pending, null);
});

test('privacy quota shell survives a quiesced reopen without restoring transcript or pending action', async (t) => {
  const original = await directory(t);
  await handler(original, {
    async complete() {
      return structuredClone(fixture.drafts.action);
    },
  })(request(fixture.request));
  await forgetConversation(
    new FileConversationStore(original),
    identity.key,
    identity.principal,
  );
  const before = await stored(original);
  const restored = await restoreQuiesced(t, original);
  assert.deepEqual(await stored(restored), before);
  assert.equal((await stored(restored)).state, null);
  assert.equal((await stored(restored)).rate.count, 1);
});
