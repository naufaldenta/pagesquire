import {
  PageSquireError,
  canonicalJson,
  immutableCopy,
  ACTION_PROGRESS_STAGES,
  ACTION_PROGRESS_CODES,
} from '@pagesquire/core';
import type {
  BrowserRuntime,
  ActionProgressEvent,
  ActionProgressStage,
  ActionProgressListener,
} from '@pagesquire/core';
import {
  PROTOCOL_VERSION,
  validateChatReply,
  validateChatRequest,
} from '@pagesquire/protocol';
import type {
  ActionResult,
  ChatRequest,
  Emotion,
  ServerProgressStage,
} from '@pagesquire/protocol';
import type { ChatTransport } from './transport.js';
import type { TraceEvent } from './trace.js';
import { resolveMessages } from './i18n.js';
import type { LocaleOptions, Messages } from './i18n.js';
import type {
  ChatNavigationStore,
  ChatNavigationCheckpoint,
} from './navigation.js';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'action';
  text: string;
  emotion?: Emotion;
  status?: ActionResult['status'];
}
export interface ChatState {
  busy: boolean;
  emotion: Emotion;
  /** The server's fixed stage while a streamed request runs; never model text. */
  serverStage?: ServerProgressStage | undefined;
  messages: readonly ChatMessage[];
  actionProgress: readonly ActionTimelineEntry[];
}
export interface ActionTimelineEntry extends ActionProgressEvent {
  /** Local attempt identity; a cached call can be observed without re-execution. */
  id: string;
  stages: readonly ActionProgressStage[];
}
export interface ClientOptions extends LocaleOptions {
  runtime: BrowserRuntime;
  transport: ChatTransport;
  maxRounds?: number;
  timeoutMs?: number;
  /**
   * Continue when the server proposes another action after a failed or
   * unverified one. Enable together with the engine's maxRecoveries.
   */
  allowRecovery?: boolean;
  onEmotionChange?: (emotion: Emotion) => void;
  navigationStore?: ChatNavigationStore;
  /**
   * Local debugging hook, e.g. `new TraceRecorder().record`. Events may hold
   * the visitor's message, model text and evidence; never upload them.
   */
  onTrace?: (event: TraceEvent) => void;
}

export class AssistantClient {
  private readonly listeners = new Set<(state: ChatState) => void>();
  private controller: AbortController | undefined;
  private conversationId: string | undefined;
  private readonly t: Messages;
  private value: ChatState = {
    busy: false,
    emotion: 'idle',
    messages: [],
    actionProgress: [],
  };
  constructor(private readonly options: ClientOptions) {
    this.t = resolveMessages(
      options,
      options.runtime.observer?.document as Document | undefined,
    );
    for (const [value, maximum] of [
      [options.maxRounds ?? 12, 40],
      [options.timeoutMs ?? 60000, 120000],
    ] as const) {
      if (!Number.isInteger(value) || value < 1 || value > maximum)
        throw new PageSquireError(
          'INVALID_OPTIONS',
          'Conversation limits must be bounded positive integers.',
        );
    }
  }
  get state(): ChatState {
    return immutableCopy(this.value);
  }
  subscribe(listener: (state: ChatState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private update(changes: Partial<ChatState>): void {
    const previous = this.value.emotion;
    this.value = { ...this.value, ...changes };
    // State is canonical JSON: a cleared stage is removed, not undefined.
    if (this.value.serverStage === undefined) delete this.value.serverStage;
    if (previous !== this.value.emotion) {
      try {
        this.options.onEmotionChange?.(this.value.emotion);
      } catch {
        /* Presentation hooks cannot interrupt execution. */
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        /* Isolate presentation listeners. */
      }
    }
  }
  private trace(event: TraceEvent): void {
    try {
      this.options.onTrace?.(structuredClone(event));
    } catch {
      /* Tracing never changes a conversation. */
    }
  }
  private append(message: ChatMessage): void {
    this.update({ messages: [...this.value.messages.slice(-99), message] });
  }
  private trackProgress(
    controller: AbortController,
    callId: string,
    capabilityId: string,
  ): {
    listener: ActionProgressListener;
    interrupt: (stage: 'cancelled' | 'timed_out') => void;
  } {
    let id: string | undefined;
    let closed = false;
    const listener: ActionProgressListener = (event) => {
      if (
        closed ||
        this.controller !== controller ||
        event.callId !== callId ||
        event.capabilityId !== capabilityId ||
        !ACTION_PROGRESS_STAGES.includes(event.stage)
      )
        return;
      const stage =
        event.stage === 'cancelled' &&
        controller.signal.reason instanceof PageSquireError &&
        controller.signal.reason.code === 'TIMEOUT'
          ? 'timed_out'
          : event.stage;
      const previous = id
        ? this.value.actionProgress.find((entry) => entry.id === id)
        : undefined;
      const allowed: Partial<
        Record<ActionProgressStage, readonly ActionProgressStage[]>
      > = {
        checking: [
          'executing',
          'verifying',
          'failed',
          'cancelled',
          'timed_out',
        ],
        executing: [
          'verifying',
          'navigation_pending',
          'failed',
          'cancelled',
          'timed_out',
        ],
        verifying: [
          'verified',
          'unverified',
          'failed',
          'cancelled',
          'timed_out',
        ],
      };
      if (previous && !allowed[previous.stage]?.includes(stage)) return;
      if (
        !previous &&
        !['checking', 'failed', 'cancelled', 'timed_out', 'replayed'].includes(
          stage,
        )
      )
        return;
      id ??= crypto.randomUUID();
      closed = !['checking', 'executing', 'verifying'].includes(stage);
      const entry: ActionTimelineEntry = {
        id,
        callId,
        capabilityId,
        stage,
        stages: [...(previous?.stages ?? []), stage].slice(-8),
        ...(stage === 'timed_out'
          ? { code: 'TIMEOUT' as const }
          : event.code !== undefined
            ? {
                code: ACTION_PROGRESS_CODES.includes(event.code)
                  ? event.code
                  : ('ACTION_FAILED' as const),
              }
            : {}),
      };
      this.update({
        actionProgress: [
          ...this.value.actionProgress
            .filter((item) => item.id !== id)
            .slice(-19),
          entry,
        ],
      });
    };
    return {
      listener,
      interrupt: (stage) => {
        if (id)
          listener({
            callId,
            capabilityId,
            stage,
            code: stage === 'timed_out' ? 'TIMEOUT' : 'CANCELLED',
          });
      },
    };
  }
  cancel(): void {
    this.controller?.abort(
      new PageSquireError('CANCELLED', this.t['client.cancelled']),
    );
  }
  reset(): void {
    if (this.controller)
      throw new PageSquireError('BUSY', this.t['client.cancelFirst']);
    this.options.runtime.resetSession();
    this.conversationId = undefined;
    this.options.navigationStore?.clear();
    this.update({ messages: [], emotion: 'idle', actionProgress: [] });
  }
  async send(message: string): Promise<void> {
    if (this.controller)
      throw new PageSquireError('BUSY', this.t['client.busy']);
    if (!message.trim() || [...message].length > 4000)
      throw new PageSquireError(
        'INVALID_MESSAGE',
        this.t['client.invalidMessage'],
      );
    await this.run(message);
  }
  async resumeNavigation(): Promise<void> {
    if (this.controller)
      throw new PageSquireError('BUSY', this.t['client.busy']);
    const checkpoint = this.options.navigationStore?.take(
      new URL(this.options.runtime.observer.document.URL).origin,
    );
    if (checkpoint) await this.run(undefined, checkpoint);
  }
  private async run(
    message?: string,
    resume?: ChatNavigationCheckpoint,
  ): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(
      () =>
        controller.abort(
          new PageSquireError('TIMEOUT', this.t['client.timedOut']),
        ),
      this.options.timeoutMs ?? 60000,
    );
    if (message) {
      this.append({ role: 'user', text: message });
      this.trace({ type: 'message', at: Date.now(), text: message });
    }
    this.update({ busy: true, emotion: 'thinking' });
    let navigating = false;
    let progress: ReturnType<AssistantClient['trackProgress']> | undefined;
    try {
      let result: ActionResult | undefined;
      if (resume) {
        progress = this.trackProgress(
          controller,
          resume.callId,
          'browser.navigate',
        );
        const abort = () => this.options.runtime.cancel();
        controller.signal.addEventListener('abort', abort, { once: true });
        try {
          result = await abortable(
            this.options.runtime.resumeNavigation({
              onActionProgress: progress.listener,
            }),
            controller.signal,
          );
        } finally {
          controller.signal.removeEventListener('abort', abort);
        }
        if (
          !result ||
          result.callId !== resume.callId ||
          result.capabilityId !== 'browser.navigate' ||
          this.options.runtime.observer.document.URL !== resume.expectedUrl
        )
          throw new PageSquireError(
            'NAVIGATION_MISMATCH',
            this.t['client.navigationLost'],
          );
        this.conversationId = resume.conversationId;
        this.append({
          role: 'action',
          text: `browser.navigate: ${result.status}`,
          status: result.status,
        });
      }
      const rounds = Math.min(
        this.options.maxRounds ?? 12,
        resume?.remainingRounds ?? 40,
      );
      for (let round = 0; round < rounds; round++) {
        controller.signal.throwIfAborted();
        const snapshot = result?.observation ?? this.options.runtime.observe();
        const appContext = this.options.runtime.readAppContext?.();
        controller.signal.throwIfAborted();
        const request: ChatRequest = {
          protocolVersion: PROTOCOL_VERSION,
          requestId: crypto.randomUUID(),
          snapshot,
          ...(appContext ? { appContext } : {}),
          capabilityIds: this.options.runtime.registry
            .list()
            .filter(
              (capability) =>
                capability.risk !== 'consequential' ||
                this.options.runtime.approvalEnabled === true,
            )
            .map((capability) => capability.id),
          ...(this.conversationId
            ? { conversationId: this.conversationId }
            : {}),
          ...(result ? { result } : { message: message! }),
        };
        if (!validateChatRequest(request).valid)
          throw new PageSquireError(
            'INVALID_REQUEST',
            'The conversation request is invalid.',
          );
        const sent = Date.now();
        this.trace({
          type: 'request',
          at: sent,
          requestId: request.requestId,
          snapshot: {
            id: snapshot.id,
            url: snapshot.url,
            targets: snapshot.targets.length,
            newTargets: snapshot.targets.filter((target) => target.new).length,
            removedTargets: snapshot.removedTargets?.length ?? 0,
            truncated: snapshot.truncated.text || snapshot.truncated.targets,
          },
          capabilities: request.capabilityIds.length,
          ...(result
            ? {
                result: {
                  callId: result.callId,
                  status: result.status,
                  code: result.code,
                },
              }
            : {}),
        });
        const raw: unknown = JSON.parse(
          canonicalJson(
            await abortable(
              this.options.transport(request, controller.signal, (stage) => {
                if (this.controller !== controller) return;
                this.update({ serverStage: stage });
                this.trace({ type: 'server', at: Date.now(), stage });
              }),
              controller.signal,
            ),
            196608,
          ),
        );
        controller.signal.throwIfAborted();
        if (this.value.serverStage) this.update({ serverStage: undefined });
        const validation = validateChatReply(raw);
        if (!validation.valid)
          throw new PageSquireError(
            'INVALID_RESPONSE',
            this.t['client.invalidReply'],
          );
        const reply = validation.value;
        if (this.conversationId && this.conversationId !== reply.conversationId)
          throw new PageSquireError(
            'CONVERSATION_MISMATCH',
            this.t['client.conversationChanged'],
          );
        this.conversationId = reply.conversationId;
        const response = reply.response;
        const proposed = response.toolCalls[0];
        this.trace({
          type: 'reply',
          at: Date.now(),
          requestId: request.requestId,
          durationMs: Date.now() - sent,
          finished: response.finished,
          emotion: response.emotion,
          text: response.text,
          ...(response.plan ? { plan: response.plan } : {}),
          ...(proposed
            ? {
                action: {
                  callId: proposed.callId,
                  capabilityId: proposed.capabilityId,
                  parameters: proposed.parameters,
                },
              }
            : {}),
        });
        if (response.finished) {
          if (response.toolCalls.length)
            throw new PageSquireError(
              'INVALID_RESPONSE',
              'A finished response cannot execute actions.',
            );
          const verified =
            !result ||
            result.status === 'success' ||
            (this.options.allowRecovery === true &&
              result.status !== 'cancelled');
          const emotion = verified ? response.emotion : 'confused';
          this.append({
            role: 'assistant',
            text: verified ? response.text : this.t['client.couldNotVerify'],
            emotion,
          });
          this.update({ emotion });
          return;
        }
        if (response.toolCalls.length !== 1)
          throw new PageSquireError(
            'INVALID_RESPONSE',
            this.t['client.oneAction'],
          );
        const call = response.toolCalls[0]!;
        if (call.snapshotId !== snapshot.id)
          throw new PageSquireError(
            'STALE_SNAPSHOT',
            this.t['client.staleSnapshot'],
          );
        // A plan describes intended steps; it never claims progress.
        if (response.plan)
          this.append({
            role: 'assistant',
            text: `${this.t['client.plan']}\n${response.plan
              .map((step, index) => `${index + 1}. ${step}`)
              .join('\n')}`,
            emotion: 'thinking',
          });
        // Do not display provider claims or expressions before the action is verified.
        if (
          result &&
          result.status !== 'success' &&
          !(
            this.options.allowRecovery === true && result.status !== 'cancelled'
          )
        )
          throw new PageSquireError(
            'ACTION_NOT_VERIFIED',
            this.t['client.notVerified'],
          );
        progress = this.trackProgress(
          controller,
          call.callId,
          call.capabilityId,
        );
        const started = Date.now();
        const tracked = progress;
        result = await this.options.runtime.execute(call, {
          signal: controller.signal,
          onActionProgress: (event) => {
            tracked.listener(event);
            this.trace({ type: 'progress', at: Date.now(), ...event });
          },
          ...(this.options.navigationStore
            ? {
                onBeforeNavigate: (_call, destination) => {
                  if (rounds - round - 1 < 1)
                    throw new PageSquireError(
                      'ROUND_LIMIT',
                      this.t['client.roundLimitNavigation'],
                    );
                  this.options.navigationStore!.save({
                    conversationId: this.conversationId!,
                    callId: call.callId,
                    expectedUrl: destination.href,
                    origin: destination.origin,
                    issuedAt: Date.now(),
                    remainingRounds: rounds - round - 1,
                  });
                },
              }
            : {}),
        });
        this.trace({
          type: 'result',
          at: Date.now(),
          callId: result.callId,
          capabilityId: result.capabilityId,
          status: result.status,
          code: result.code,
          durationMs: Date.now() - started,
          evidence: result.evidence,
        });
        controller.signal.throwIfAborted();
        this.append({
          role: 'action',
          text: `${call.capabilityId}: ${result.status}`,
          status: result.status,
        });
        if (
          result.status === 'unverified' &&
          result.code === 'NAVIGATION_PENDING'
        ) {
          navigating = true;
          this.append({
            role: 'assistant',
            text: this.options.navigationStore
              ? this.t['client.navigationResume']
              : this.t['client.navigationReopen'],
            emotion: 'idle',
          });
          this.conversationId = undefined;
          this.update({ emotion: 'idle' });
          return;
        }
      }
      throw new PageSquireError('ROUND_LIMIT', this.t['client.roundLimit']);
    } catch (error: unknown) {
      const cancelled = controller.signal.aborted;
      const reason = cancelled ? (controller.signal.reason as unknown) : error;
      if (cancelled)
        progress?.interrupt(
          reason instanceof PageSquireError && reason.code === 'TIMEOUT'
            ? 'timed_out'
            : 'cancelled',
        );
      const text =
        reason instanceof PageSquireError
          ? reason.message
          : this.t['client.unexpected'];
      this.trace({
        type: 'error',
        at: Date.now(),
        code: reason instanceof PageSquireError ? reason.code : 'UNKNOWN',
        message: text,
      });
      this.append({
        role: 'assistant',
        text,
        emotion: cancelled ? 'idle' : 'confused',
      });
      const recoverable =
        !cancelled &&
        reason instanceof PageSquireError &&
        [
          'PROVIDER_UNAVAILABLE',
          'INVALID_PROVIDER_RESPONSE',
          'INVALID_PARAMETERS',
        ].includes(reason.code);
      if (!recoverable) this.conversationId = undefined;
      this.update({ emotion: cancelled ? 'idle' : 'confused' });
    } finally {
      clearTimeout(timer);
      if (!navigating) this.options.navigationStore?.clear();
      this.controller = undefined;
      this.update({ busy: false, serverStage: undefined });
    }
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
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
