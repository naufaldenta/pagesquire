import type { CapabilityDefinition } from '@pagesquire/protocol';
import { fail, encode, abortable } from './engine.js';
import type {
  Provider,
  ProviderImageMessage,
  ProviderMessage,
} from './engine.js';
import {
  completionRequest,
  decodeCompletion,
  resolveProviderConfiguration,
} from './providers.js';
import type {
  ProviderConfiguration,
  ResolvedProviderConfiguration,
} from './providers.js';

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
/**
 * Metadata about one provider call for host logging and metrics. It never
 * contains prompts, completions, headers, keys or response bodies.
 */
export interface ProviderDiagnostic {
  outcome:
    | 'ok'
    | 'http_error'
    | 'network_error'
    | 'timeout'
    | 'cancelled'
    | 'invalid_response';
  /** HTTP status, when a response was received. */
  status?: number;
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}
export interface OpenAiCompatibleOptions extends ProviderConfiguration {
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Synchronous trusted hook; its errors are ignored and never fail a call. */
  onDiagnostic?: (diagnostic: ProviderDiagnostic) => void;
}

function tokenUsage(data: unknown): ProviderDiagnostic['usage'] {
  const usage = (data as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const count = (value: unknown) =>
    Number.isSafeInteger(value) && (value as number) >= 0
      ? (value as number)
      : undefined;
  const result = {
    inputTokens: count(usage.prompt_tokens),
    outputTokens: count(usage.completion_tokens),
    totalTokens: count(usage.total_tokens),
  };
  const known = Object.fromEntries(
    Object.entries(result).filter(([, value]) => value !== undefined),
  );
  return Object.keys(known).length ? known : undefined;
}
export class OpenAiCompatibleProvider implements Provider {
  private readonly endpoint: URL;
  private readonly config: ResolvedProviderConfiguration;
  constructor(private readonly options: OpenAiCompatibleOptions) {
    this.config = resolveProviderConfiguration(options);
    this.endpoint = new URL(this.config.endpoint);
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
    messages: readonly (ProviderMessage | ProviderImageMessage)[],
    capabilities: readonly CapabilityDefinition[],
    maxOutputTokens: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const started = performance.now();
    const report = (
      outcome: ProviderDiagnostic['outcome'],
      extra: Partial<ProviderDiagnostic> = {},
    ) => {
      try {
        this.options.onDiagnostic?.({
          outcome,
          ...extra,
          latencyMs: Math.round(performance.now() - started),
        });
      } catch {
        /* Diagnostics never change a provider outcome. */
      }
    };
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 20000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const aborted = () => report(signal?.aborted ? 'cancelled' : 'timeout');
    const body = encode(
      completionRequest(this.config, messages, maxOutputTokens, capabilities),
    );
    let response: Response;
    try {
      response = await abortable(
        (this.options.fetch ?? fetch)(this.endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: combined,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.options.apiKey}`,
            'Accept-Encoding': 'identity',
          },
          body,
        }),
        combined,
      );
    } catch (error) {
      if (combined.aborted) aborted();
      else report('network_error');
      throw error;
    }
    if (
      !response.ok ||
      (response.headers.get('content-encoding') ?? 'identity') !== 'identity'
    ) {
      void response.body?.cancel();
      report('http_error', { status: response.status });
      fail(
        'PROVIDER_UNAVAILABLE',
        'The assistant provider is unavailable.',
        502,
      );
    }
    let data: unknown;
    try {
      data = JSON.parse(await readBounded(response, 262144, combined));
    } catch (error) {
      if (combined.aborted) aborted();
      else report('invalid_response', { status: response.status });
      if (combined.aborted) throw error;
      fail(
        'INVALID_PROVIDER_RESPONSE',
        'The provider returned an invalid assistant response.',
        502,
      );
    }
    const usage = tokenUsage(data);
    try {
      const draft = decodeCompletion(data, this.config, capabilities);
      report('ok', { status: response.status, ...(usage ? { usage } : {}) });
      return draft;
    } catch {
      report('invalid_response', {
        status: response.status,
        ...(usage ? { usage } : {}),
      });
      fail(
        'INVALID_PROVIDER_RESPONSE',
        'The provider returned an invalid assistant response.',
        502,
      );
    }
  }
}
