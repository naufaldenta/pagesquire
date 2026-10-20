import {
  AssistantError,
  ConversationEngine,
  OpenAiCompatibleProvider,
  createChatHandler,
  readBounded,
} from '../../../packages/server/dist/index.js';
import { manifest } from '../capabilities.mjs';
import { createSessions, equalSecret } from './auth.mjs';
import { createPool, readConfig } from './config.mjs';
import { PostgresConversationStore, StoreError } from './store.mjs';

export function reply(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

export function createBackend({ config, store, provider, now }) {
  const sessions = createSessions(config, now);
  const baseProvider =
    provider ??
    new OpenAiCompatibleProvider({
      endpoint: config.providerUrl,
      model: config.model,
      apiKey: config.apiKey,
      timeoutMs: 25000,
    });
  let lastCleanup = 0;
  async function cleanup() {
    if (Date.now() - lastCleanup < 60000) return;
    await store.cleanup();
    lastCleanup = Date.now();
  }
  async function handle(request) {
    try {
      const url = new URL(request.url);
      const route =
        url.pathname === '/api/assistant'
          ? url.searchParams.get('route')
          : url.pathname.slice('/api/'.length);
      if (
        !['chat', 'session'].includes(route) ||
        !url.pathname.startsWith('/api/')
      )
        return reply(
          { error: { code: 'NOT_FOUND', message: 'Not found.' } },
          404,
        );
      if (route === 'session' && request.method === 'GET') {
        const session = sessions.read(request);
        return reply({
          available: true,
          authenticated: Boolean(session),
          ...(session ? { csrfToken: session.csrfToken } : {}),
        });
      }
      const allowed = route === 'chat' ? ['POST'] : ['GET', 'POST', 'DELETE'];
      if (!allowed.includes(request.method))
        return reply(
          {
            error: {
              code: 'METHOD_NOT_ALLOWED',
              message: 'Method not allowed.',
            },
          },
          405,
          { Allow: allowed.join(', ') },
        );
      if (request.headers.get('origin') !== config.origin)
        return reply(
          {
            error: {
              code: 'ORIGIN_DENIED',
              message: 'The request origin is not authorized.',
            },
          },
          403,
        );
      if (
        (request.headers.get('content-encoding') ?? 'identity') !==
          'identity' ||
        !/^application\/json(?:\s*;|$)/i.test(
          request.headers.get('content-type') ?? '',
        )
      )
        return reply(
          {
            error: {
              code: 'JSON_REQUIRED',
              message: 'Send uncompressed JSON.',
            },
          },
          415,
        );
      const ip = sessions.clientKey(request);
      if (route === 'session' && request.method === 'POST') {
        await store.consume(`login:${ip}`, 5, 600);
        await store.consume('login:global', 100, 600);
        let input;
        try {
          input = JSON.parse(
            await readBounded(request, 1024, AbortSignal.timeout(5000)),
          );
        } catch {
          return reply(
            {
              error: {
                code: 'INVALID_LOGIN',
                message: 'Enter the demo access code.',
              },
            },
            400,
          );
        }
        if (
          !input ||
          typeof input !== 'object' ||
          Array.isArray(input) ||
          Object.keys(input).length !== 1 ||
          typeof input.accessCode !== 'string' ||
          input.accessCode.length > 256 ||
          !equalSecret(input.accessCode, config.accessCode)
        )
          return reply(
            {
              error: {
                code: 'ACCESS_DENIED',
                message: 'The access code is incorrect.',
              },
            },
            403,
          );
        await store.ready();
        await cleanup();
        const established = sessions.create();
        return reply(
          {
            available: true,
            authenticated: true,
            csrfToken: established.csrfToken,
          },
          200,
          { 'Set-Cookie': established.cookie },
        );
      }
      const session = sessions.read(request);
      if (!session)
        return reply(
          {
            error: {
              code: 'ACCESS_DENIED',
              message: 'Unlock the demo before using AI chat.',
            },
          },
          403,
        );
      if (
        !equalSecret(
          request.headers.get('x-csrf-token') ?? '',
          session.csrfToken,
        )
      )
        return reply(
          {
            error: {
              code: 'CSRF_MISMATCH',
              message: 'Reload the page before using the assistant.',
            },
          },
          419,
        );
      if (request.method === 'DELETE')
        return reply({ authenticated: false }, 200, {
          'Set-Cookie': sessions.clear(),
        });
      await store.consume(`request:${ip}`, 40, 60);
      await store.consume('request:global', 300, 60);
      await cleanup();
      let quotaError;
      const guardedProvider = {
        async complete(...args) {
          try {
            await store.consume(`provider:session:${session.key}`, 20, 3600);
            await store.consume(
              `provider:ip:${ip}`,
              config.ipDailyLimit,
              86400,
            );
            await store.consume(
              'provider:global:day',
              config.dailyLimit,
              86400,
            );
          } catch (error) {
            if (error instanceof StoreError && error.status === 429)
              quotaError = error;
            throw error;
          }
          return baseProvider.complete(...args);
        },
      };
      // Preserve the shared engine's durable checkpoint and authorization semantics.
      const wrappedStore = {
        async transaction(key, operation) {
          try {
            return await store.transaction(key, operation);
          } catch (error) {
            if (error instanceof StoreError)
              throw new AssistantError(error.code, error.message, error.status);
            throw error;
          }
        },
      };
      const response = await createChatHandler({
        origin: config.origin,
        engine: new ConversationEngine({
          manifest,
          provider: guardedProvider,
          maxSteps: 8,
          maxAttempts: 12,
          maxOutputTokens: 1000,
        }),
        store: wrappedStore,
        requestsPerMinute: 20,
        timeoutMs: 35000,
        authorize: async () => ({
          ...session,
          capabilityIds: manifest.capabilities.map((entry) => entry.id),
        }),
      })(request);
      return quotaError
        ? reply(
            { error: { code: quotaError.code, message: quotaError.message } },
            429,
            { 'Retry-After': String(quotaError.retryAfter) },
          )
        : response;
    } catch (error) {
      if (error instanceof StoreError)
        return reply(
          { error: { code: error.code, message: error.message } },
          error.status,
          error.status === 429
            ? { 'Retry-After': String(error.retryAfter ?? 60) }
            : {},
        );
      return reply(
        {
          error: {
            code: 'ASSISTANT_UNAVAILABLE',
            message:
              'The assistant is temporarily unavailable. Try again later.',
          },
        },
        503,
      );
    }
  }
  return { handle };
}

let deployed;
export async function handleDeployedRequest(request) {
  try {
    if (!deployed) {
      const config = readConfig();
      deployed = createBackend({
        config,
        store: new PostgresConversationStore(
          createPool(config.databaseUrl, config.databaseCa),
        ),
      });
    }
    return await deployed.handle(request);
  } catch {
    return reply(
      {
        error: {
          code: 'ASSISTANT_UNAVAILABLE',
          message:
            'The assistant is not configured or is temporarily unavailable.',
        },
      },
      503,
    );
  }
}
