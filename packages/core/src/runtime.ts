import {
  PROTOCOL_VERSION,
  validateActionCall,
  validateActionResult,
} from '@pagesquire/protocol';
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
  VisitorPrompt,
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
  /**
   * Enables consequential capabilities: each call waits for this host prompt
   * (for example `createApprovalPrompt` from the client package) and runs only
   * when it resolves to `true`. Without it, consequential calls stay blocked.
   */
  approve?: (request: ApprovalRequest) => boolean | Promise<boolean>;
  /** How long a person may take to answer the approval prompt. */
  approvalTimeoutMs?: number;
  /**
   * Shows ui.ask questions and ui.hand_off requests to the visitor (for
   * example `createVisitorPrompt` from the client package). Resolve with the
   * chosen option, with 'done' after a hand-off, or with null to decline.
   */
  visitor?: (request: VisitorRequest) => string | null | Promise<string | null>;
  /** How long the visitor may take, including signing in (default 5 minutes). */
  visitorTimeoutMs?: number;
}

/** A visitor prompt plus the signal that withdraws it. */
export type VisitorRequest = VisitorPrompt & { signal: AbortSignal };

/** What a person is asked to approve; parameters are a frozen copy. */
export interface ApprovalRequest {
  capabilityId: string;
  description: string;
  parameters: Readonly<JsonObject>;
  signal: AbortSignal;
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
  /** An aborted handler/verifier that has not settled yet; it may still mutate the page. */
  private draining: Promise<void> | undefined;
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
      !Number.isInteger(options.approvalTimeoutMs ?? 120000) ||
      (options.approvalTimeoutMs ?? 120000) < 1 ||
      (options.approvalTimeoutMs ?? 120000) > 600000 ||
      (options.approve !== undefined && typeof options.approve !== 'function')
    ) {
      throw new PageSquireError(
        'INVALID_OPTIONS',
        'Approval needs a prompt function and a bounded timeout.',
      );
    }
    if (
      !Number.isInteger(options.visitorTimeoutMs ?? 300000) ||
      (options.visitorTimeoutMs ?? 300000) < 1 ||
      (options.visitorTimeoutMs ?? 300000) > 900000 ||
      (options.visitor !== undefined && typeof options.visitor !== 'function')
    ) {
      throw new PageSquireError(
        'INVALID_OPTIONS',
        'The visitor prompt needs a function and a bounded timeout.',
      );
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

  /** True when consequential capabilities can run after a person approves them. */
  get approvalEnabled(): boolean {
    return typeof this.options.approve === 'function';
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

  /**
   * Starts a fresh action budget and replay cache, e.g. for a new conversation.
   * A still-draining earlier handler keeps blocking new actions until it settles.
   */
  resetSession(): void {
    if (this.active)
      throw new PageSquireError(
        'BUSY',
        'Wait for the current action to finish.',
      );
    this.calls.clear();
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
    if (this.active || this.draining)
      return this.completeProgress(
        this.result(
          call,
          'failed',
          'BUSY',
          this.active
            ? 'Wait for the current action to finish.'
            : 'The previous action is still finishing.',
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The action time limit covers execution and verification, not a person reading an approval prompt.
    const startTimer = () => {
      timer = setTimeout(
        () =>
          controller.abort(
            new PageSquireError(
              'TIMEOUT',
              'The action exceeded its time limit.',
            ),
          ),
        Math.min(this.options.timeoutMs ?? 5000, 60000),
      );
    };
    this.setActivity('thinking');
    let unsettled: Promise<unknown> | undefined;
    const track = <T>(work: Promise<T>): Promise<T> => {
      unsettled = work;
      const settle = () => {
        if (unsettled === work) unsettled = undefined;
      };
      work.then(settle, settle);
      return work;
    };
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
        await this.requestApproval(call, entry.definition.description, signal);
        signal.throwIfAborted();
        this.observer.requireSnapshot(call.snapshotId);
      }
      startTimer();
      signal.throwIfAborted();
      const context = this.context(
        call,
        signal,
        onBeforeNavigate,
        async (description) => {
          // A person reading the prompt does not consume the action time limit.
          clearTimeout(timer);
          try {
            await this.requestApproval(call, description, signal);
          } finally {
            startTimer();
          }
        },
        async (prompt) => {
          // Neither does the visitor answering a question or signing in.
          clearTimeout(timer);
          try {
            return await this.askVisitor(prompt, signal);
          } finally {
            startTimer();
          }
        },
      );
      await withAbort(
        track(
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
        ),
        signal,
      );
      signal.throwIfAborted();
      const verification = await withAbort(
        track(
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
        ),
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
      const result = this.result(
        call,
        verification.verified ? 'success' : 'unverified',
        verification.verified ? 'VERIFIED' : 'POSTCONDITION_FAILED',
        verification.verified
          ? 'The requested state was verified.'
          : 'The requested state could not be verified.',
        evidence,
      );
      const screenshot = verification.screenshot;
      // Only a well-formed image travels with a verified result.
      return verification.verified &&
        screenshot &&
        validateActionResult({ ...result, screenshot }).valid
        ? immutableCopy({ ...result, screenshot })
        : result;
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
          reason.code === 'CANCELLED' || reason.code === 'APPROVAL_DENIED'
            ? 'cancelled'
            : 'failed',
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
      if (unsettled) this.drain(unsettled);
      this.active = undefined;
      this.setActivity('idle');
      try {
        this.options.presentation?.clear();
      } catch {
        /* Presentation cleanup never changes a verified outcome. */
      }
    }
  }

  private async requestApproval(
    call: ActionCall,
    description: string,
    signal: AbortSignal,
  ): Promise<void> {
    const approve = this.options.approve;
    if (!approve)
      throw new PageSquireError(
        'CONFIRMATION_REQUIRED',
        'Consequential actions need a configured approval prompt.',
      );
    const prompt = new AbortController();
    const stop = () => prompt.abort(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    const limit = setTimeout(
      () =>
        prompt.abort(
          new PageSquireError(
            'APPROVAL_TIMEOUT',
            'Nobody approved the action in time.',
          ),
        ),
      this.options.approvalTimeoutMs ?? 120000,
    );
    try {
      const approved = await withAbort(
        Promise.resolve().then(() =>
          approve({
            capabilityId: call.capabilityId,
            description,
            parameters: immutableCopy(call.parameters),
            signal: prompt.signal,
          }),
        ),
        prompt.signal,
      );
      if (approved !== true)
        throw new PageSquireError(
          'APPROVAL_DENIED',
          'The person declined this action.',
        );
    } catch (error) {
      if (error instanceof PageSquireError) throw error;
      throw new PageSquireError(
        'APPROVAL_DENIED',
        'The action was not approved.',
      );
    } finally {
      clearTimeout(limit);
      signal.removeEventListener('abort', stop);
      prompt.abort();
    }
  }

  private async askVisitor(
    prompt: VisitorPrompt,
    signal: AbortSignal,
  ): Promise<string> {
    const visitor = this.options.visitor;
    if (!visitor)
      throw new PageSquireError(
        'VISITOR_UNAVAILABLE',
        'No visitor prompt is configured on this page.',
      );
    const asking = new AbortController();
    const stop = () => asking.abort(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    const limit = setTimeout(
      () =>
        asking.abort(
          new PageSquireError(
            'VISITOR_TIMEOUT',
            'The visitor did not answer in time.',
          ),
        ),
      this.options.visitorTimeoutMs ?? 300000,
    );
    try {
      const request: VisitorRequest =
        prompt.kind === 'choice'
          ? {
              kind: 'choice',
              question: prompt.question,
              options: Object.freeze([...prompt.options]),
              signal: asking.signal,
            }
          : prompt.kind === 'link'
            ? {
                kind: 'link',
                partner: Object.freeze({ ...prompt.partner }),
                goal: prompt.goal,
                fields: Object.freeze({ ...prompt.fields }),
                ...(prompt.alternatives?.length
                  ? {
                      alternatives: Object.freeze(
                        prompt.alternatives.map((entry) =>
                          Object.freeze({
                            partner: Object.freeze({ ...entry.partner }),
                            fields: Object.freeze({ ...entry.fields }),
                          }),
                        ),
                      ),
                    }
                  : {}),
                ...(prompt.back ? { back: true } : {}),
                signal: asking.signal,
              }
            : {
                kind: 'handoff',
                instruction: prompt.instruction,
                signal: asking.signal,
              };
      const answer = await withAbort(
        Promise.resolve().then(() => visitor(Object.freeze(request))),
        asking.signal,
      );
      // Only one of the offered options, 'done' after a hand-off, or
      // 'continue' ('continue:N' for an alternative) for a partner site counts.
      if (
        typeof answer !== 'string' ||
        (prompt.kind === 'choice'
          ? !prompt.options.includes(answer)
          : prompt.kind === 'link'
            ? answer !== 'continue' &&
              !Array.from(
                prompt.alternatives ?? [],
                (_entry, index) => `continue:${index + 1}`,
              ).includes(answer)
            : answer !== 'done')
      )
        throw new PageSquireError('VISITOR_DECLINED', 'The visitor declined.');
      return answer;
    } catch (error) {
      if (error instanceof PageSquireError) throw error;
      throw new PageSquireError(
        'VISITOR_DECLINED',
        'The visitor did not answer.',
      );
    } finally {
      clearTimeout(limit);
      signal.removeEventListener('abort', stop);
      asking.abort();
    }
  }

  /**
   * Abort cannot stop a handler that ignores its signal. Refuse new actions
   * until it settles, so its late mutation cannot be credited to another
   * verifier. A second timeout window bounds the wait.
   */
  private drain(work: Promise<unknown>): void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = setTimeout(
        resolve,
        Math.min(this.options.timeoutMs ?? 5000, 60000),
      );
    });
    const drained: Promise<void> = Promise.race([
      work.then(
        () => {},
        () => {},
      ),
      limit,
    ]).then(() => {
      clearTimeout(timer);
      if (this.draining === drained) this.draining = undefined;
    });
    this.draining = drained;
  }

  private context(
    call: ActionCall,
    signal: AbortSignal,
    onBeforeNavigate?: (call: ActionCall, destination: URL) => void,
    requestApproval?: (description: string) => Promise<void>,
    askVisitor?: (prompt: VisitorPrompt) => Promise<string>,
  ): ExecutionContext {
    return {
      ...(requestApproval ? { requestApproval } : {}),
      ...(askVisitor ? { askVisitor } : {}),
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
        // A fragment-only change never unloads the document, so it is verified
        // in place instead of waiting for a destination page that never loads.
        const sameDocument =
          destination.hash !== '' &&
          destination.href.split('#')[0] ===
            this.observer.document.URL.split('#')[0];
        if (this.navigation.mode === 'document' && !sameDocument) {
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
