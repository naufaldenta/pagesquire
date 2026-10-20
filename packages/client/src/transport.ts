import type { ChatRequest } from '@pagesquire/protocol';
import { PageSquireError } from '@pagesquire/core';

export type ChatTransport = (
  request: ChatRequest,
  signal: AbortSignal,
) => Promise<unknown>;

export interface HttpTransportOptions {
  /** Use a host-generated named route, such as Wayfinder's chat.url(). */
  endpoint: string | URL;
  /** Supply the current host CSRF token. Never put a provider key here. */
  csrfToken: () => string;
  baseUrl: string | URL;
  fetch?: typeof fetch;
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
  return async (request, signal) => {
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
          Accept: 'application/json',
          'X-CSRF-TOKEN': token,
        },
        body: JSON.stringify(request),
      });
    } catch {
      signal.throwIfAborted();
      throw new PageSquireError(
        'NETWORK_ERROR',
        'The assistant server could not be reached.',
      );
    }
    if (
      !response.ok ||
      !response.headers.get('content-type')?.includes('application/json')
    ) {
      const failure = await readFailureCode(response);
      const explanations: Record<number, string> = {
        403: 'Your assistant access is unavailable. Reload the page and unlock the demo again.',
        409: 'This conversation expired or another request is running. Wait, then start a new conversation.',
        413: 'This conversation is too large. Start a new conversation with a shorter request.',
        419: 'Your session expired. Reload the page and try again.',
        429: 'The demo usage limit was reached. Wait before trying again; starting a new conversation does not reset the shared quota.',
        502: 'The AI provider could not return a valid response. Try a new message or start a new conversation.',
        503: 'The assistant service is temporarily unavailable. Please try again later.',
      };
      throw new PageSquireError(
        failure ?? `HTTP_${response.status}`,
        failure === 'CAPABILITY_DENIED'
          ? 'The AI requested an action this page does not allow. Please describe a supported page action.'
          : (explanations[response.status] ??
              'The assistant request was rejected. Start a new conversation or try again later.'),
      );
    }
    if (!response.body)
      throw new PageSquireError(
        'INVALID_RESPONSE',
        'The assistant response is empty.',
      );
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
            'The assistant response is too large.',
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
      throw new PageSquireError(
        'INVALID_RESPONSE',
        'The assistant response is invalid.',
      );
    }
  };
}

async function readFailureCode(
  response: Response,
): Promise<string | undefined> {
  const codes: Record<number, string[]> = {
    403: ['ACCESS_DENIED', 'CAPABILITY_DENIED'],
    409: [
      'CONVERSATION_EXPIRED',
      'ACTION_PENDING',
      'REPLAY_REJECTED',
      'RESULT_MISMATCH',
      'BUSY',
    ],
    502: [
      'INVALID_PARAMETERS',
      'INVALID_PROVIDER_RESPONSE',
      'PROVIDER_UNAVAILABLE',
    ],
  };
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
