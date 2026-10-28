import type {
  CapabilityDefinition,
  JsonObject,
  ObservedTarget,
  Screenshot,
} from '@pagesquire/protocol';
import { PageSquireError } from './errors.js';
import type {
  CapabilityHandler,
  ExecutionContext,
  VerificationHandler,
  VisitorPrompt,
} from './types.js';
import { composedClosest } from './observer.js';
import type { Interaction } from './observer.js';

export type GenericAction =
  'click' | 'type' | 'select' | 'check' | 'press_key' | 'hover';
/** allow runs immediately, approve asks a person first, deny refuses. */
export type GenericRisk = 'allow' | 'approve' | 'deny';

export interface GenericOptions {
  /** Replaces the built-in risk tiering for element actions. */
  risk?: (element: Element, action: GenericAction) => GenericRisk;
  /** DOM quiet period that counts as settled (default 300 ms). */
  quietMs?: number;
  /** Longest wait for the page to settle after an action (default 2000 ms). */
  settleMs?: number;
  /** Count in-flight fetch/XHR requests while settling (default true). */
  trackNetwork?: boolean;
  /**
   * Delivers clicks, text and keys instead of synthetic DOM events, for
   * example through the companion extension. Checks, approvals and settling
   * still run in the page.
   */
  driver?: InputDriver;
}

/**
 * Delivers one input to an element that already passed the page's checks.
 * Each method resolves true when it delivered the input, or false to let the
 * built-in synthetic events run instead; it throws to fail the action.
 */
export interface InputDriver {
  click?(target: Element, context: ExecutionContext): Promise<boolean>;
  type?(
    target: HTMLInputElement | HTMLTextAreaElement,
    text: string,
    clear: boolean,
    context: ExecutionContext,
  ): Promise<boolean>;
  pressKey?(
    target: Element,
    key: string,
    context: ExecutionContext,
  ): Promise<boolean>;
  /**
   * Describes a target inside a cross-origin frame (IDs such as
   * frame1-target-3), judged in that frame. Required for frame targets.
   */
  frameTarget?(
    frame: string,
    target: string,
    action: GenericAction,
    context: ExecutionContext,
  ): Promise<FrameTargetInfo>;
  /** Runs one action on a frame target and reports what changed there. */
  frameAct?(
    request: FrameActRequest,
    context: ExecutionContext,
  ): Promise<FrameEffect>;
  /**
   * Shows one tab of the session to the visitor: tab1 is this page, tab2 and
   * later are tabs listed in `snapshot.tabs`. Resolves whether it is active.
   */
  switchTab?(tab: string, context: ExecutionContext): Promise<boolean>;
  /**
   * A redacted screenshot of one tab of the session (tab1 is this page),
   * for ui.screenshot. Form fields, private regions and frames are blacked out.
   */
  screenshot?(tab: string, context: ExecutionContext): Promise<Screenshot>;
}

export interface FrameTargetInfo {
  /** The built-in risk tier, judged inside the frame; a host `risk` callback cannot see it. */
  risk: GenericRisk;
  /** The target's accessible name, for approval prompts. */
  label: string;
  /** The target is or sits inside a link. */
  link: boolean;
  /** Checkbox, radio or switch state, when it has one. */
  checked?: boolean | 'mixed';
}

export interface FrameActRequest {
  /** The remote document: a frame (frame1) or another tab (tab2). */
  frame: string;
  target: string;
  action: 'click' | 'check' | 'type' | 'press_key';
  text?: string;
  clear?: boolean;
  key?: string;
}

/** What the frame saw change; never field values. */
export interface FrameEffect {
  mutations: number;
  urlChanged: boolean;
  focusChanged: boolean;
  stateChanged: boolean;
  checked?: boolean | 'mixed';
  /** For typing: the field now holds the text (or ends with it). */
  typed?: boolean;
  length?: number;
}

/** Targets in granted frames (frame1-target-3) or other session tabs (tab2-target-3). */
const FRAME_TARGET =
  /^(frame[1-9][0-9]{0,2}|tab[2-9])-(target-[A-Za-z0-9_-]+)$/;

const KEYS = [
  'Enter',
  'Escape',
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
] as const;
/** Escape stays the visitor's stop key, so it is never sent into frames. */
const FRAME_KEYS = new Set<string>(KEYS.filter((key) => key !== 'Escape'));
const target = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9_-]+$',
};
const RISKY =
  /\b(delete|remove|destroy|erase|pay|purchase|buy|checkout|order|transfer|send|submit|confirm|publish|unsubscribe|sign out|log out|hapus|bayar|beli|pesan|kirim|konfirmasi|terbitkan|keluar)\b/i;

/**
 * Generic element tools, opt-in by the host. They act only on targets the
 * observer exposes and the host's canInteract policy permits; risky steps ask
 * a person through the runtime approval prompt.
 */
export function createGenericCapabilities(): CapabilityDefinition[] {
  const definition = (
    id: string,
    description: string,
    properties: JsonObject,
    risk: CapabilityDefinition['risk'] = 'reversible',
  ): CapabilityDefinition => ({
    id,
    description,
    execution: 'browser',
    handler: id,
    inputSchema: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
    risk,
    verification: { handler: `${id}.verify` },
  });
  return [
    definition(
      'ui.find',
      'Search all operable public elements by visible name (and optional role, or "" for any). Returns target ids usable by the other ui tools in the next step. Use it when the snapshot is truncated or the element is not listed.',
      {
        query: { type: 'string', maxLength: 200 },
        role: { type: 'string', maxLength: 40 },
      },
      'read_only',
    ),
    definition(
      'ui.click',
      'Click one target by id from the latest snapshot or ui.find. Use browser.navigate for links to other pages. Risky buttons such as submit, delete or pay ask the visitor first.',
      { target },
    ),
    definition(
      'ui.type',
      'Type text into one text field target. clear=true replaces the current value. Never type passwords, payment data or other secrets.',
      {
        target,
        text: { type: 'string', maxLength: 2000 },
        clear: { type: 'boolean' },
      },
    ),
    definition(
      'ui.select',
      'Choose an option of a native select target by its visible label or value. Open custom dropdowns with ui.click instead.',
      { target, option: { type: 'string', minLength: 1, maxLength: 200 } },
    ),
    definition(
      'ui.check',
      'Set a checkbox, radio, switch or toggle target to checked or unchecked.',
      { target, checked: { type: 'boolean' } },
    ),
    definition(
      'ui.press_key',
      'Press one key on a target, e.g. Enter to submit a search, Escape to close a dialog, arrows to move within a widget.',
      { target, key: { type: 'string', enum: [...KEYS] } },
    ),
    definition(
      'ui.hover',
      'Move the pointer over a target, e.g. to reveal a menu.',
      { target },
    ),
    definition(
      'ui.switch_tab',
      'Show the visitor another tab of this session: tab1 is the page with the chat, tab2 and later are listed in the snapshot "tabs". Targets in other tabs (tab2-target-3) work without switching. Switch back to tab1 before you finish.',
      { tab: { type: 'string', pattern: '^tab[1-9]$' } },
    ),
    definition(
      'ui.scroll',
      'Scroll the page up or down by about one screen, or to the top or bottom.',
      { direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] } },
      'read_only',
    ),
    definition(
      'ui.wait_for',
      'Wait until text becomes visible or hidden, e.g. a loading message or a result, within the action time limit.',
      {
        text: { type: 'string', minLength: 1, maxLength: 200 },
        state: { type: 'string', enum: ['visible', 'hidden'] },
      },
      'read_only',
    ),
    definition(
      'ui.ask',
      'Ask the visitor to choose one of 2 to 5 short options when the request is ambiguous or needs their decision. The result evidence holds the chosen option. Never ask for passwords, codes, payment or other personal data.',
      {
        question: { type: 'string', minLength: 1, maxLength: 300 },
        options: {
          type: 'array',
          minItems: 2,
          maxItems: 5,
          uniqueItems: true,
          items: { type: 'string', minLength: 1, maxLength: 80 },
        },
      },
      'read_only',
    ),
    definition(
      'ui.hand_off',
      'Hand a step to the visitor that only they may do, such as signing in, a CAPTCHA, a one-time code or a payment, and wait until they say they are done. Check the next snapshot before continuing.',
      { instruction: { type: 'string', minLength: 1, maxLength: 300 } },
      'read_only',
    ),
  ];
}

interface Effect {
  mutations: number;
  urlChanged: boolean;
  focusChanged: boolean;
  stateChanged: boolean;
  /** A native alert/confirm/prompt the page opened, and the visitor's answer. */
  dialog?: { type: string; message: string; answer: boolean | null };
}

/**
 * Wraps the page's native dialogs while an action runs. The visitor still
 * sees and answers the real dialog; the action only learns what was asked.
 */
function watchDialogs(view: Window): {
  seen: () => Effect['dialog'];
  restore: () => void;
} {
  let seen: Effect['dialog'];
  const originals = {
    alert: view.alert,
    confirm: view.confirm,
    prompt: view.prompt,
  };
  const record = (type: string, message: unknown, answer: boolean | null) => {
    seen ??= { type, message: String(message ?? '').slice(0, 300), answer };
  };
  const wrapped = {
    alert(this: Window, message?: unknown) {
      record('alert', message, null);
      return originals.alert.call(view, message);
    },
    confirm(this: Window, message?: string) {
      const answer = originals.confirm.call(view, message);
      record('confirm', message, answer);
      return answer;
    },
    prompt(this: Window, message?: string, value?: string) {
      const answer = originals.prompt.call(view, message, value);
      // The typed answer is the visitor's; only whether they answered is kept.
      record('prompt', message, answer !== null);
      return answer;
    },
  };
  Object.assign(view, wrapped);
  return {
    seen: () => seen,
    restore: () => {
      for (const name of ['alert', 'confirm', 'prompt'] as const)
        if (view[name] === wrapped[name])
          (view as unknown as Record<string, unknown>)[name] = originals[name];
    },
  };
}

/**
 * The opt-in screenshot tool. Not part of createGenericCapabilities: add it to
 * the manifest only when the server forwards images (EngineOptions.screenshots)
 * to a model that reads them, and the companion extension is in use.
 */
export function createScreenshotCapabilities(): CapabilityDefinition[] {
  return [
    {
      id: 'ui.screenshot',
      description:
        'Take a screenshot of one tab of this session (tab1 is the page with the chat) to check something visual the page text cannot confirm, such as a layout, a chart or a colour. Form fields, private regions and frames are blacked out. You see the image once, in the next step.',
      execution: 'browser',
      handler: 'ui.screenshot',
      inputSchema: {
        type: 'object',
        properties: { tab: { type: 'string', pattern: '^tab[1-9]$' } },
        required: ['tab'],
        additionalProperties: false,
      },
      risk: 'read_only',
      verification: { handler: 'ui.screenshot.verify' },
    },
  ];
}

export function createGenericBindings(options: GenericOptions = {}): {
  capabilities: CapabilityDefinition[];
  handlers: Record<string, CapabilityHandler>;
  verifiers: Record<string, VerificationHandler>;
} {
  const quietMs = options.quietMs ?? 300;
  const settleMs = options.settleMs ?? 2000;
  if (
    !Number.isInteger(quietMs) ||
    quietMs < 0 ||
    quietMs > 5000 ||
    !Number.isInteger(settleMs) ||
    settleMs < 0 ||
    settleMs > 10000
  )
    throw new PageSquireError(
      'INVALID_OPTIONS',
      'Settle timings must be bounded non-negative integers.',
    );
  const effects = new Map<string, Effect>();
  const switched = new Map<string, boolean>();
  const shots = new Map<string, Screenshot>();
  const found = new Map<string, ObservedTarget[]>();
  const answers = new Map<string, string>();
  const ask = async (context: ExecutionContext, prompt: VisitorPrompt) => {
    if (!context.askVisitor)
      throw new PageSquireError(
        'VISITOR_UNAVAILABLE',
        'No visitor prompt is configured on this page.',
      );
    answers.set(context.call.callId, await context.askVisitor(prompt));
  };

  const element = (
    parameters: JsonObject,
    context: ExecutionContext,
    interaction: Interaction,
  ) =>
    context.observer.resolveTarget(
      context.call.snapshotId,
      String(parameters.target),
      interaction,
    );

  /**
   * The element to verify. Many UIs re-render a list or form after a change,
   * replacing the element that was acted on; then the unique element with
   * the same role and name is checked instead of failing a successful action.
   */
  const verifiable = (
    parameters: JsonObject,
    context: ExecutionContext,
    interaction: Interaction,
  ): Element => {
    try {
      return element(parameters, context, interaction);
    } catch (error) {
      const snapshot = context.observer.requireSnapshot(
        context.call.snapshotId,
      );
      const before = snapshot.targets.find(
        (target) => target.id === String(parameters.target),
      );
      if (!before?.name) throw error;
      const matches = context.observer
        .find(context.call.snapshotId, before.name, { role: before.role })
        .filter((target) => target.name === before.name);
      if (matches.length !== 1) throw error;
      return context.observer.resolveTarget(
        context.call.snapshotId,
        matches[0]!.id,
        interaction,
      );
    }
  };

  const guard = async (
    target: Element,
    action: GenericAction,
    context: ExecutionContext,
  ) => {
    let risk: GenericRisk;
    try {
      risk = (options.risk ?? defaultRisk)(target, action);
    } catch {
      risk = 'deny';
    }
    await allow(
      risk,
      action,
      accessibleText(target) || target.tagName.toLowerCase(),
      context,
    );
  };

  /** Applies a risk tier: deny refuses, approve asks the visitor first. */
  const allow = async (
    risk: GenericRisk,
    action: GenericAction,
    label: string,
    context: ExecutionContext,
  ) => {
    if (risk === 'deny')
      throw new PageSquireError(
        'TARGET_NOT_ALLOWED',
        'This element is reserved for the visitor.',
      );
    if (risk === 'approve') {
      if (!context.requestApproval)
        throw new PageSquireError(
          'CONFIRMATION_REQUIRED',
          'This step needs the visitor to approve it.',
        );
      await context.requestApproval(`${actionLabel(action)} "${label}"`);
    }
  };

  const frameResults = new Map<string, FrameEffect>();
  /**
   * Runs the action inside a granted cross-origin frame through the driver.
   * Returns false for targets on the page itself.
   */
  const inFrame = async (
    parameters: JsonObject,
    context: ExecutionContext,
    action: FrameActRequest['action'],
    extra: Pick<FrameActRequest, 'text' | 'clear' | 'key'> = {},
  ): Promise<boolean> => {
    const match = FRAME_TARGET.exec(String(parameters.target));
    if (!match) return false;
    const driver = options.driver;
    if (!driver?.frameTarget || !driver.frameAct)
      throw new PageSquireError(
        'TARGET_MISSING',
        'Frame and tab targets need the companion extension.',
      );
    const frame = match[1]!;
    const target = match[2]!;
    if (action === 'press_key' && !FRAME_KEYS.has(String(extra.key)))
      throw new PageSquireError(
        'UNSUPPORTED_TARGET',
        "Escape is the visitor's stop key and is never sent into frames.",
      );
    const info = await driver.frameTarget(frame, target, action, context);
    if (action === 'click' && info.link)
      throw new PageSquireError(
        'LINK_NAVIGATION',
        'Links inside frames stay with the visitor.',
      );
    if (action === 'check') {
      if (info.checked === undefined)
        throw new PageSquireError(
          'UNSUPPORTED_TARGET',
          'This target is not a checkbox, radio, switch or toggle.',
        );
      if (info.checked === parameters.checked) {
        const unchanged = {
          mutations: 0,
          urlChanged: false,
          focusChanged: false,
          stateChanged: false,
        };
        effects.set(context.call.callId, unchanged);
        frameResults.set(context.call.callId, {
          ...unchanged,
          checked: info.checked,
        });
        return true;
      }
    }
    await allow(info.risk, action, info.label, context);
    const effect = await driver.frameAct(
      { frame, target, action, ...extra },
      context,
    );
    effects.set(context.call.callId, {
      mutations: effect.mutations,
      urlChanged: effect.urlChanged,
      focusChanged: effect.focusChanged,
      stateChanged: effect.stateChanged,
    });
    frameResults.set(context.call.callId, effect);
    return true;
  };
  const notInFrame = (parameters: JsonObject) => {
    if (FRAME_TARGET.test(String(parameters.target ?? '')))
      throw new PageSquireError(
        'UNSUPPORTED_TARGET',
        'Inside frames and other tabs, only click, check, type and keys are supported.',
      );
  };

  /** Runs one interaction and records whether the page responded. */
  const perform = async (
    target: Element,
    context: ExecutionContext,
    act: () => void | Promise<void>,
  ) => {
    const document = context.document;
    const view = document.defaultView!;
    const network = options.trackNetwork === false ? undefined : track(view);
    let mutations = 0;
    let last = Date.now();
    const watcher = new view.MutationObserver((records) => {
      // PageSquire's own widget, prompts and cursor are not the page responding.
      const page = records.filter((record) => {
        // A driver's one-call target tag is not the page responding either.
        if (record.attributeName === 'data-pagesquire-target') return false;
        const node =
          record.target.nodeType === 1
            ? (record.target as Element)
            : record.target.parentElement;
        return !node || !composedClosest(node, '[data-pagesquire-root]');
      });
      if (!page.length) return;
      mutations += page.length;
      last = Date.now();
    });
    watcher.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    const url = document.URL;
    const focus = document.activeElement;
    const before = stateOf(target);
    const dialogs = watchDialogs(view);
    try {
      await act();
      const started = Date.now();
      await context.waitFor(
        () =>
          (Date.now() - Math.max(last, network?.lastActivity() ?? 0) >=
            quietMs &&
            (network?.idle() ?? true)) ||
          Date.now() - started >= settleMs,
      );
    } finally {
      watcher.disconnect();
      dialogs.restore();
    }
    const dialog = dialogs.seen();
    effects.set(context.call.callId, {
      mutations,
      urlChanged: document.URL !== url,
      focusChanged: document.activeElement !== focus,
      stateChanged: stateOf(target) !== before,
      ...(dialog ? { dialog } : {}),
    });
  };

  const responded = (
    context: ExecutionContext,
    always = false,
  ): { verified: boolean; evidence: JsonObject } => {
    const effect = effects.get(context.call.callId);
    effects.delete(context.call.callId);
    const changed = Boolean(
      effect &&
      (effect.mutations > 0 ||
        effect.urlChanged ||
        effect.focusChanged ||
        effect.stateChanged ||
        effect.dialog),
    );
    return {
      verified: always || changed,
      evidence: {
        responded: changed,
        mutations: Math.min(effect?.mutations ?? 0, 1000),
        urlChanged: effect?.urlChanged ?? false,
        ...(effect?.dialog ? { dialog: effect.dialog } : {}),
      },
    };
  };

  const handlers: Record<string, CapabilityHandler> = {
    'ui.find': (parameters, context) => {
      found.set(
        context.call.callId,
        context.observer.find(
          context.call.snapshotId,
          String(parameters.query),
          parameters.role ? { role: String(parameters.role) } : {},
        ),
      );
    },
    'ui.click': async (parameters, context) => {
      if (await inFrame(parameters, context, 'click')) return;
      const target = element(parameters, context, 'click');
      refuseLinkNavigation(target, context);
      await guard(target, 'click', context);
      const point = await actionable(target, context, true);
      await perform(target, context, async () => {
        if (!(await options.driver?.click?.(target, context)))
          click(target, point);
      });
    },
    'ui.type': async (parameters, context) => {
      if (
        await inFrame(parameters, context, 'type', {
          text: String(parameters.text),
          clear: parameters.clear === true,
        })
      )
        return;
      const target = element(parameters, context, 'fill');
      const field = textField(target);
      await guard(target, 'type', context);
      await actionable(target, context, false);
      await perform(target, context, async () => {
        const text = String(parameters.text);
        if (
          await options.driver?.type?.(
            field,
            text,
            parameters.clear === true,
            context,
          )
        )
          return;
        field.focus({ preventScroll: true });
        setNativeValue(field, parameters.clear ? text : field.value + text);
        field.dispatchEvent(
          new context.document.defaultView!.InputEvent('input', {
            bubbles: true,
            composed: true,
            inputType: 'insertText',
            data: text,
          }),
        );
        field.dispatchEvent(new Event('change', { bubbles: true }));
      });
    },
    'ui.select': async (parameters, context) => {
      notInFrame(parameters);
      const target = element(parameters, context, 'fill');
      if (target.tagName !== 'SELECT')
        throw new PageSquireError(
          'UNSUPPORTED_TARGET',
          'Open custom dropdowns with ui.click and choose an option.',
        );
      const select = target as HTMLSelectElement;
      const wanted = String(parameters.option).trim().toLowerCase();
      const option = [...select.options].find(
        (entry) =>
          !entry.disabled &&
          (entry.label.trim().toLowerCase() === wanted ||
            entry.value.toLowerCase() === wanted),
      );
      if (!option)
        throw new PageSquireError(
          'OPTION_MISSING',
          `No enabled option matches. Options: ${[...select.options]
            .map((entry) => entry.label.trim())
            .join(', ')
            .slice(0, 300)}`,
        );
      await guard(target, 'select', context);
      await actionable(target, context, false);
      await perform(target, context, () => {
        setNativeValue(select, option.value);
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    },
    'ui.check': async (parameters, context) => {
      if (await inFrame(parameters, context, 'check')) return;
      const target = element(parameters, context, 'click');
      if (checkedState(target) === undefined)
        throw new PageSquireError(
          'UNSUPPORTED_TARGET',
          'This target is not a checkbox, radio, switch or toggle.',
        );
      if (checkedState(target) === parameters.checked) {
        effects.set(context.call.callId, {
          mutations: 0,
          urlChanged: false,
          focusChanged: false,
          stateChanged: false,
        });
        return;
      }
      await guard(target, 'check', context);
      const point = await actionable(target, context, true);
      await perform(target, context, async () => {
        if (!(await options.driver?.click?.(target, context)))
          click(target, point);
      });
    },
    'ui.press_key': async (parameters, context) => {
      if (
        await inFrame(parameters, context, 'press_key', {
          key: String(parameters.key),
        })
      )
        return;
      const target = element(parameters, context, 'click');
      const key = String(parameters.key);
      const submits =
        key === 'Enter' &&
        target.tagName === 'INPUT' &&
        Boolean((target as HTMLInputElement).form);
      if (submits) await guard(target, 'press_key', context);
      else if (
        (key === 'Enter' || key === 'Space') &&
        isClickable(target) &&
        !isTextEntry(target)
      ) {
        refuseLinkNavigation(target, context);
        await guard(target, 'click', context);
      }
      await actionable(target, context, false);
      await perform(target, context, async () => {
        if (!(await options.driver?.pressKey?.(target, key, context)))
          pressKey(target, key, submits, context);
      });
    },
    'ui.hover': async (parameters, context) => {
      notInFrame(parameters);
      const target = element(parameters, context, 'click');
      await guard(target, 'hover', context);
      const point = await actionable(target, context, true);
      await perform(target, context, () => {
        for (const type of [
          'pointerover',
          'pointerenter',
          'mouseover',
          'mouseenter',
          'pointermove',
          'mousemove',
        ])
          pointer(target, type, point);
      });
    },
    'ui.screenshot': async (parameters, context) => {
      if (!options.driver?.screenshot)
        throw new PageSquireError(
          'UNSUPPORTED_TARGET',
          'Screenshots need the companion extension.',
        );
      shots.set(
        context.call.callId,
        await options.driver.screenshot(String(parameters.tab), context),
      );
    },
    'ui.switch_tab': async (parameters, context) => {
      if (!options.driver?.switchTab)
        throw new PageSquireError(
          'UNSUPPORTED_TARGET',
          'Switching tabs needs the companion extension.',
        );
      switched.set(
        context.call.callId,
        await options.driver.switchTab(String(parameters.tab), context),
      );
    },
    'ui.scroll': async (parameters, context) => {
      notInFrame(parameters);
      const view = context.document.defaultView!;
      const before = view.scrollY;
      const direction = String(parameters.direction);
      const scroller =
        context.document.scrollingElement ?? context.document.body;
      if (direction === 'top') view.scrollTo({ top: 0 });
      else if (direction === 'bottom')
        view.scrollTo({ top: scroller.scrollHeight });
      else
        view.scrollBy({
          top: (direction === 'up' ? -1 : 1) * view.innerHeight * 0.8,
        });
      await nextFrame(context);
      const after = view.scrollY;
      const max = Math.max(scroller.scrollHeight - view.innerHeight, 0);
      found.set(context.call.callId, []);
      effects.set(context.call.callId, {
        mutations: 0,
        urlChanged: false,
        focusChanged: false,
        stateChanged:
          after !== before ||
          (direction !== 'up' && direction !== 'top'
            ? after >= max - 1
            : after <= 0),
      });
    },
    'ui.wait_for': async (parameters, context) => {
      const text = String(parameters.text).toLowerCase();
      const visible = parameters.state === 'visible';
      await context.waitFor(
        () =>
          (context.document.body?.innerText ?? '')
            .toLowerCase()
            .includes(text) === visible,
      );
    },
    'ui.ask': (parameters, context) =>
      ask(context, {
        kind: 'choice',
        question: String(parameters.question),
        options: (parameters.options as string[]).map(String),
      }),
    'ui.hand_off': (parameters, context) =>
      ask(context, {
        kind: 'handoff',
        instruction: String(parameters.instruction),
      }),
  };

  const verifiers: Record<string, VerificationHandler> = {
    'ui.find.verify': (_parameters, context) => {
      const matches = found.get(context.call.callId) ?? [];
      found.delete(context.call.callId);
      return {
        verified: true,
        evidence: {
          matches: matches.map((match) => ({
            id: match.id,
            role: match.role,
            name: match.name,
            ...(match.checked === undefined ? {} : { checked: match.checked }),
            ...(match.disabled ? { disabled: true } : {}),
          })),
        },
      };
    },
    'ui.click.verify': (_parameters, context) => {
      frameResults.delete(context.call.callId);
      return responded(context);
    },
    'ui.type.verify': (parameters, context) => {
      effects.delete(context.call.callId);
      const framed = frameResults.get(context.call.callId);
      if (framed) {
        frameResults.delete(context.call.callId);
        return {
          verified: framed.typed === true,
          evidence: { length: framed.length ?? 0 },
        };
      }
      const field = verifiable(parameters, context, 'fill') as HTMLInputElement;
      const text = String(parameters.text);
      return {
        verified: parameters.clear
          ? field.value === text
          : field.value.endsWith(text),
        evidence: { length: field.value.length },
      };
    },
    'ui.select.verify': (parameters, context) => {
      effects.delete(context.call.callId);
      const select = verifiable(
        parameters,
        context,
        'fill',
      ) as HTMLSelectElement;
      const wanted = String(parameters.option).trim().toLowerCase();
      const chosen = select.selectedOptions[0];
      return {
        verified: Boolean(
          chosen &&
          (chosen.label.trim().toLowerCase() === wanted ||
            chosen.value.toLowerCase() === wanted),
        ),
        evidence: { selected: chosen?.label.trim().slice(0, 200) ?? '' },
      };
    },
    'ui.check.verify': (parameters, context) => {
      effects.delete(context.call.callId);
      const framed = frameResults.get(context.call.callId);
      if (framed) {
        frameResults.delete(context.call.callId);
        return {
          verified: framed.checked === parameters.checked,
          evidence: { checked: framed.checked ?? false },
        };
      }
      const state = checkedState(verifiable(parameters, context, 'click'));
      return {
        verified: state === parameters.checked,
        evidence: { checked: state ?? false },
      };
    },
    'ui.screenshot.verify': (parameters, context) => {
      const screenshot = shots.get(context.call.callId);
      shots.delete(context.call.callId);
      return screenshot
        ? {
            verified: true,
            evidence: {
              tab: String(parameters.tab),
              width: screenshot.width,
              height: screenshot.height,
            },
            screenshot,
          }
        : { verified: false };
    },
    'ui.switch_tab.verify': (parameters, context) => {
      const active = switched.get(context.call.callId) === true;
      switched.delete(context.call.callId);
      return { verified: active, evidence: { tab: String(parameters.tab) } };
    },
    'ui.press_key.verify': (_parameters, context) => {
      frameResults.delete(context.call.callId);
      return responded(context);
    },
    'ui.hover.verify': (_parameters, context) => responded(context, true),
    'ui.scroll.verify': (_parameters, context) => {
      found.delete(context.call.callId);
      const result = responded(context);
      return {
        verified: result.verified,
        evidence: {
          scrollY: Math.round(context.document.defaultView!.scrollY),
        },
      };
    },
    'ui.wait_for.verify': (parameters, context) => {
      const present = (context.document.body?.innerText ?? '')
        .toLowerCase()
        .includes(String(parameters.text).toLowerCase());
      return {
        verified: present === (parameters.state === 'visible'),
        evidence: { present },
      };
    },
    'ui.ask.verify': (_parameters, context) => {
      const answer = answers.get(context.call.callId);
      answers.delete(context.call.callId);
      // The answer is one of the model's own options, not free visitor text.
      return answer === undefined
        ? { verified: false }
        : { verified: true, evidence: { answer } };
    },
    'ui.hand_off.verify': (_parameters, context) => {
      const answer = answers.get(context.call.callId);
      answers.delete(context.call.callId);
      return answer === 'done'
        ? { verified: true, evidence: { visitorFinished: true } }
        : { verified: false };
    },
  };

  return { capabilities: createGenericCapabilities(), handlers, verifiers };
}

/** Built-in tiering: credentials and payment forms stay with the visitor. */
export function defaultRisk(
  element: Element,
  action: GenericAction,
): GenericRisk {
  const marked = composedClosest(
    element,
    '[data-pagesquire-risk]',
  )?.getAttribute('data-pagesquire-risk');
  if (marked === 'deny' || marked === 'approve' || marked === 'allow')
    return marked;
  const form = element.closest('form');
  if (
    form?.querySelector(
      'input[type="password"], input[type="file"], [autocomplete^="cc-"], [autocomplete*=" cc-"], [autocomplete~="one-time-code"]',
    )
  )
    return 'deny';
  if (action === 'hover' || action === 'type' || action === 'select')
    return 'allow';
  if (
    element.closest('form') &&
    element.matches(
      'button[type="submit"], button:not([type]), input[type="submit"], input[type="image"]',
    )
  )
    return 'approve';
  if (action === 'press_key') return 'approve';
  return RISKY.test(accessibleText(element)) ? 'approve' : 'allow';
}

function actionLabel(action: GenericAction): string {
  return {
    click: 'Click',
    type: 'Type into',
    select: 'Choose in',
    check: 'Change',
    press_key: 'Press a key on',
    hover: 'Point at',
  }[action];
}

function accessibleText(element: Element): string {
  return (
    element.getAttribute('aria-label') ||
    (element as HTMLInputElement).value ||
    element.textContent ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function refuseLinkNavigation(target: Element, context: ExecutionContext) {
  const link = target.closest('a[href]') as HTMLAnchorElement | null;
  if (!link) return;
  if (link.hasAttribute('download') || link.target === '_blank')
    throw new PageSquireError(
      'TARGET_NOT_ALLOWED',
      'Downloads and new windows stay with the visitor.',
    );
  const destination = new URL(link.href, context.document.URL);
  const current = new URL(context.document.URL);
  if (
    destination.protocol.startsWith('http') &&
    (destination.origin !== current.origin ||
      destination.pathname !== current.pathname ||
      destination.search !== current.search)
  )
    throw new PageSquireError(
      'LINK_NAVIGATION',
      'Open links to other pages with browser.navigate.',
    );
}

function textField(target: Element): HTMLInputElement | HTMLTextAreaElement {
  if (!isTextEntry(target))
    throw new PageSquireError(
      'UNSUPPORTED_TARGET',
      'ui.type needs a text input or textarea target.',
    );
  return target as HTMLInputElement | HTMLTextAreaElement;
}

function isTextEntry(target: Element): boolean {
  if (target.tagName === 'TEXTAREA') return true;
  if (target.tagName !== 'INPUT') return false;
  return [
    'text',
    'search',
    'email',
    'url',
    'tel',
    'number',
    'date',
    'time',
    'datetime-local',
    'month',
    'week',
  ].includes((target.getAttribute('type') ?? 'text').toLowerCase());
}

function isClickable(target: Element): boolean {
  return target.matches(
    'button, a[href], summary, input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"]',
  );
}

/** React and similar libraries track the native setter, not the instance property. */
function setNativeValue(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  let proto: object | null = Object.getPrototypeOf(field);
  while (proto) {
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(field, value);
      return;
    }
    proto = Object.getPrototypeOf(proto);
  }
  field.value = value;
}

function checkedState(target: Element): boolean | 'mixed' | undefined {
  if (
    target.tagName === 'INPUT' &&
    ['checkbox', 'radio'].includes((target as HTMLInputElement).type)
  )
    return (target as HTMLInputElement).checked;
  const aria =
    target.getAttribute('aria-checked') ?? target.getAttribute('aria-pressed');
  if (aria === 'mixed') return 'mixed';
  if (aria === 'true' || aria === 'false') return aria === 'true';
  return undefined;
}

function stateOf(target: Element): string {
  const field = target as HTMLInputElement;
  return JSON.stringify([
    checkedState(target),
    typeof field.value === 'string' ? field.value.length : null,
    target.getAttribute('aria-expanded'),
    target.getAttribute('aria-selected'),
    target.parentElement?.tagName === 'DETAILS'
      ? (target.parentElement as HTMLDetailsElement).open
      : null,
  ]);
}

function nextFrame(context: ExecutionContext): Promise<void> {
  const view = context.document.defaultView!;
  return new Promise<void>((resolve, reject) => {
    const abort = () => reject(context.signal.reason);
    context.signal.addEventListener('abort', abort, { once: true });
    const done = () => {
      context.signal.removeEventListener('abort', abort);
      resolve();
    };
    // Hidden pages, such as the chat tab while the visitor looks at another
    // tab, get no animation frames.
    if (
      typeof view.requestAnimationFrame === 'function' &&
      !view.document.hidden
    )
      view.requestAnimationFrame(() => done());
    else setTimeout(done, 16);
  });
}

/**
 * Playwright-style actionability: in view, visible, enabled, stable for two
 * frames and, for pointer actions, not covered by another element.
 */
async function actionable(
  target: Element,
  context: ExecutionContext,
  pointerTarget: boolean,
): Promise<{ x: number; y: number }> {
  const document = context.document;
  const deadline = Date.now() + 1500;
  (target as HTMLElement).scrollIntoView?.({
    block: 'center',
    inline: 'nearest',
  });
  let previous: DOMRect | undefined;
  let reason = 'TARGET_HIDDEN';
  for (;;) {
    context.signal.throwIfAborted();
    const rect = target.getBoundingClientRect();
    const point = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    if (!target.isConnected || !context.observer.isVisible(target))
      reason = 'TARGET_HIDDEN';
    else if (
      target.matches(':disabled') ||
      target.getAttribute('aria-disabled') === 'true'
    )
      reason = 'TARGET_DISABLED';
    else if (
      !previous ||
      Math.abs(previous.x - rect.x) > 0.5 ||
      Math.abs(previous.y - rect.y) > 0.5 ||
      Math.abs(previous.width - rect.width) > 0.5
    )
      reason = 'TARGET_UNSTABLE';
    else if (pointerTarget && !receivesPointer(document, target, point))
      reason = 'TARGET_COVERED';
    else return point;
    previous = rect;
    if (Date.now() > deadline)
      throw new PageSquireError(
        reason,
        {
          TARGET_HIDDEN: 'The target is not visible.',
          TARGET_DISABLED: 'The target is disabled.',
          TARGET_UNSTABLE: 'The target kept moving.',
          TARGET_COVERED: 'Another element covers the target.',
        }[reason] ?? 'The target is not ready.',
      );
    await nextFrame(context);
  }
}

function receivesPointer(
  document: Document,
  target: Element,
  point: { x: number; y: number },
): boolean {
  let hit = document.elementFromPoint(point.x, point.y);
  for (let depth = 0; hit?.shadowRoot && depth < 8; depth++) {
    const inner = hit.shadowRoot.elementFromPoint(point.x, point.y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  for (let node: Element | null = hit; node;) {
    if (node === target) return true;
    node =
      node.parentElement ??
      ((node.getRootNode() as Partial<ShadowRoot>).host as
        Element | undefined) ??
      null;
  }
  return false;
}

function pointer(
  target: Element,
  type: string,
  point: { x: number; y: number },
) {
  const view = target.ownerDocument.defaultView!;
  const pointerEvent = type.startsWith('pointer') && 'PointerEvent' in view;
  const Constructor = pointerEvent ? view.PointerEvent : view.MouseEvent;
  target.dispatchEvent(
    new Constructor(type, {
      bubbles: !type.endsWith('enter'),
      cancelable: true,
      composed: true,
      clientX: point.x,
      clientY: point.y,
      view,
      button: 0,
      buttons: type.endsWith('down') ? 1 : 0,
      ...(pointerEvent
        ? { pointerId: 1, pointerType: 'mouse', isPrimary: true }
        : {}),
    }),
  );
}

/** The full pointer sequence, then the element's own activation via click(). */
function click(target: Element, point: { x: number; y: number }) {
  for (const type of [
    'pointerover',
    'pointerenter',
    'mouseover',
    'mouseenter',
    'pointermove',
    'mousemove',
    'pointerdown',
    'mousedown',
  ])
    pointer(target, type, point);
  (target as HTMLElement).focus?.({ preventScroll: true });
  pointer(target, 'pointerup', point);
  pointer(target, 'mouseup', point);
  (target as HTMLElement).click();
}

function pressKey(
  target: Element,
  key: string,
  submits: boolean,
  context: ExecutionContext,
) {
  const view = context.document.defaultView!;
  const value = key === 'Space' ? ' ' : key;
  (target as HTMLElement).focus?.({ preventScroll: true });
  const init = {
    key: value,
    code: key === 'Space' ? 'Space' : key,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  const proceed = target.dispatchEvent(new view.KeyboardEvent('keydown', init));
  if (proceed) {
    if (submits) (target as HTMLInputElement).form?.requestSubmit();
    else if (
      (key === 'Enter' || key === 'Space') &&
      isClickable(target) &&
      !isTextEntry(target)
    )
      (target as HTMLElement).click();
    else if (key === 'Tab') focusNext(context.document, target);
  }
  target.dispatchEvent(new view.KeyboardEvent('keyup', init));
}

function focusNext(document: Document, from: Element) {
  const focusable = [
    ...document.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => !element.matches(':disabled') && element.tabIndex >= 0);
  const index = focusable.indexOf(from as HTMLElement);
  focusable[(index + 1) % Math.max(focusable.length, 1)]?.focus();
}

interface NetworkTracker {
  idle(): boolean;
  /** When a request last started or finished, so rendering after a response counts. */
  lastActivity(): number;
}
const trackers = new WeakMap<object, NetworkTracker>();

/** Counts in-flight fetch and XHR requests; installed once per window. */
function track(view: Window): NetworkTracker {
  const existing = trackers.get(view);
  if (existing) return existing;
  let inflight = 0;
  let activity = 0;
  const begin = () => {
    inflight++;
    activity = Date.now();
  };
  const end = () => {
    inflight--;
    activity = Date.now();
  };
  const tracker = { idle: () => inflight === 0, lastActivity: () => activity };
  trackers.set(view, tracker);
  const original = view.fetch;
  if (typeof original === 'function')
    view.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      begin();
      return original.apply(this ?? view, args).finally(end);
    } as typeof fetch;
  const Request = (view as Window & typeof globalThis).XMLHttpRequest;
  const send = Request?.prototype.send;
  if (send)
    Request.prototype.send = function (
      this: XMLHttpRequest,
      ...args: Parameters<XMLHttpRequest['send']>
    ) {
      begin();
      this.addEventListener('loadend', end, { once: true });
      return send.apply(this, args);
    };
  return tracker;
}
