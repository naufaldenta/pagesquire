import type { CapabilityDefinition } from '@pagesquire/protocol';
import { fail, encode, abortable } from './engine.js';
import type { Provider, ProviderMessage } from './engine.js';

export async function readBounded(
  response: Response | Request,
  maximum: number,
  signal?: AbortSignal,
): Promise<string> {
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    void response.body?.cancel().catch(() => {});
    fail('REQUEST_TOO_LARGE', 'The JSON body is too large.', 413);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await abortable(reader.read(), signal);
      if (done)
        return new TextDecoder('utf-8', { fatal: true }).decode(
          Buffer.concat(chunks),
        );
      total += value.byteLength;
      if (total > maximum)
        fail('REQUEST_TOO_LARGE', 'The JSON body is too large.', 413);
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}
export interface OpenAiCompatibleOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
export class OpenAiCompatibleProvider implements Provider {
  private readonly endpoint: URL;
  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.endpoint = new URL(options.endpoint);
    if (
      this.endpoint.protocol !== 'https:' ||
      this.endpoint.username ||
      this.endpoint.password ||
      this.endpoint.hash ||
      !options.apiKey.trim() ||
      /[\r\n]/.test(options.apiKey) ||
      !options.model.trim() ||
      options.model.length > 200 ||
      !Number.isInteger(options.timeoutMs ?? 20000) ||
      (options.timeoutMs ?? 20000) < 1 ||
      (options.timeoutMs ?? 20000) > 60000
    )
      fail(
        'INVALID_PROVIDER_CONFIG',
        'Configure a server-owned HTTPS provider.',
        500,
      );
  }
  async complete(
    messages: readonly ProviderMessage[],
    _capabilities: readonly CapabilityDefinition[],
    maxOutputTokens: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 20000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await abortable(
      (this.options.fetch ?? fetch)(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: combined,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.options.apiKey}`,
          'Accept-Encoding': 'identity',
        },
        body: encode({
          model: this.options.model,
          messages,
          max_tokens: maxOutputTokens,
          response_format: { type: 'json_object' },
        }),
      }),
      combined,
    );
    if (
      !response.ok ||
      (response.headers.get('content-encoding') ?? 'identity') !== 'identity'
    ) {
      void response.body?.cancel();
      fail(
        'PROVIDER_UNAVAILABLE',
        'The assistant provider is unavailable.',
        502,
      );
    }
    const data = JSON.parse(await readBounded(response, 262144, combined));
    const content: unknown = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || Buffer.byteLength(content) > 65536)
      fail(
        'INVALID_PROVIDER_RESPONSE',
        'The provider returned an invalid assistant response.',
        502,
      );
    return JSON.parse(content);
  }
}
