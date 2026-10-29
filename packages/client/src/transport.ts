import type { ChatRequest, ServerProgressStage } from '@pagesquire/protocol';
import { CHAT_STREAM_TYPE, SERVER_PROGRESS_STAGES } from '@pagesquire/protocol';
import { PageSquireError } from '@pagesquire/core';
import { resolveMessages } from './i18n.js';
import type { LocaleOptions, MessageKey, Messages } from './i18n.js';

export type ChatTransport = (
  request: ChatRequest,
  signal: AbortSignal,
  /** Fixed server stages while a streamed request is in progress. */
  onProgress?: (stage: ServerProgressStage) => void,
) => Promise<unknown>;

export interface HttpTransportOptions extends LocaleOptions {
  /** Use a host-generated named route, such as Wayfinder's chat.url(). */
  endpoint: string | URL;
  /** Supply the current host CSRF token. Never put a provider key here. */
  csrfToken: () => string;
  baseUrl: string | URL;
  fetch?: typeof fetch;
  /**
   * Ask for streamed server progress (default true). Servers that do not
   * stream answer with plain JSON, which is handled the same way.
   */
  stream?: boolean;
}

export function createHttpTransport(
  options: HttpTransportOptions,
): ChatTransport {
  const base = new URL(options.baseUrl);
  const endpoint = new URL(options.endpoint, base);
  if (
    endpoint.origin !== base.origin ||
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new PageSquireError(
      'INVALID_ENDPOINT',
      'The assistant endpoint must be same-origin.',
    );
  }
  const fetcher = options.fetch ?? globalThis.fetch;
  const t = resolveMessages(options);
  return async (request, signal, onProgress) => {
    const token = options.csrfToken();
    if (!token)
      throw new PageSquireError(
        'CSRF_REQUIRED',
        'The host CSRF token is missing.',
      );
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Accept:
            options.stream === false
              ? 'application/json'
              : `${CHAT_STREAM_TYPE}, application/json;q=0.9`,
          'X-CSRF-TOKEN': token,
        },
        body: JSON.stringify(request),
      });
    } catch {
      signal.throwIfAborted();
      throw new PageSquireError('NETWORK_ERROR', t['error.network']);
    }
    const type = response.headers.get('content-type') ?? '';
    if (response.ok && type.includes(CHAT_STREAM_TYPE))
      return readStream(response, t, onProgress);
    if (!response.ok || !type.includes('application/json'))
      throw explain(t, response.status, await readFailureCode(response));
    if (!response.body)
      throw new PageSquireError('INVALID_RESPONSE', t['error.emptyResponse']);
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 196608)
          throw new PageSquireError(
            'INVALID_RESPONSE',
            t['error.responseTooLarge'],
          );
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new PageSquireError('INVALID_RESPONSE', t['error.invalidResponse']);
    }
  };
}

/** Only these server codes are surfaced; anything else becomes HTTP_<status>. */
const FAILURE_CODES: Record<number, string[]> = {
  403: ['ACCESS_DENIED', 'CAPABILITY_DENIED'],
  409: [
    'CAPABILITY_UNAVAILABLE',
    'CONVERSATION_EXPIRED',
    'ACTION_PENDING',
    'REPLAY_REJECTED',
    'RESULT_MISMATCH',
    'BUSY',
    'HANDOFF_USED',
    'HANDOFF_UNAVAILABLE',
  ],
  410: ['HANDOFF_EXPIRED'],
  502: [
    'INVALID_PARAMETERS',
    'INVALID_PROVIDER_RESPONSE',
    'PROVIDER_UNAVAILABLE',
  ],
};

function explain(
  t: Messages,
  status: number,
  failure: string | undefined,
): PageSquireError {
  const explanations: Record<number, MessageKey> = {
    403: 'error.http403',
    409: 'error.http409',
    413: 'error.http413',
    419: 'error.http419',
    429: 'error.http429',
    502: 'error.http502',
    503: 'error.http503',
  };
  return new PageSquireError(
    failure ?? `HTTP_${status}`,
    failure === 'CAPABILITY_DENIED'
      ? t['error.capabilityDenied']
      : failure === 'CAPABILITY_UNAVAILABLE'
        ? t['error.capabilityUnavailable']
        : failure === 'HANDOFF_EXPIRED'
          ? t['error.handoffExpired']
          : t[explanations[status] ?? 'error.httpOther'],
  );
}

/**
 * Reads NDJSON progress lines until the final reply or error line. Only
 * fixed stages are passed on; the reply is validated by the client as usual.
 */
async function readStream(
  response: Response,
  t: Messages,
  onProgress?: (stage: ServerProgressStage) => void,
): Promise<unknown> {
  if (!response.body)
    throw new PageSquireError('INVALID_RESPONSE', t['error.emptyResponse']);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let size = 0;
  const handle = (line: string): { reply: unknown } | undefined => {
    if (!line.trim()) return;
    let event: {
      type?: unknown;
      stage?: unknown;
      reply?: unknown;
      status?: unknown;
      error?: { code?: unknown };
    };
    try {
      event = JSON.parse(line);
    } catch {
      throw new PageSquireError('INVALID_RESPONSE', t['error.invalidResponse']);
    }
    if (
      event?.type === 'progress' &&
      SERVER_PROGRESS_STAGES.includes(event.stage as ServerProgressStage)
    ) {
      try {
        onProgress?.(event.stage as ServerProgressStage);
      } catch {
        /* Presentation hooks cannot interrupt a request. */
      }
      return;
    }
    if (event?.type === 'reply') return { reply: event.reply };
    if (event?.type === 'error') {
      const status =
        Number.isInteger(event.status) &&
        (event.status as number) >= 400 &&
        (event.status as number) <= 599
          ? (event.status as number)
          : 503;
      const code = event.error?.code;
      throw explain(
        t,
        status,
        typeof code === 'string' && FAILURE_CODES[status]?.includes(code)
          ? code
          : undefined,
      );
    }
    // Unknown line types are ignored for forward compatibility.
    return;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) {
        size += value.byteLength;
        if (size > 262144)
          throw new PageSquireError(
            'INVALID_RESPONSE',
            t['error.responseTooLarge'],
          );
        buffer += decoder.decode(value, { stream: true });
      }
      if (done) buffer += decoder.decode();
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const result = handle(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (result) return result.reply;
      }
      if (done) {
        const result = handle(buffer);
        if (result) return result.reply;
        throw new PageSquireError(
          'INVALID_RESPONSE',
          t['error.invalidResponse'],
        );
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readFailureCode(
  response: Response,
): Promise<string | undefined> {
  const codes = FAILURE_CODES;
  if (
    !codes[response.status] ||
    !response.body ||
    !response.headers.get('content-type')?.includes('application/json')
  ) {
    void response.body?.cancel().catch(() => {});
    return;
  }
  const reader = response.body.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) return;
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const data = JSON.parse(new TextDecoder().decode(bytes)) as {
      error?: { code?: unknown };
    } | null;
    const code = data?.error?.code;
    return typeof code === 'string' && codes[response.status]!.includes(code)
      ? code
      : undefined;
  } catch {
    return;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
