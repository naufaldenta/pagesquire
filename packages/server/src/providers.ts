import { readFileSync } from 'node:fs';
import { fail } from './engine.js';
import type { ProviderMessage } from './engine.js';

export type ResponseMode = 'json_object' | 'prompt';
export type TokenParameter = 'max_tokens' | 'max_completion_tokens';
export interface ProviderPreset {
  id: string;
  label: string;
  endpoint: string | null;
  responseMode: ResponseMode;
  tokenParameter: TokenParameter;
  documentation: string;
}
export interface ProviderConfiguration {
  provider?: string;
  endpoint?: string;
  apiKey: string;
  model: string;
  responseMode?: ResponseMode;
  tokenParameter?: TokenParameter;
  systemRole?: 'system' | 'developer';
  thinking?: 'default' | 'disabled';
}
export interface ResolvedProviderConfiguration {
  provider: string;
  endpoint: string;
  apiKey: string;
  model: string;
  responseMode: ResponseMode;
  tokenParameter: TokenParameter;
  systemRole: 'system' | 'developer';
  thinking: 'default' | 'disabled';
}

const catalog = JSON.parse(
  readFileSync(new URL('./providers.json', import.meta.url), 'utf8'),
) as { providers: ProviderPreset[] };
export function listProviderPresets(): ProviderPreset[] {
  return structuredClone(catalog.providers);
}
export function resolveProviderConfiguration(
  input: ProviderConfiguration,
): ResolvedProviderConfiguration {
  const preset = catalog.providers.find(
    (item) => item.id === (input.provider ?? 'custom'),
  );
  const invalid = (): never =>
    fail(
      'INVALID_PROVIDER_CONFIG',
      'Configure a known provider, model, API key and secure chat endpoint.',
      500,
    );
  if (!preset) return invalid();
  if (
    (input.endpoint !== undefined && typeof input.endpoint !== 'string') ||
    typeof input.apiKey !== 'string' ||
    typeof input.model !== 'string'
  )
    return invalid();
  const endpoint = input.endpoint?.trim() || preset.endpoint;
  if (
    !endpoint ||
    !input.apiKey?.trim() ||
    input.apiKey.length > 4096 ||
    /[\r\n]/.test(input.apiKey) ||
    !input.model?.trim() ||
    input.model.length > 200 ||
    /[\r\n]/.test(input.model)
  )
    return invalid();
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return invalid();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    endpoint.length > 2048 ||
    /[\s{}]/.test(endpoint)
  )
    return invalid();
  const responseMode = input.responseMode ?? preset.responseMode;
  const tokenParameter = input.tokenParameter ?? preset.tokenParameter;
  const systemRole = input.systemRole ?? 'system';
  const thinking = input.thinking ?? 'default';
  if (
    !['json_object', 'prompt'].includes(responseMode) ||
    !['max_tokens', 'max_completion_tokens'].includes(tokenParameter) ||
    !['system', 'developer'].includes(systemRole) ||
    !['default', 'disabled'].includes(thinking) ||
    (thinking === 'disabled' &&
      !['qwen', 'zai', 'glm', 'deepseek'].includes(preset.id))
  )
    return invalid();
  return {
    provider: preset.id,
    endpoint: url.href,
    apiKey: input.apiKey,
    model: input.model,
    responseMode,
    tokenParameter,
    systemRole,
    thinking,
  };
}

/** Read only server-owned settings. No request/body values belong here. */
export function providerConfigurationFromEnv(
  env: Record<string, string | undefined>,
): ResolvedProviderConfiguration {
  const setting = (...keys: string[]) => {
    const values = keys
      .map((key) => env[key])
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.trim() !== '',
      );
    if (new Set(values).size > 1)
      fail(
        'INVALID_PROVIDER_CONFIG',
        'Conflicting provider settings must be resolved on the server.',
        500,
      );
    return values[0];
  };
  return resolveProviderConfiguration({
    provider: setting('PAGESQUIRE_PROVIDER') || 'custom',
    endpoint:
      setting('PAGESQUIRE_PROVIDER_URL', 'PAGESQUIRE_PROVIDER_ENDPOINT') || '',
    apiKey: setting('PAGESQUIRE_API_KEY', 'PAGESQUIRE_PROVIDER_KEY') || '',
    model: setting('PAGESQUIRE_MODEL', 'PAGESQUIRE_PROVIDER_MODEL') || '',
    responseMode: setting('PAGESQUIRE_RESPONSE_MODE') as ResponseMode,
    tokenParameter: setting('PAGESQUIRE_TOKEN_PARAMETER') as TokenParameter,
    systemRole: setting('PAGESQUIRE_SYSTEM_ROLE') as 'system' | 'developer',
    thinking: setting('PAGESQUIRE_THINKING') as 'default' | 'disabled',
  });
}

export function completionRequest(
  config: ResolvedProviderConfiguration,
  messages: readonly ProviderMessage[],
  maximum: number,
): Record<string, unknown> {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 4096)
    fail(
      'INVALID_PROVIDER_CONFIG',
      'Configure a bounded output-token limit.',
      500,
    );
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      ...(system ? [{ role: config.systemRole, content: system }] : []),
      ...messages.filter((message) => message.role !== 'system'),
    ],
    stream: false,
    [config.tokenParameter]: maximum,
  };
  if (config.responseMode === 'json_object')
    body.response_format = { type: 'json_object' };
  if (config.thinking === 'disabled') {
    if (config.provider === 'qwen') body.enable_thinking = false;
    else body.thinking = { type: 'disabled' };
  }
  return body;
}

export function decodeCompletion(data: unknown): unknown {
  const invalid = (): never =>
    fail(
      'INVALID_PROVIDER_RESPONSE',
      'The provider returned an invalid, refused or incomplete assistant response.',
      502,
    );
  const envelope = data as {
    choices?: {
      finish_reason?: unknown;
      message?: {
        content?: unknown;
        refusal?: unknown;
        tool_calls?: unknown;
        function_call?: unknown;
      };
    }[];
    error?: unknown;
  } | null;
  if (
    !envelope ||
    envelope.error != null ||
    !Array.isArray(envelope.choices) ||
    envelope.choices.length !== 1
  )
    return invalid();
  const choice = envelope.choices[0]!;
  const message = choice?.message;
  if (
    !message ||
    (choice.finish_reason != null && choice.finish_reason !== 'stop') ||
    (message.refusal != null && message.refusal !== '') ||
    message.function_call != null ||
    (message.tool_calls != null &&
      (!Array.isArray(message.tool_calls) || message.tool_calls.length))
  )
    return invalid();
  let content = message.content;
  if (Array.isArray(content)) {
    if (
      !content.length ||
      content.some(
        (part) =>
          !part || part.type !== 'text' || typeof part.text !== 'string',
      )
    )
      return invalid();
    content = content.map((part) => part.text).join('');
  }
  if (typeof content !== 'string' || Buffer.byteLength(content) > 65536)
    return invalid();
  const text = content.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  try {
    const value: unknown = JSON.parse(fenced ? fenced[1]! : text);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return invalid();
    return value;
  } catch {
    return invalid();
  }
}
