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
  /**
   * Ed25519 signature by the site's server over `claims`, a JSON string the
   * server wrote. Only the companion extension checks it.
   */
  signature?: ActionCallSignature;
}

export interface ActionCallSignature {
  claims: string;
  /** Base64 of the 64-byte signature over "pagesquire-call-v1." + claims. */
  value: string;
}

export interface ObservedTarget {
  id: string;
  tag: string;
  name: string;
  role: string;
  disabled: boolean;
  actionable: boolean;
  href?: string;
  /** Element state, present only when it applies. Field values are never sent. */
  checked?: boolean | 'mixed';
  expanded?: boolean;
  selected?: boolean;
  required?: boolean;
  invalid?: boolean;
  /** Whether a text field currently holds any value, without revealing it. */
  filled?: boolean;
  inViewport?: boolean;
  /** True when this target was not in the previous snapshot. */
  new?: boolean;
}

export interface PageSnapshot {
  protocolVersion: typeof PROTOCOL_VERSION;
  id: string;
  url: string;
  title: string;
  text: string;
  targets: ObservedTarget[];
  truncated: { text: boolean; targets: boolean };
  /** Target IDs from the previous snapshot that are no longer present. */
  removedTargets?: string[];
  /** Granted cross-origin frames, read by the companion extension. */
  frames?: FrameSnapshot[];
  /** Other tabs in the companion extension's session; this page is tab1. */
  tabs?: TabSnapshot[];
}

/** Another same-origin tab; its target IDs carry the tab ID, e.g. tab2-target-3. */
export interface TabSnapshot {
  id: string;
  /** Origin and path only. */
  url: string;
  title: string;
  text: string;
  targets: ObservedTarget[];
  truncated: { text: boolean; targets: boolean };
  /** The visitor is looking at this tab. */
  active: boolean;
}

/** One cross-origin frame; its target IDs carry the frame ID, e.g. frame1-target-3. */
export interface FrameSnapshot {
  id: string;
  origin: string;
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
  /** A redacted screenshot, only from ui.screenshot through the companion extension. */
  screenshot?: Screenshot;
}

/** A JPEG of a tab with form fields, private regions and frames blacked out. */
export interface Screenshot {
  mediaType: 'image/jpeg';
  /** Base64, at most 100,000 characters. */
  data: string;
  width: number;
  height: number;
}

export interface AssistantResponse {
  protocolVersion: typeof PROTOCOL_VERSION;
  text: string;
  emotion: Emotion;
  finished: boolean;
  toolCalls: ActionCall[];
  /** Planned steps shown with the first action of a turn; not a claim of progress. */
  plan?: string[];
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

/**
 * Optional streamed chat response (`Accept: application/x-ndjson`): one JSON
 * object per line. Progress lines carry only fixed server stages, never model
 * text; the last line is the validated reply or an error.
 */
export const SERVER_PROGRESS_STAGES = [
  'accepted',
  'thinking',
  'reviewing',
  'replaying',
] as const;
export type ServerProgressStage = (typeof SERVER_PROGRESS_STAGES)[number];
export const CHAT_STREAM_TYPE = 'application/x-ndjson';
export type ChatStreamEvent =
  | { type: 'progress'; stage: ServerProgressStage }
  | { type: 'reply'; reply: ChatReply }
  | {
      type: 'error';
      status: number;
      error: { code: string; message: string };
    };

export type ValidationResult<T> =
  { valid: true; value: T; errors: [] } | { valid: false; errors: string[] };

export interface CompiledParameterValidator {
  schema: ParameterSchema;
  validate: (value: unknown) => boolean;
}
