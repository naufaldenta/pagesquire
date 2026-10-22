export const PROTOCOL_VERSION = '0.1' as const;

export const EMOTIONS = [
  'idle',
  'happy',
  'sad',
  'thinking',
  'confused',
  'hover',
] as const;

export type Emotion = (typeof EMOTIONS)[number];

export const CAPABILITY_AVAILABILITY_STATUSES = [
  'available',
  'needs_preparation',
  'not_applicable',
  'loading',
  'requires_selection',
  'disabled',
  'check_failed',
] as const;
export type CapabilityAvailabilityStatus =
  (typeof CAPABILITY_AVAILABILITY_STATUSES)[number];
export interface AppContextSnapshot {
  schemaVersion: 1;
  fields: { name: string; value: string | number | boolean }[];
  availability: {
    capabilityId: string;
    status: CapabilityAvailabilityStatus;
  }[];
}
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface ParameterSchema extends JsonObject {
  type: 'object';
  additionalProperties: false;
}

export interface CapabilityDefinition {
  id: string;
  description: string;
  execution: 'browser';
  handler: string;
  inputSchema: ParameterSchema;
  risk: 'read_only' | 'reversible' | 'consequential';
  verification: { handler: string };
  aliases?: string[];
}

export interface CapabilityManifest {
  schemaVersion: typeof PROTOCOL_VERSION;
  capabilities: CapabilityDefinition[];
}

export interface ActionCall {
  protocolVersion: typeof PROTOCOL_VERSION;
  callId: string;
  capabilityId: string;
  snapshotId: string;
  parameters: JsonObject;
}

export interface ObservedTarget {
  id: string;
  tag: string;
  name: string;
  role: string;
  disabled: boolean;
  actionable: boolean;
  href?: string;
}

export interface PageSnapshot {
  protocolVersion: typeof PROTOCOL_VERSION;
  id: string;
  url: string;
  title: string;
  text: string;
  targets: ObservedTarget[];
  truncated: { text: boolean; targets: boolean };
}

export type ActionStatus = 'success' | 'failed' | 'unverified' | 'cancelled';

export interface ActionResult {
  protocolVersion: typeof PROTOCOL_VERSION;
  callId: string;
  capabilityId: string;
  status: ActionStatus;
  code: string;
  message: string;
  evidence: JsonObject;
  observation?: PageSnapshot;
}

export interface AssistantResponse {
  protocolVersion: typeof PROTOCOL_VERSION;
  text: string;
  emotion: Emotion;
  finished: boolean;
  toolCalls: ActionCall[];
}

export interface ChatRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  requestId: string;
  conversationId?: string;
  message?: string;
  result?: ActionResult;
  snapshot: PageSnapshot;
  capabilityIds: string[];
  appContext?: AppContextSnapshot;
}

export interface ChatReply {
  protocolVersion: typeof PROTOCOL_VERSION;
  conversationId: string;
  response: AssistantResponse;
}

export type ValidationResult<T> =
  { valid: true; value: T; errors: [] } | { valid: false; errors: string[] };

export interface CompiledParameterValidator {
  schema: ParameterSchema;
  validate: (value: unknown) => boolean;
}
