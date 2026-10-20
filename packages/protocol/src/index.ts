import * as validators from './generated/validators.js';
import { EMOTIONS } from './types.js';
import type {
  ActionCall,
  ActionResult,
  AssistantResponse,
  CapabilityDefinition,
  CapabilityManifest,
  ChatRequest,
  ChatReply,
  Emotion,
  PageSnapshot,
  ValidationResult,
} from './types.js';

export * from './types.js';
export * from './schemas.js';

function validate<T>(
  validator: (typeof validators)[keyof typeof validators],
  value: unknown,
): ValidationResult<T> {
  try {
    if (validator(value)) {
      return { valid: true, value: value as T, errors: [] };
    }

    return {
      valid: false,
      errors: (validator.errors ?? []).map(
        (error) =>
          `${error.instancePath || '/'}: ${error.message ?? 'invalid'}`,
      ),
    };
  } catch {
    return { valid: false, errors: ['/: invalid or unsupported input'] };
  }
}

export function validateCapability(value: unknown) {
  return validate<CapabilityDefinition>(validators.capability, value);
}

export function validateManifest(value: unknown) {
  return validate<CapabilityManifest>(validators.manifest, value);
}

export function validateActionCall(value: unknown) {
  return validate<ActionCall>(validators.actionCall, value);
}

export function validateAssistantResponse(value: unknown) {
  return validate<AssistantResponse>(validators.response, value);
}

export function validateSnapshot(value: unknown) {
  return validate<PageSnapshot>(validators.snapshot, value);
}

export function validateActionResult(value: unknown) {
  return validate<ActionResult>(validators.actionResult, value);
}

export function validateChatRequest(value: unknown) {
  return validate<ChatRequest>(validators.chatRequest, value);
}

export function validateChatReply(value: unknown) {
  return validate<ChatReply>(validators.chatReply, value);
}

export function validateProviderResponse(value: unknown) {
  return validate<{
    text: string;
    emotion: Emotion;
    finished: boolean;
    toolCalls: {
      capabilityId: string;
      parameters: import('./types.js').JsonObject;
    }[];
  }>(validators.providerResponse, value);
}

export function normalizeEmotion(
  value: unknown,
  fallback: Emotion = 'idle',
): Emotion {
  return EMOTIONS.includes(value as Emotion) ? (value as Emotion) : fallback;
}
