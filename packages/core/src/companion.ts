import type {
  FrameSnapshot,
  Screenshot,
  TabSnapshot,
} from '@pagesquire/protocol';
import { PageSquireError } from './errors.js';
import type { FrameEffect, FrameTargetInfo, InputDriver } from './generic.js';
import type { ExecutionContext } from './types.js';

/** Page-to-extension message version; see docs/companion-extension.md. */
export const COMPANION_PROTOCOL = 1;

export interface CompanionOptions {
  /** The page window (default: the global window). */
  view?: Window;
  /**
   * Wait for the extension's handshake answer (default 400 ms). Once the
   * extension's relay confirms it is there, the wait extends to
   * `callTimeoutMs`, so a waking service worker is not mistaken for none.
   */
  helloTimeoutMs?: number;
  /** Longest wait for one delivered input (default 5000 ms). */
  callTimeoutMs?: number;
}

export interface CompanionDriver extends InputDriver {
  /** Whether the extension answered the handshake for this origin. */
  connected(): Promise<boolean>;
  /**
   * The granted cross-origin frames the extension last reported; pass it to
   * PageObserver as `remoteFrames`. Empty until connected().
   */
  frames(): readonly FrameSnapshot[];
  /**
   * The other tabs of this page's session the extension last reported; pass
   * it to PageObserver as `remoteTabs`. Empty until connected().
   */
  tabs(): readonly TabSnapshot[];
}

interface Reply {
  id: number;
  ok: boolean;
  code?: string;
  info?: FrameTargetInfo;
  effect?: FrameEffect;
  screenshot?: Screenshot;
}

/** Keys the extension delivers. Escape stays synthetic: it is the visitor's stop key. */
const KEYS = new Set([
  'Enter',
  'Tab',
  'Space',
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageDown',
  'PageUp',
  'Backspace',
]);

const ERRORS: Record<string, [string, string]> = {
  OBSCURED: ['TARGET_COVERED', 'Another element covers the target.'],
  NOT_VISIBLE: ['TARGET_HIDDEN', 'The target is not visible.'],
  TARGET_MISSING: ['TARGET_MISSING', 'The target is no longer on the page.'],
  TARGET_NOT_ALLOWED: [
    'TARGET_NOT_ALLOWED',
    'The companion extension reserves this element for the visitor.',
  ],
  STOPPED: ['VISITOR_DECLINED', 'The visitor stopped the companion extension.'],
  BAD_SIGNATURE: [
    'ACTION_FAILED',
    "The companion extension refused a call that the site's key did not sign.",
  ],
  EXPIRED: ['ACTION_FAILED', 'The signed call expired before it ran.'],
  REPLAYED: ['ACTION_FAILED', 'The signed call was already used.'],
  MISMATCH: [
    'ACTION_FAILED',
    'The requested input does not match the signed call.',
  ],
  TARGET_HIDDEN: ['TARGET_HIDDEN', 'The target is not visible.'],
  TARGET_DISABLED: ['TARGET_DISABLED', 'The target is disabled.'],
  UNSUPPORTED_TARGET: [
    'UNSUPPORTED_TARGET',
    'This target cannot take that input inside a frame or tab.',
  ],
  TAB_MISSING: ['TARGET_MISSING', 'That tab is not part of this session.'],
  SCREENSHOTS_OFF: [
    'ACTION_FAILED',
    'Screenshots are off: the site does not declare them or the visitor has not allowed them.',
  ],
};

/**
 * Trusted input through the PageSquire companion extension, when the visitor
 * installed it and allowed this site. The extension runs only calls the
 * site's server signed (EngineOptions.signing). Without the extension, for
 * unsigned calls, or for inputs it does not handle, every method resolves
 * false and the page's own synthetic events run, so the same page works
 * either way.
 */
export function createCompanionDriver(
  options: CompanionOptions = {},
): CompanionDriver {
  const view = options.view ?? globalThis.window;
  const helloTimeoutMs = options.helloTimeoutMs ?? 400;
  const callTimeoutMs = options.callTimeoutMs ?? 5000;
  if (
    !Number.isInteger(helloTimeoutMs) ||
    helloTimeoutMs < 1 ||
    helloTimeoutMs > 5000 ||
    !Number.isInteger(callTimeoutMs) ||
    callTimeoutMs < 100 ||
    callTimeoutMs > 60000
  )
    throw new PageSquireError(
      'INVALID_OPTIONS',
      'Companion timeouts must be bounded positive integers.',
    );
  const origin = view.location.origin === 'null' ? '*' : view.location.origin;
  const pending = new Map<number, (reply: Reply) => void>();
  let sequence = 0;
  let port: Promise<MessagePort | undefined> | undefined;
  let frames: readonly FrameSnapshot[] = [];
  let tabs: readonly TabSnapshot[] = [];

  // A content script injected after the page loaded announces itself, so a
  // site the visitor allows mid-visit does not need a reload.
  view.addEventListener('message', (event: MessageEvent) => {
    if (
      event.source === view &&
      event.data?.type === 'pagesquire:companion-ready'
    ) {
      port = undefined;
      frames = [];
      tabs = [];
      void connect();
    }
  });

  const connect = () =>
    (port ??= new Promise((resolve) => {
      const channel = new (
        view as Window & { MessageChannel: typeof MessageChannel }
      ).MessageChannel();
      const giveUp = () => {
        channel.port1.close();
        resolve(undefined);
      };
      let timer = view.setTimeout(giveUp, helloTimeoutMs);
      channel.port1.onmessage = (event: MessageEvent) => {
        view.clearTimeout(timer);
        if (event.data?.type === 'pagesquire:hello-wait') {
          timer = view.setTimeout(giveUp, callTimeoutMs);
          return;
        }
        if (
          event.data?.type !== 'pagesquire:hello-ack' ||
          event.data.version !== COMPANION_PROTOCOL
        ) {
          channel.port1.close();
          resolve(undefined);
          return;
        }
        channel.port1.onmessage = (message: MessageEvent) => {
          // The observer re-checks these before they enter a snapshot.
          if (
            message.data?.type === 'pagesquire:frames' &&
            Array.isArray(message.data.frames)
          ) {
            frames = message.data.frames.slice(0, 5);
            return;
          }
          if (
            message.data?.type === 'pagesquire:tabs' &&
            Array.isArray(message.data.tabs)
          ) {
            tabs = message.data.tabs.slice(0, 4);
            return;
          }
          const reply = message.data as Reply;
          if (typeof reply?.id === 'number') pending.get(reply.id)?.(reply);
        };
        resolve(channel.port1);
      };
      view.postMessage(
        { type: 'pagesquire:hello', version: COMPANION_PROTOCOL },
        origin,
        [channel.port2],
      );
    }));

  const deliver = async (
    target: Element,
    args: Record<string, string>,
    context: ExecutionContext,
  ): Promise<boolean> => {
    const signature = context.call.signature;
    if (!signature) return false;
    // The extension resolves targets from the top document; shadow roots
    // and frames keep the synthetic path for now.
    if (
      target.ownerDocument !== view.document ||
      target.getRootNode() !== view.document
    )
      return false;
    const channel = await connect();
    if (!channel) return false;
    context.signal.throwIfAborted();
    const bytes = view.crypto.getRandomValues(new Uint8Array(16));
    const nonce = [...bytes]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    target.setAttribute('data-pagesquire-target', nonce);
    try {
      const reply = await request(
        channel,
        'act',
        { ...args, nonce, signature },
        context,
      );
      if (reply.ok) return true;
      // Stopped earlier, revoked or out of scope: the page continues alone.
      if (reply.code === 'UNAVAILABLE') return false;
      throw refusal(reply);
    } finally {
      target.removeAttribute('data-pagesquire-target');
    }
  };

  /** One message to the extension and its answer, bounded and abortable. */
  const request = async (
    channel: MessagePort,
    op: string,
    args: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<Reply> => {
    const id = ++sequence;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      return await new Promise<Reply>((resolve, reject) => {
        timer = view.setTimeout(
          () =>
            reject(
              new PageSquireError(
                'ACTION_FAILED',
                'The companion extension did not answer.',
              ),
            ),
          callTimeoutMs,
        );
        abort = () => reject(context.signal.reason);
        context.signal.addEventListener('abort', abort, { once: true });
        pending.set(id, resolve);
        channel.postMessage({ id, op, args });
      });
    } finally {
      view.clearTimeout(timer);
      if (abort) context.signal.removeEventListener('abort', abort);
      pending.delete(id);
    }
  };

  const refusal = (reply: Reply) => {
    const [code, message] = ERRORS[reply.code ?? ''] ?? [
      'ACTION_FAILED',
      `The companion extension could not deliver the input (${String(reply.code ?? 'no answer').slice(0, 40)}).`,
    ];
    return new PageSquireError(code, message);
  };

  /** Frames and tabs have no synthetic fallback: the page cannot reach them. */
  const frameChannel = async (context: ExecutionContext) => {
    const channel = await connect();
    if (!channel)
      throw new PageSquireError(
        'TARGET_MISSING',
        'Frame and tab targets need the companion extension.',
      );
    context.signal.throwIfAborted();
    return channel;
  };

  return {
    connected: async () => Boolean(await connect()),
    frames: () => frames,
    tabs: () => tabs,
    async screenshot(tab, context) {
      const signature = context.call.signature;
      if (!signature)
        throw new PageSquireError(
          'ACTION_FAILED',
          "Screenshots need a call signed by the site's server.",
        );
      const reply = await request(
        await frameChannel(context),
        'act',
        { kind: 'screenshot', tab, signature },
        context,
      );
      if (!reply.ok || !reply.screenshot) throw refusal(reply);
      return reply.screenshot;
    },
    async switchTab(tab, context) {
      const signature = context.call.signature;
      if (!signature)
        throw new PageSquireError(
          'ACTION_FAILED',
          "Switching tabs needs a call signed by the site's server.",
        );
      const reply = await request(
        await frameChannel(context),
        'act',
        { kind: 'switch', tab, signature },
        context,
      );
      if (!reply.ok) throw refusal(reply);
      return true;
    },
    async frameTarget(frame, target, action, context) {
      const reply = await request(
        await frameChannel(context),
        'frame-inspect',
        { frame, target, action },
        context,
      );
      if (!reply.ok || !reply.info) throw refusal(reply);
      return reply.info;
    },
    async frameAct(frameRequest, context) {
      const signature = context.call.signature;
      if (!signature)
        throw new PageSquireError(
          'ACTION_FAILED',
          "Actions inside frames need a call signed by the site's server.",
        );
      const { action, ...rest } = frameRequest;
      const kind =
        action === 'type' ? 'type' : action === 'press_key' ? 'key' : 'click';
      const reply = await request(
        await frameChannel(context),
        'act',
        { ...rest, kind, signature },
        context,
      );
      if (!reply.ok || !reply.effect) throw refusal(reply);
      return reply.effect;
    },
    click: (target, context) => deliver(target, { kind: 'click' }, context),
    async type(target, text, clear, context) {
      // Inserted text replaces the selection; types without a selection API
      // (email, number) cannot place it, so they keep the synthetic path.
      if (!text || target.selectionStart === null || !context.call.signature)
        return false;
      target.focus({ preventScroll: true });
      if (clear) target.select();
      else target.setSelectionRange(target.value.length, target.value.length);
      return deliver(target, { kind: 'type', text }, context);
    },
    pressKey: (target, key, context) =>
      KEYS.has(key)
        ? deliver(target, { kind: 'key', key }, context)
        : Promise.resolve(false),
  };
}
