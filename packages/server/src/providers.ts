import type { CapabilityDefinition } from '@pagesquire/protocol';
import catalog from './provider-presets.js';
import { fail } from './engine.js';
import type { ProviderImageMessage, ProviderMessage } from './engine.js';

/**
 * `tools` sends approved capabilities as native function definitions and
 * reads the first tool call back as the single proposed action.
 */
export type ResponseMode = 'json_object' | 'prompt' | 'tools';

const toolInstruction =
  'Tool mode: to act, call exactly one of the provided functions with its arguments and do not describe the call in text. When no action is needed, reply with ONLY a JSON object {"text": string, "emotion": idle|happy|sad|thinking|confused|hover, "finished": true, "toolCalls": []}.';

/** Function names allow only [A-Za-z0-9_-]{1,64}; capability IDs may contain dots. */
export function toolNames(
  capabilities: readonly Pick<CapabilityDefinition, 'id'>[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const [index, { id }] of capabilities.entries()) {
    let name = id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
    if (names.has(name)) name = `${name.slice(0, 56)}_${index}`;
    names.set(name, id);
  }
  return names;
}
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
    !['json_object', 'prompt', 'tools'].includes(responseMode) ||
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
  messages: readonly (ProviderMessage | ProviderImageMessage)[],
  maximum: number,
  capabilities: readonly CapabilityDefinition[] = [],
): Record<string, unknown> {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 4096)
    fail(
      'INVALID_PROVIDER_CONFIG',
      'Configure a bounded output-token limit.',
      500,
    );
  const tools = config.responseMode === 'tools';
  const system = [
    ...messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content),
    ...(tools ? [toolInstruction] : []),
  ].join('\n\n');
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
  if (tools && capabilities.length) {
    const names = [...toolNames(capabilities).keys()];
    body.tools = capabilities.map((capability, index) => ({
      type: 'function',
      function: {
        name: names[index],
        description: capability.description,
        parameters: capability.inputSchema,
      },
    }));
  }
  if (config.thinking === 'disabled') {
    if (config.provider === 'qwen') body.enable_thinking = false;
    else body.thinking = { type: 'disabled' };
  }
  return body;
}

export function decodeCompletion(
  data: unknown,
  config?: Pick<ResolvedProviderConfiguration, 'responseMode'>,
  capabilities: readonly Pick<CapabilityDefinition, 'id'>[] = [],
): unknown {
  const invalid = (): never =>
    fail(
      'INVALID_PROVIDER_RESPONSE',
      'The provider returned an invalid, refused or incomplete assistant response.',
      502,
    );
  if (config?.responseMode === 'tools')
    return decodeToolCompletion(data, capabilities, invalid);
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

function decodeToolCompletion(
  data: unknown,
  capabilities: readonly Pick<CapabilityDefinition, 'id'>[],
  invalid: () => never,
): unknown {
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
  const calls = message?.tool_calls;
  if (
    !message ||
    (message.refusal != null && message.refusal !== '') ||
    message.function_call != null ||
    (calls != null && !Array.isArray(calls))
  )
    return invalid();
  if (Array.isArray(calls) && calls.length) {
    if (
      choice.finish_reason != null &&
      !['tool_calls', 'stop'].includes(choice.finish_reason as string)
    )
      return invalid();
    // One action at a time: later calls are never executed or reported.
    const call = calls[0] as {
      type?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    const capabilityId =
      typeof call?.function?.name === 'string'
        ? toolNames(capabilities).get(call.function.name)
        : undefined;
    const raw = call?.function?.arguments;
    if (
      (call?.type != null && call.type !== 'function') ||
      !capabilityId ||
      typeof raw !== 'string' ||
      Buffer.byteLength(raw) > 65536
    )
      return invalid();
    let parameters: unknown;
    try {
      parameters = JSON.parse(raw.trim() || '{}');
    } catch {
      return invalid();
    }
    if (
      !parameters ||
      typeof parameters !== 'object' ||
      Array.isArray(parameters)
    )
      return invalid();
    return {
      text: 'Checking the requested action…',
      emotion: 'thinking',
      finished: false,
      toolCalls: [{ capabilityId, parameters }],
    };
  }
  if (choice.finish_reason != null && choice.finish_reason !== 'stop')
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
  if (!text) return invalid();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  try {
    const value: unknown = JSON.parse(fenced ? fenced[1]! : text);
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value;
  } catch {
    /* A plain-text answer is a final reply without actions. */
  }
  // Text alone can never act: it becomes a finished, tool-free reply.
  return {
    text: [...text].slice(0, 8000).join(''),
    emotion: 'idle',
    finished: true,
    toolCalls: [],
  };
}
