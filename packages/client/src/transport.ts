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
      throw new PageSquireError(
        `HTTP_${response.status}`,
        response.status === 419
          ? 'Your session expired. Reload the page and try again.'
          : 'The assistant request was rejected. Start a new conversation or try again later.',
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
