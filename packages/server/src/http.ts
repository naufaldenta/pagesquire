import { timingSafeEqual } from 'node:crypto';
import {
  AssistantError,
  ConversationEngine,
  fail,
  abortable,
} from './engine.js';
import { readBounded } from './provider.js';
import type {
  ChatReply,
  ChatRequest,
  ChatStreamEvent,
  ServerProgressStage,
} from '@pagesquire/protocol';
import { CHAT_STREAM_TYPE, validateChatRequest } from '@pagesquire/protocol';
import type { ConversationStore, StoredSession } from './store.js';

export interface AuthorizedSession {
  /** Opaque trusted session identifier, never a client supplied conversation ID. */
  key: string;
  /** Include a host authorization revision here to invalidate changed identities/roles. */
  principal: string;
  csrfToken: string;
  capabilityIds: readonly string[];
}
export interface HandlerOptions {
  engine: ConversationEngine;
  store: ConversationStore;
  origin: string;
  authorize: (request: Request) => Promise<AuthorizedSession | null>;
  requestsPerMinute?: number;
  /** Provider attempts per trusted session per hour, counted across conversations. */
  attemptsPerHour?: number;
  timeoutMs?: number;
}

/** Suitable for a Node Web Request host or Next.js nodejs Route Handler. No cookies are invented. */
export function createChatHandler(
  options: HandlerOptions,
): (request: Request) => Promise<Response> {
  const origin = new URL(options.origin);
  const limit = options.requestsPerMinute ?? 20;
  const attemptLimit = options.attemptsPerHour ?? 60;
  const timeout = options.timeoutMs ?? 30000;
  if (
    !['https:', 'http:'].includes(origin.protocol) ||
    origin.origin !== options.origin ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isInteger(attemptLimit) ||
    attemptLimit < 1 ||
    attemptLimit > 1000 ||
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > 60000
  )
    fail('INVALID_OPTIONS', 'Invalid endpoint limits or origin.', 500);
  return async (request) => {
    try {
      if (request.method !== 'POST')
        fail('METHOD_NOT_ALLOWED', 'Use POST.', 405);
      // Hosts may construct Request.url with an internal proxy origin. Never infer the public origin from it.
      if (request.headers.get('origin') !== origin.origin)
        fail('ORIGIN_DENIED', 'The request origin is not authorized.', 403);
      if (
        !/^application\/json(?:\s*;|$)/i.test(
          request.headers.get('content-type') ?? '',
        )
      )
        fail('JSON_REQUIRED', 'Send an application/json request.', 415);
      if (
        request.headers.has('content-encoding') &&
        request.headers.get('content-encoding') !== 'identity'
      )
        fail(
          'JSON_REQUIRED',
          'Compressed request bodies are not supported.',
          415,
        );
      const signal = AbortSignal.any([
        request.signal,
        AbortSignal.timeout(timeout),
      ]);
      const session = await abortable(options.authorize(request), signal);
      if (!session || !session.key || !session.principal)
        fail('ACCESS_DENIED', 'The assistant is not authorized.', 403);
      const token = request.headers.get('x-csrf-token') ?? '';
      const a = Buffer.from(token);
      const b = Buffer.from(session.csrfToken);
      if (
        a.length < 16 ||
        a.length > 256 ||
        a.length !== b.length ||
        !timingSafeEqual(a, b)
      )
        fail(
          'CSRF_MISMATCH',
          'Refresh the page before using the assistant.',
          419,
        );
      let raw: unknown;
      try {
        raw = JSON.parse(await readBounded(request, 196608, signal));
      } catch (error) {
        if (error instanceof AssistantError) throw error;
        fail('INVALID_PAYLOAD', 'Invalid JSON request.');
      }
      if (!validateChatRequest(raw).valid)
        fail(
          'INVALID_PAYLOAD',
          'The payload does not match the PageSquire contract.',
        );
      const run = (onProgress?: (stage: ServerProgressStage) => void) =>
        options.store.transaction(session.key, async (transaction) => {
          signal.throwIfAborted();
          let stored = await transaction.load();
          const now = Math.floor(Date.now() / 1000);
          // Preserve the rate bucket across identity changes within the same trusted session.
          const rate =
            stored?.rate && now - stored.rate.since < 60
              ? stored.rate
              : { since: now, count: 0 };
          if (rate.count >= limit)
            fail(
              'RATE_LIMITED',
              'Too many assistant requests. Try again later.',
              429,
            );
          rate.count++;
          // Starting a new conversation resets the engine's per-conversation
          // attempts, so the session also keeps an hourly provider budget.
          const budget =
            stored?.budget && now - stored.budget.since < 3600
              ? stored.budget
              : { since: now, count: 0 };
          stored = {
            principal: session.principal,
            state:
              stored?.principal === session.principal ? stored.state : null,
            rate,
            budget,
          };
          const current: StoredSession = stored;
          await transaction.save(current);
          let charged = current.state && {
            id: current.state.id,
            attempts: current.state.attempts,
          };
          const result = await options.engine.handle(
            raw as ChatRequest,
            current.state,
            session.capabilityIds,
            async (state) => {
              const added =
                state.attempts -
                (charged?.id === state.id ? charged.attempts : 0);
              if (added > 0) {
                if (budget.count + added > attemptLimit)
                  fail(
                    'BUDGET_EXHAUSTED',
                    'The assistant usage limit was reached. Try again later.',
                    429,
                  );
                budget.count += added;
              }
              charged = { id: state.id, attempts: state.attempts };
              current.state = state;
              await transaction.save(current);
            },
            signal,
            onProgress,
          );
          return result.reply;
        });
      // Streaming starts only after origin, CSRF, authorization and payload
      // checks passed; those failures stay ordinary JSON errors.
      if ((request.headers.get('accept') ?? '').includes(CHAT_STREAM_TYPE))
        return streamed(run);
      return json(await run());
    } catch (error) {
      const known = toKnown(error);
      return json(
        { error: { code: known.code, message: known.message } },
        known.status,
      );
    }
  };
}
function toKnown(error: unknown): AssistantError {
  return error instanceof AssistantError
    ? error
    : new AssistantError(
        'ASSISTANT_UNAVAILABLE',
        'The assistant is unavailable. Try again later.',
        503,
      );
}

/**
 * NDJSON: fixed progress stages while the server works (repeated every 10 s
 * as a keep-alive), then exactly one validated reply or error line. Model
 * text is never streamed before validation.
 */
function streamed(
  run: (onProgress: (stage: ServerProgressStage) => void) => Promise<ChatReply>,
): Response {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: ChatStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      let last: ServerProgressStage = 'accepted';
      const stage = (value: ServerProgressStage) => {
        last = value;
        send({ type: 'progress', stage: value });
      };
      stage('accepted');
      timer = setInterval(() => send({ type: 'progress', stage: last }), 10000);
      try {
        send({ type: 'reply', reply: await run(stage) });
      } catch (error) {
        const known = toKnown(error);
        send({
          type: 'error',
          status: known.status,
          error: { code: known.code, message: known.message },
        });
      } finally {
        clearInterval(timer);
        open = false;
        try {
          controller.close();
        } catch {
          /* The visitor already went away. */
        }
      }
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': `${CHAT_STREAM_TYPE}; charset=utf-8`,
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      // Ask reverse proxies not to buffer the progress lines.
      'X-Accel-Buffering': 'no',
    },
  });
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      ...(status === 405 ? { Allow: 'POST' } : {}),
      ...(status === 429 ? { 'Retry-After': '60' } : {}),
    },
  });
}
