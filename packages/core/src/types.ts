import type { ActionCall, JsonObject, Screenshot } from '@pagesquire/protocol';
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
  'APPROVAL_DENIED',
  'APPROVAL_TIMEOUT',
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
  'TARGET_HIDDEN',
  'TARGET_DISABLED',
  'TARGET_UNSTABLE',
  'TARGET_COVERED',
  'LINK_NAVIGATION',
  'UNSUPPORTED_TARGET',
  'OPTION_MISSING',
  'VISITOR_DECLINED',
  'VISITOR_TIMEOUT',
  'VISITOR_UNAVAILABLE',
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

/** A question or a hand-off shown to the visitor while an action waits. */
export type VisitorPrompt =
  | { kind: 'choice'; question: string; options: readonly string[] }
  | { kind: 'handoff'; instruction: string }
  | {
      /** PageSquire Link: continue on a partner site; answered with 'continue'. */
      kind: 'link';
      partner: { origin: string; name: string };
      goal: string;
      fields: Readonly<Record<string, string | number | boolean>>;
    };

export interface ExecutionContext {
  document: Document;
  observer: PageObserver;
  call: ActionCall;
  signal: AbortSignal;
  navigate: (url: string) => Promise<void>;
  waitFor: (predicate: () => boolean | Promise<boolean>) => Promise<void>;
  present: (target: Element, kind?: PresentationKind) => Promise<void>;
  /**
   * Asks a person to approve a risky step found while handling the call.
   * Rejects with CONFIRMATION_REQUIRED when no prompt is configured and with
   * APPROVAL_DENIED/APPROVAL_TIMEOUT otherwise; the action timer pauses meanwhile.
   */
  requestApproval?: (description: string) => Promise<void>;
  /**
   * Asks the visitor to choose one option, or to finish a step themselves.
   * Resolves with the chosen option, or 'done' after a hand-off. Rejects with
   * VISITOR_UNAVAILABLE without a configured prompt and with VISITOR_DECLINED
   * or VISITOR_TIMEOUT otherwise; the action timer pauses meanwhile.
   */
  askVisitor?: (prompt: VisitorPrompt) => Promise<string>;
}

export type CapabilityHandler = (
  parameters: JsonObject,
  context: ExecutionContext,
) => void | Promise<void>;

export interface Verification {
  verified: boolean;
  evidence?: JsonObject;
  /** A redacted screenshot to return with the result (ui.screenshot). */
  screenshot?: Screenshot;
}

export type VerificationHandler = (
  parameters: JsonObject,
  context: ExecutionContext,
) => Verification | Promise<Verification>;

export interface NavigationAdapter {
  mode: 'document' | 'spa';
  navigate: (url: URL, signal: AbortSignal) => void | Promise<void>;
}
