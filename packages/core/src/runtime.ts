import { PROTOCOL_VERSION, validateActionCall } from '@pagesquire/protocol';
import type {
  ActionCall,
  ActionResult,
  JsonObject,
  PageSnapshot,
  AppContextSnapshot,
} from '@pagesquire/protocol';
import { PageSquireError, NavigationStarted } from './errors.js';
import { canonicalJson, immutableCopy } from './json.js';
import { NavigationStore, documentNavigation } from './navigation.js';
import { PageObserver } from './observer.js';
import { CapabilityRegistry } from './registry.js';
import { ACTION_PROGRESS_CODES } from './types.js';
import type {
  ExecutionContext,
  NavigationAdapter,
  ActionProgressEvent,
  ActionProgressListener,
  ActionProgressCode,
} from './types.js';
import type { ActionPresentation } from './driving.js';
import type { AppContext } from './app-context.js';

export interface RuntimeOptions {
  observer: PageObserver;
  registry: CapabilityRegistry;
  navigation?: NavigationAdapter;
  navigationStore?: NavigationStore;
  timeoutMs?: number;
  maxActions?: number;
  onActivityChange?: (activity: 'thinking' | 'idle') => void;
  onActionProgress?: ActionProgressListener;
  presentation?: ActionPresentation;
  appContext?: AppContext;
}

interface CallRecord {
  signature: string;
  result: Promise<ActionResult>;
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

export class BrowserRuntime {
  readonly observer: PageObserver;
  readonly registry: CapabilityRegistry;
  private readonly options: RuntimeOptions;
  private readonly navigation: NavigationAdapter;
  private readonly navigationStore: NavigationStore | undefined;
  private readonly calls = new Map<string, CallRecord>();
  private active: AbortController | undefined;
  private activityValue: 'thinking' | 'idle' = 'idle';

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.observer = options.observer;
    this.registry = options.registry;
    if (
      options.appContext &&
      options.appContext.registry !== options.registry
    ) {
      throw new PageSquireError(
        'INVALID_OPTIONS',
        'App context must use the runtime registry.',
      );
    }
    this.navigation =
      options.navigation ?? documentNavigation(this.observer.document);
    if (options.navigationStore) {
      this.navigationStore = options.navigationStore;
    } else {
      try {
        this.navigationStore = new NavigationStore(
          this.observer.document.defaultView!.sessionStorage,
        );
      } catch {
        this.navigationStore = undefined;
      }
    }
    if (
      !Number.isInteger(options.timeoutMs ?? 5000) ||
      (options.timeoutMs ?? 5000) < 1 ||
      (options.timeoutMs ?? 5000) > 60000 ||
      !Number.isInteger(options.maxActions ?? 100) ||
      (options.maxActions ?? 100) < 1 ||
      (options.maxActions ?? 100) > 1000
    ) {
      throw new PageSquireError(
        'INVALID_OPTIONS',
        'Timeout and action limits must be bounded positive integers.',
      );
    }
  }

  get activity(): 'thinking' | 'idle' {
    return this.activityValue;
  }

  private setActivity(value: 'thinking' | 'idle'): void {
    this.activityValue = value;
    try {
      this.options.onActivityChange?.(value);
    } catch {
      /* UI hooks do not authorize or interrupt execution. */
    }
  }

  private emitProgress(
    event: ActionProgressEvent,
    listener?: ActionProgressListener,
  ): void {
    const safe = Object.freeze({ ...event });
    const hooks = new Set<ActionProgressListener | undefined>();
    try {
      hooks.add(this.options.onActionProgress);
    } catch {
      /* A diagnostic configuration accessor cannot fail an action either. */
    }
    hooks.add(listener);
    for (const hook of hooks) {
      try {
        const returned: unknown = hook?.(safe);
        if (
          returned &&
          typeof (returned as { then?: unknown }).then === 'function'
        )
          void Promise.resolve(returned).catch(() => {});
      } catch {
        /* Diagnostic hooks cannot authorize, fail or retry an action. */
      }
    }
  }

  private completeProgress(
    result: ActionResult,
    listener?: ActionProgressListener,
    replayed = false,
  ): ActionResult {
    this.emitProgress(
      {
        callId: result.callId,
        capabilityId: result.capabilityId,
        stage: replayed
          ? 'replayed'
          : result.status === 'unverified' &&
              result.code === 'NAVIGATION_PENDING'
            ? 'navigation_pending'
            : result.code === 'TIMEOUT'
              ? 'timed_out'
              : result.status === 'success'
                ? 'verified'
                : result.status === 'unverified'
                  ? 'unverified'
                  : result.status === 'cancelled'
                    ? 'cancelled'
                    : 'failed',
        code: ACTION_PROGRESS_CODES.includes(result.code as ActionProgressCode)
          ? (result.code as ActionProgressCode)
          : 'ACTION_FAILED',
      },
      listener,
    );
    return result;
  }

  observe(): PageSnapshot {
    if (this.active)
      throw new PageSquireError(
        'BUSY',
        'Do not replace the active action snapshot.',
      );
    return this.observer.observe();
  }

  readAppContext(): AppContextSnapshot | undefined {
    return this.options.appContext?.snapshot();
  }

  cancel(): void {
    this.active?.abort(
      new PageSquireError('CANCELLED', 'The action was cancelled.'),
    );
  }

  private result(
    call: Pick<ActionCall, 'callId' | 'capabilityId'>,
    status: ActionResult['status'],
    code: string,
    message: string,
    evidence: JsonObject = {},
    includeObservation = true,
  ): ActionResult {
    const result: ActionResult = {
      protocolVersion: PROTOCOL_VERSION,
      callId: call.callId,
      capabilityId: call.capabilityId,
      status,
      code,
      message,
      evidence,
    };
    if (includeObservation) {
      try {
        result.observation = this.observer.observe();
      } catch {
        /* A navigation may already have detached the document. */
      }
    }
    return immutableCopy(result);
  }

  async execute(
    input: unknown,
    options: {
      signal?: AbortSignal;
      onBeforeNavigate?: (call: ActionCall, destination: URL) => void;
      onActionProgress?: ActionProgressListener;
    } = {},
  ): Promise<ActionResult> {
    let safeInput: unknown;
    let signature: string;
    try {
      signature = canonicalJson(input);
      safeInput = JSON.parse(signature);
    } catch {
      return this.completeProgress(
        this.result(
          { callId: 'invalid', capabilityId: 'invalid.call' },
          'failed',
          'INVALID_CALL',
          'Expected a bounded JSON action call.',
          {},
          false,
        ),
        options.onActionProgress,
      );
    }
    const validation = validateActionCall(safeInput);
    if (!validation.valid) {
      return this.completeProgress(
        this.result(
          { callId: 'invalid', capabilityId: 'invalid.call' },
          'failed',
          'INVALID_CALL',
          'The action does not match the protocol schema.',
          {},
          false,
        ),
        options.onActionProgress,
      );
    }
    const call = immutableCopy(validation.value);
    const previous = this.calls.get(call.callId);
    if (previous) {
      return previous.signature === signature
        ? this.completeProgress(
            await previous.result,
            options.onActionProgress,
            true,
          )
        : this.completeProgress(
            this.result(
              call,
              'failed',
              'CALL_ID_REUSED',
              'A call ID cannot identify two different actions.',
              {},
              false,
            ),
            options.onActionProgress,
          );
    }
    if (this.active)
      return this.completeProgress(
        this.result(
          call,
          'failed',
          'BUSY',
          'Wait for the current action to finish.',
          {},
          false,
        ),
        options.onActionProgress,
      );
    if (this.calls.size >= Math.min(this.options.maxActions ?? 100, 1000)) {
      return this.completeProgress(
        this.result(
          call,
          'failed',
          'ACTION_LIMIT',
          'The browser session action limit was reached.',
          {},
          false,
        ),
        options.onActionProgress,
      );
    }
    const controller = new AbortController();
    this.active = controller;
    const result = this.perform(
      call,
      controller,
      options.signal,
      options.onBeforeNavigate,
      options.onActionProgress,
    ).then((outcome) =>
      this.completeProgress(outcome, options.onActionProgress),
    );
    this.calls.set(call.callId, { signature, result });
    return result;
  }

  private async perform(
    call: ActionCall,
    controller: AbortController,
    externalSignal?: AbortSignal,
    onBeforeNavigate?: (call: ActionCall, destination: URL) => void,
    onActionProgress?: ActionProgressListener,
  ): Promise<ActionResult> {
    const signal = controller.signal;
    const abort = () =>
      controller.abort(
        new PageSquireError('CANCELLED', 'The action was cancelled.'),
      );
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) abort();
    const timer = setTimeout(
      () =>
        controller.abort(
          new PageSquireError('TIMEOUT', 'The action exceeded its time limit.'),
        ),
      Math.min(this.options.timeoutMs ?? 5000, 60000),
    );
    this.setActivity('thinking');
    try {
      this.emitProgress(
        {
          callId: call.callId,
          capabilityId: call.capabilityId,
          stage: 'checking',
        },
        onActionProgress,
      );
      signal.throwIfAborted();
      this.observer.requireSnapshot(call.snapshotId);
      const entry = this.registry.resolve(call.capabilityId, call.parameters);
      if (entry.definition.risk === 'consequential') {
        throw new PageSquireError(
          'CONFIRMATION_REQUIRED',
          'Consequential actions are not enabled in the foundation runtime.',
        );
      }
      const context = this.context(call, signal, onBeforeNavigate);
      await withAbort(
        Promise.resolve().then(() => {
          signal.throwIfAborted();
          this.options.appContext?.assertAvailable(call.capabilityId);
          signal.throwIfAborted();
          this.emitProgress(
            {
              callId: call.callId,
              capabilityId: call.capabilityId,
              stage: 'executing',
            },
            onActionProgress,
          );
          signal.throwIfAborted();
          return entry.execute(call.parameters, context);
        }),
        signal,
      );
      signal.throwIfAborted();
      const verification = await withAbort(
        Promise.resolve().then(() => {
          signal.throwIfAborted();
          this.emitProgress(
            {
              callId: call.callId,
              capabilityId: call.capabilityId,
              stage: 'verifying',
            },
            onActionProgress,
          );
          signal.throwIfAborted();
          return entry.verify(call.parameters, context);
        }),
        signal,
      );
      signal.throwIfAborted();
      if (
        !verification ||
        typeof verification.verified !== 'boolean' ||
        (verification.evidence !== undefined &&
          (!verification.evidence ||
            typeof verification.evidence !== 'object' ||
            Array.isArray(verification.evidence)))
      ) {
        throw new PageSquireError(
          'INVALID_VERIFICATION',
          'The adapter returned an invalid verification result.',
        );
      }
      const evidence = JSON.parse(
        canonicalJson(verification.evidence ?? {}),
      ) as JsonObject;
      return this.result(
        call,
        verification.verified ? 'success' : 'unverified',
        verification.verified ? 'VERIFIED' : 'POSTCONDITION_FAILED',
        verification.verified
          ? 'The requested state was verified.'
          : 'The requested state could not be verified.',
        evidence,
      );
    } catch (error: unknown) {
      if (error instanceof NavigationStarted) {
        return this.result(
          call,
          'unverified',
          'NAVIGATION_PENDING',
          error.message,
          { expectedUrl: error.url },
        );
      }
      const reason = signal.aborted ? signal.reason : error;
      if (reason instanceof PageSquireError) {
        return this.result(
          call,
          reason.code === 'CANCELLED' ? 'cancelled' : 'failed',
          reason.code,
          reason.message,
        );
      }
      return this.result(
        call,
        'failed',
        'HANDLER_FAILED',
        'The registered action or verifier failed.',
      );
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abort);
      this.active = undefined;
      this.setActivity('idle');
      try {
        this.options.presentation?.clear();
      } catch {
        /* Presentation cleanup never changes a verified outcome. */
      }
    }
  }

  private context(
    call: ActionCall,
    signal: AbortSignal,
    onBeforeNavigate?: (call: ActionCall, destination: URL) => void,
  ): ExecutionContext {
    return {
      document: this.observer.document,
      present: async (target, kind) => {
        signal.throwIfAborted();
        if (
          target.ownerDocument !== this.observer.document ||
          !target.isConnected ||
          this.observer.isExcluded(target) ||
          !this.observer.isVisible(target)
        ) {
          throw new PageSquireError(
            'TARGET_MISSING',
            'The presentation target must be visible and public.',
          );
        }
        await withAbort(
          Promise.resolve().then(() => {
            signal.throwIfAborted();
            return this.options.presentation?.present(target, signal, kind);
          }),
          signal,
        );
        signal.throwIfAborted();
      },
      observer: this.observer,
      call,
      signal,
      navigate: async (value) => {
        signal.throwIfAborted();
        const destination = this.observer.allowedUrl(value);
        if (this.navigation.mode === 'document') {
          const definition = this.registry.resolve(
            call.capabilityId,
            call.parameters,
          ).definition;
          if (
            definition.id !== 'browser.navigate' ||
            definition.handler !== 'browser.navigate' ||
            definition.verification.handler !== 'browser.verifyNavigation' ||
            !this.navigationStore ||
            canonicalJson(call.parameters) !== canonicalJson({ url: value })
          ) {
            throw new PageSquireError(
              'NAVIGATION_UNAVAILABLE',
              'Document navigation requires the standard navigation capability and session storage.',
            );
          }
          this.navigationStore.save(call, destination);
          try {
            onBeforeNavigate?.(call, destination);
            signal.throwIfAborted();
            await this.navigation.navigate(destination, signal);
          } catch (error) {
            this.navigationStore.clear();
            throw error;
          }
          throw new NavigationStarted(destination.href);
        }
        await this.navigation.navigate(destination, signal);
        signal.throwIfAborted();
      },
      waitFor: async (predicate) => {
        while (true) {
          signal.throwIfAborted();
          if (await predicate()) return;
          await withAbort(
            new Promise<void>((resolve) => setTimeout(resolve, 16)),
            signal,
          );
        }
      },
    };
  }

  async resumeNavigation(
    options: { onActionProgress?: ActionProgressListener } = {},
  ): Promise<ActionResult | undefined> {
    if (!this.navigationStore || this.active) return undefined;
    const checkpoint = this.navigationStore.take(
      new URL(this.observer.document.URL).origin,
    );
    if (!checkpoint) return undefined;
    const snapshot = this.observe();
    const call: ActionCall = {
      protocolVersion: PROTOCOL_VERSION,
      callId: checkpoint.callId,
      capabilityId: 'browser.navigate',
      snapshotId: snapshot.id,
      parameters: { url: checkpoint.expectedUrl },
    };
    let result: ActionResult;
    try {
      const entry = this.registry.resolve(call.capabilityId, call.parameters);
      const expected = this.observer.allowedUrl(checkpoint.expectedUrl);
      if (
        entry.definition.handler !== 'browser.navigate' ||
        entry.definition.verification.handler !== 'browser.verifyNavigation' ||
        entry.definition.risk === 'consequential' ||
        expected.href !== this.observer.document.URL
      ) {
        throw new PageSquireError(
          'NAVIGATION_MISMATCH',
          'The destination does not match the pending navigation.',
        );
      }
      const controller = new AbortController();
      const timer = setTimeout(
        () =>
          controller.abort(
            new PageSquireError(
              'TIMEOUT',
              'Navigation verification timed out.',
            ),
          ),
        Math.min(this.options.timeoutMs ?? 5000, 60000),
      );
      this.active = controller;
      this.setActivity('thinking');
      try {
        this.emitProgress(
          {
            callId: call.callId,
            capabilityId: call.capabilityId,
            stage: 'checking',
          },
          options.onActionProgress,
        );
        controller.signal.throwIfAborted();
        const verification = await withAbort(
          Promise.resolve().then(() => {
            controller.signal.throwIfAborted();
            this.emitProgress(
              {
                callId: call.callId,
                capabilityId: call.capabilityId,
                stage: 'verifying',
              },
              options.onActionProgress,
            );
            controller.signal.throwIfAborted();
            return entry.verify(
              call.parameters,
              this.context(call, controller.signal),
            );
          }),
          controller.signal,
        );
        controller.signal.throwIfAborted();
        if (
          !verification ||
          typeof verification.verified !== 'boolean' ||
          (verification.evidence !== undefined &&
            (!verification.evidence ||
              typeof verification.evidence !== 'object' ||
              Array.isArray(verification.evidence)))
        ) {
          throw new PageSquireError(
            'INVALID_VERIFICATION',
            'The adapter returned an invalid verification result.',
          );
        }
        result = this.result(
          call,
          verification.verified ? 'success' : 'unverified',
          verification.verified ? 'VERIFIED' : 'POSTCONDITION_FAILED',
          verification.verified
            ? 'The destination document was verified.'
            : 'The destination could not be verified.',
          verification.evidence ?? {},
        );
      } finally {
        clearTimeout(timer);
        this.active = undefined;
        this.setActivity('idle');
      }
    } catch (error: unknown) {
      result =
        error instanceof PageSquireError
          ? this.result(
              call,
              error.code === 'CANCELLED' ? 'cancelled' : 'failed',
              error.code,
              error.message,
            )
          : this.result(
              call,
              'failed',
              'HANDLER_FAILED',
              'The navigation verifier failed.',
            );
    }
    this.calls.set(call.callId, {
      signature: canonicalJson(call),
      result: Promise.resolve(result),
    });
    return this.completeProgress(result, options.onActionProgress);
  }
}
