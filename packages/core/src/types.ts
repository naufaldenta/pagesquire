import type { ActionCall, JsonObject } from '@pagesquire/protocol';
import type { PageObserver } from './observer.js';
import type { PresentationKind } from './driving.js';

export const ACTION_PROGRESS_STAGES = Object.freeze([
  'checking',
  'executing',
  'verifying',
  'navigation_pending',
  'verified',
  'unverified',
  'failed',
  'cancelled',
  'timed_out',
  'replayed',
] as const);
export type ActionProgressStage = (typeof ACTION_PROGRESS_STAGES)[number];
export const ACTION_PROGRESS_CODES = Object.freeze([
  'INVALID_CALL',
  'UNKNOWN_CAPABILITY',
  'INVALID_PARAMETERS',
  'CONFIRMATION_REQUIRED',
  'CAPABILITY_UNAVAILABLE',
  'STALE_SNAPSHOT',
  'STALE_TARGET',
  'TARGET_MISSING',
  'AMBIGUOUS_TARGET',
  'TARGET_NOT_ALLOWED',
  'URL_NOT_ALLOWED',
  'NAVIGATION_UNAVAILABLE',
  'NAVIGATION_MISMATCH',
  'NAVIGATION_PENDING',
  'POSTCONDITION_FAILED',
  'INVALID_VERIFICATION',
  'VERIFIED',
  'BUSY',
  'ACTION_LIMIT',
  'CALL_ID_REUSED',
  'CANCELLED',
  'TIMEOUT',
  'HANDLER_FAILED',
  'ACTION_FAILED',
] as const);
export type ActionProgressCode = (typeof ACTION_PROGRESS_CODES)[number];
/** Local operational metadata only; never parameters, evidence or error messages. */
export interface ActionProgressEvent {
  callId: string;
  capabilityId: string;
  stage: ActionProgressStage;
  code?: ActionProgressCode;
}
export type ActionProgressListener = (
  event: Readonly<ActionProgressEvent>,
) => void;

export interface ExecutionContext {
  document: Document;
  observer: PageObserver;
  call: ActionCall;
  signal: AbortSignal;
  navigate: (url: string) => Promise<void>;
  waitFor: (predicate: () => boolean | Promise<boolean>) => Promise<void>;
  present: (target: Element, kind?: PresentationKind) => Promise<void>;
}

export type CapabilityHandler = (
  parameters: JsonObject,
  context: ExecutionContext,
) => void | Promise<void>;

export interface Verification {
  verified: boolean;
  evidence?: JsonObject;
}

export type VerificationHandler = (
  parameters: JsonObject,
  context: ExecutionContext,
) => Verification | Promise<Verification>;

export interface NavigationAdapter {
  mode: 'document' | 'spa';
  navigate: (url: URL, signal: AbortSignal) => void | Promise<void>;
}
