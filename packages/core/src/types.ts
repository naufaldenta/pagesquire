import type { ActionCall, JsonObject } from '@pagesquire/protocol';
import type { PageObserver } from './observer.js';
import type { PresentationKind } from './driving.js';

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
