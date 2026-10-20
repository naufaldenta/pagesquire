import {
  PageSquireError,
  canonicalJson,
  immutableCopy,
} from '@pagesquire/core';
import type { BrowserRuntime } from '@pagesquire/core';
import {
  PROTOCOL_VERSION,
  validateChatReply,
  validateChatRequest,
} from '@pagesquire/protocol';
import type { ActionResult, ChatRequest, Emotion } from '@pagesquire/protocol';
import type { ChatTransport } from './transport.js';
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
  messages: readonly ChatMessage[];
}
export interface ClientOptions {
  runtime: BrowserRuntime;
  transport: ChatTransport;
  maxRounds?: number;
  timeoutMs?: number;
  onEmotionChange?: (emotion: Emotion) => void;
  navigationStore?: ChatNavigationStore;
}

export class AssistantClient {
  private readonly listeners = new Set<(state: ChatState) => void>();
  private controller: AbortController | undefined;
  private conversationId: string | undefined;
  private value: ChatState = { busy: false, emotion: 'idle', messages: [] };
  constructor(private readonly options: ClientOptions) {
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
  private append(message: ChatMessage): void {
    this.update({ messages: [...this.value.messages.slice(-99), message] });
  }
  cancel(): void {
    this.controller?.abort(
      new PageSquireError('CANCELLED', 'The conversation was cancelled.'),
    );
  }
  reset(): void {
    if (this.controller)
      throw new PageSquireError(
        'BUSY',
        'Cancel the current conversation first.',
      );
    this.conversationId = undefined;
    this.options.navigationStore?.clear();
    this.update({ messages: [], emotion: 'idle' });
  }
  async send(message: string): Promise<void> {
    if (this.controller)
      throw new PageSquireError('BUSY', 'A conversation is already running.');
    if (!message.trim() || [...message].length > 4000)
      throw new PageSquireError(
        'INVALID_MESSAGE',
        'Enter a message of up to 4000 characters.',
      );
    await this.run(message);
  }
  async resumeNavigation(): Promise<void> {
    if (this.controller)
      throw new PageSquireError('BUSY', 'A conversation is already running.');
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
          new PageSquireError('TIMEOUT', 'The conversation timed out.'),
        ),
      this.options.timeoutMs ?? 60000,
    );
    if (message) this.append({ role: 'user', text: message });
    this.update({ busy: true, emotion: 'thinking' });
    let navigating = false;
    try {
      let result: ActionResult | undefined;
      if (resume) {
        const abort = () => this.options.runtime.cancel();
        controller.signal.addEventListener('abort', abort, { once: true });
        try {
          result = await abortable(
            this.options.runtime.resumeNavigation(),
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
            'The pending navigation could not be restored. Start a new conversation.',
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
        const request: ChatRequest = {
          protocolVersion: PROTOCOL_VERSION,
          requestId: crypto.randomUUID(),
          snapshot,
          capabilityIds: this.options.runtime.registry
            .list()
            .filter((capability) => capability.risk !== 'consequential')
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
        const raw: unknown = JSON.parse(
          canonicalJson(
            await abortable(
              this.options.transport(request, controller.signal),
              controller.signal,
            ),
            196608,
          ),
        );
        controller.signal.throwIfAborted();
        const validation = validateChatReply(raw);
        if (!validation.valid)
          throw new PageSquireError(
            'INVALID_RESPONSE',
            'The assistant response does not match the protocol.',
          );
        const reply = validation.value;
        if (this.conversationId && this.conversationId !== reply.conversationId)
          throw new PageSquireError(
            'CONVERSATION_MISMATCH',
            'The assistant conversation changed unexpectedly.',
          );
        this.conversationId = reply.conversationId;
        const response = reply.response;
        if (response.finished) {
          if (response.toolCalls.length)
            throw new PageSquireError(
              'INVALID_RESPONSE',
              'A finished response cannot execute actions.',
            );
          const verified = !result || result.status === 'success';
          const emotion = verified ? response.emotion : 'confused';
          this.append({
            role: 'assistant',
            text: verified
              ? response.text
              : 'I could not verify that the action completed.',
            emotion,
          });
          this.update({ emotion });
          return;
        }
        if (response.toolCalls.length !== 1)
          throw new PageSquireError(
            'INVALID_RESPONSE',
            'Request exactly one action per response.',
          );
        const call = response.toolCalls[0]!;
        if (call.snapshotId !== snapshot.id)
          throw new PageSquireError(
            'STALE_SNAPSHOT',
            'The assistant action uses an outdated snapshot.',
          );
        // Do not display provider claims or expressions before the action is verified.
        if (result && result.status !== 'success')
          throw new PageSquireError(
            'ACTION_NOT_VERIFIED',
            'I could not verify that the previous action completed. No further actions were run.',
          );
        result = await this.options.runtime.execute(call, {
          signal: controller.signal,
          ...(this.options.navigationStore
            ? {
                onBeforeNavigate: (_call, destination) => {
                  if (rounds - round - 1 < 1)
                    throw new PageSquireError(
                      'ROUND_LIMIT',
                      'The conversation limit was reached before navigation.',
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
        controller.signal.throwIfAborted();
        this.append({
          role: 'action',
          text: `${call.capabilityId}: ${result.status}`,
          status: result.status,
        });
        if (result.code === 'NAVIGATION_PENDING') {
          navigating = true;
          this.append({
            role: 'assistant',
            text: this.options.navigationStore
              ? 'Navigation started. The assistant will verify the destination.'
              : 'Navigation started. Reopen the assistant on the destination page.',
            emotion: 'idle',
          });
          this.conversationId = undefined;
          this.update({ emotion: 'idle' });
          return;
        }
      }
      throw new PageSquireError(
        'ROUND_LIMIT',
        'The conversation limit was reached. Start a new conversation.',
      );
    } catch (error: unknown) {
      const cancelled = controller.signal.aborted;
      const reason = cancelled ? (controller.signal.reason as unknown) : error;
      const text =
        reason instanceof PageSquireError
          ? reason.message
          : 'The assistant could not complete this request. Try again.';
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
      this.update({ busy: false });
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
