import { PROTOCOL_VERSION } from '@pagesquire/protocol';
import type {
  FrameSnapshot,
  ObservedTarget,
  PageSnapshot,
  TabSnapshot,
} from '@pagesquire/protocol';
import { PageSquireError } from './errors.js';
import { immutableCopy } from './json.js';

export type Interaction = 'click' | 'fill';

export interface ObserverOptions {
  document: Document;
  canInteract?: (element: Element, interaction: Interaction) => boolean;
  /** Navigation destinations. Defaults to the initial pathname. */
  allowUrl?: (url: URL) => boolean;
  /** Pages the assistant may observe and act on. Defaults to `allowUrl`. */
  observeUrl?: (url: URL) => boolean;
  /**
   * Rewrites the current page URL sent in snapshots, e.g. to drop reset tokens
   * or emails from paths and queries. Must return a same-origin HTTP(S) URL.
   */
  redactUrl?: (url: URL) => string;
  maxTextLength?: number;
  maxTargets?: number;
  /** Start the snapshot text with a heading and landmark outline (default false). */
  outline?: boolean;
  /**
   * Append the visible text of same-origin iframes, read-only (default
   * false). Elements inside frames never become targets.
   */
  frames?: boolean;
  /**
   * Cross-origin frames read elsewhere, such as by the companion extension
   * (CompanionDriver.frames). They are added to each snapshot as `frames`.
   */
  remoteFrames?: () => readonly FrameSnapshot[];
  /**
   * Other tabs in the companion extension's session (CompanionDriver.tabs),
   * added to each snapshot as `tabs`.
   */
  remoteTabs?: () => readonly TabSnapshot[];
}

const excluded = [
  '[data-pagesquire-private]',
  '[data-pagesquire-ignore]',
  '[data-pagesquire-root]',
  '[contenteditable]:not([contenteditable="false"])',
  'script',
  'style',
  'noscript',
  'template',
].join(',');

const sensitiveInput = /^(password|hidden|file)$/i;
const sensitiveAutocomplete =
  /(?:^|\s)(?:current-password|new-password|one-time-code|cc-[\w-]+)(?:\s|$)/i;
const sensitiveQueryKey =
  /password|passwd|token|secret|authorization|api[_-]?key|signature|credential|nonce|jwt|session[_-]?id|^(?:sig|sid|otp)$/i;

/** Elements a person can operate; snapshots and find() consider only these. */
const TARGETS = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  'summary',
  '[data-pagesquire-id]',
  ...[
    'button',
    'link',
    'checkbox',
    'radio',
    'switch',
    'tab',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'combobox',
    'textbox',
    'searchbox',
    'slider',
    'spinbutton',
    'treeitem',
  ].map((role) => `[role="${role}"]`),
].join(',');

const INPUT_ROLES: Record<string, string> = {
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  number: 'spinbutton',
  search: 'searchbox',
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
};

/** Parent across open shadow-root boundaries. */
function composedParent(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode() as Partial<ShadowRoot>;
  return root.host ?? null;
}

/** Element.closest() that also crosses open shadow-root boundaries. */
export function composedClosest(
  element: Element,
  selector: string,
): Element | null {
  for (
    let current: Element | null = element;
    current;
    current = composedParent(current)
  )
    if (current.matches(selector)) return current;
  return null;
}

export class PageObserver {
  readonly document: Document;
  private readonly options: ObserverOptions;
  private readonly origin: string;
  private readonly initialPath: string;
  private snapshot: PageSnapshot | undefined;
  /** Target IDs survive across snapshots for as long as the element exists. */
  private readonly refs = new WeakMap<Element, string>();
  private nextRef = 1;
  private previousIds: Set<string> | undefined;
  private readonly pinned = new Set<Element>();
  /** The unredacted document URL the current snapshot was taken on. */
  private snapshotUrl: string | undefined;
  private readonly targets = new Map<
    string,
    { element: Element; fingerprint: string }
  >();

  constructor(options: ObserverOptions) {
    this.document = options.document;
    this.options = options;
    if (
      (options.maxTextLength !== undefined &&
        (!Number.isInteger(options.maxTextLength) ||
          options.maxTextLength < 1 ||
          options.maxTextLength > 32000)) ||
      (options.maxTargets !== undefined &&
        (!Number.isInteger(options.maxTargets) ||
          options.maxTargets < 1 ||
          options.maxTargets > 1000))
    ) {
      throw new PageSquireError(
        'INVALID_OPTIONS',
        'Observation limits must be bounded positive integers.',
      );
    }
    const initial = new URL(this.document.URL);
    if (
      !this.document.defaultView ||
      !['http:', 'https:'].includes(initial.protocol)
    ) {
      throw new PageSquireError(
        'UNSUPPORTED_DOCUMENT',
        'Use an attached HTTP or HTTPS document.',
      );
    }
    this.origin = initial.origin;
    this.initialPath = initial.pathname;
    this.observableUrl(initial.href);
  }

  allowedUrl(value: string): URL {
    const url = new URL(value, this.document.URL);
    if (
      !this.safeUrl(url) ||
      !(this.options.allowUrl?.(url) ?? url.pathname === this.initialPath)
    ) {
      throw new PageSquireError(
        'URL_NOT_ALLOWED',
        'The destination is outside the configured navigation scope.',
      );
    }
    return url;
  }

  /** Throws when the assistant may not observe or act on this page. */
  observableUrl(value: string): URL {
    if (!this.options.observeUrl) return this.allowedUrl(value);
    const url = new URL(value, this.document.URL);
    if (!this.safeUrl(url) || !this.options.observeUrl(url)) {
      throw new PageSquireError(
        'PAGE_NOT_OBSERVABLE',
        'The assistant is not enabled on this page.',
      );
    }
    return url;
  }

  private safeUrl(url: URL): boolean {
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      url.origin === this.origin &&
      !url.username &&
      !url.password &&
      ![...url.searchParams.keys()].some((key) =>
        sensitiveQueryKey.test(key),
      ) &&
      ![...new URLSearchParams(url.hash.slice(1)).keys()].some((key) =>
        sensitiveQueryKey.test(key),
      )
    );
  }

  private publicUrl(url: URL): string {
    if (!this.options.redactUrl) return url.href;
    let redacted: URL;
    try {
      redacted = new URL(this.options.redactUrl(new URL(url.href)), url);
    } catch {
      redacted = new URL('invalid:');
    }
    if (
      !['http:', 'https:'].includes(redacted.protocol) ||
      redacted.origin !== this.origin ||
      redacted.username ||
      redacted.password
    ) {
      throw new PageSquireError(
        'INVALID_OPTIONS',
        'URL redaction must return a same-origin HTTP or HTTPS URL.',
      );
    }
    return redacted.href;
  }

  isVisible(element: Element): boolean {
    return element.ownerDocument === this.document && this.rendered(element);
  }

  /** Rendered and not hidden, judged in the element's own document. */
  private rendered(element: Element): boolean {
    if (
      !element.isConnected ||
      composedClosest(element, '[hidden], [inert], [aria-hidden="true"]')
    ) {
      return false;
    }
    if (element.getClientRects().length === 0) return false;
    for (
      let current: Element | null = element;
      current;
      current = composedParent(current)
    ) {
      if (
        current.tagName === 'DETAILS' &&
        !(current as HTMLDetailsElement).open &&
        current !== element
      ) {
        const summary = [...current.children].find(
          (child) => child.tagName === 'SUMMARY',
        );
        if (!summary?.contains(element)) return false;
      }
      if (this.hiddenByStyle(current)) return false;
    }
    return true;
  }

  /** Computed styles are cached for the duration of one observation. */
  private styleCache: WeakMap<Element, boolean> | undefined;

  private hiddenByStyle(element: Element): boolean {
    const cached = this.styleCache?.get(element);
    if (cached !== undefined) return cached;
    const style = (
      element.ownerDocument.defaultView ?? this.document.defaultView!
    ).getComputedStyle(element);
    const hidden =
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      style.opacity === '0';
    this.styleCache?.set(element, hidden);
    return hidden;
  }

  isExcluded(element: Element): boolean {
    return Boolean(
      composedClosest(element, excluded) ||
      (element.tagName === 'INPUT' &&
        sensitiveInput.test(element.getAttribute('type') ?? 'text')) ||
      sensitiveAutocomplete.test(element.getAttribute('autocomplete') ?? ''),
    );
  }

  private text(
    root: Element,
    limit: number,
  ): { value: string; truncated: boolean } {
    const walker = root.ownerDocument.createTreeWalker(root, 4);
    const parts: string[] = [];
    let length = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (
        !parent ||
        this.isExcluded(parent) ||
        parent.closest('input,textarea,select') ||
        !this.rendered(parent)
      )
        continue;
      const value = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!value) continue;
      parts.push(value);
      length += value.length + 1;
      if (length > limit) {
        return { value: parts.join(' ').slice(0, limit), truncated: true };
      }
    }
    return { value: parts.join(' '), truncated: false };
  }

  private name(element: Element): string {
    const labelledBy = element
      .getAttribute('aria-labelledby')
      ?.split(/\s+/)
      .map((id) => this.document.getElementById(id))
      .filter((label): label is HTMLElement =>
        Boolean(label && !this.isExcluded(label)),
      )
      .map((label) => this.text(label, 120).value)
      .join(' ');
    const labels =
      'labels' in element
        ? Array.from((element as HTMLInputElement).labels ?? [])
            .filter((label) => !this.isExcluded(label))
            .map((label) => this.text(label, 120).value)
            .join(' ')
        : '';
    return (
      element.getAttribute('aria-label') ||
      labelledBy ||
      labels ||
      this.text(element, 120).value ||
      element.getAttribute('title') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  private fingerprint(element: Element): string {
    return JSON.stringify([
      element.tagName,
      element.getAttribute('type'),
      element.getAttribute('id'),
      element.getAttribute('href'),
      element.getAttribute('role'),
      this.name(element),
    ]);
  }

  canInteract(element: Element, interaction: Interaction): boolean {
    if (
      this.isExcluded(element) ||
      !this.isVisible(element) ||
      element.matches(':disabled') ||
      element.getAttribute('aria-disabled') === 'true'
    )
      return false;
    return this.options.canInteract?.(element, interaction) === true;
  }

  /** Host-selected public DOM text, without replacing the active action snapshot. */
  readContent(
    root: Element,
    maxLength = 12000,
    offset = 0,
  ): { text: string; truncated: boolean; nextOffset: number | null } {
    if (
      root.ownerDocument !== this.document ||
      !root.isConnected ||
      this.isExcluded(root) ||
      !this.isVisible(root)
    ) {
      throw new PageSquireError(
        'TARGET_MISSING',
        'Reading requires one visible, public host-selected content root.',
      );
    }
    if (
      !Number.isInteger(maxLength) ||
      maxLength < 1 ||
      maxLength > 24000 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 40000
    ) {
      throw new PageSquireError(
        'INVALID_OPTIONS',
        'Content length and offset must remain within the reading budget.',
      );
    }
    const result = this.text(root, offset + maxLength);
    return {
      text: result.value.slice(offset, offset + maxLength),
      truncated: result.truncated,
      nextOffset:
        result.truncated && offset + maxLength <= 40000
          ? offset + maxLength
          : null,
    };
  }

  observe(): PageSnapshot {
    const url = this.observableUrl(this.document.URL);
    const publicUrl = this.publicUrl(url);
    const maxText = this.options.maxTextLength ?? 4000;
    const maxTargets = this.options.maxTargets ?? 100;
    this.styleCache = new WeakMap();
    let text: { value: string; truncated: boolean };
    try {
      text = this.pageText(maxText);
    } finally {
      this.styleCache = undefined;
    }
    const observed: ObservedTarget[] = [];
    this.targets.clear();
    let truncated = false;
    const previous = this.previousIds;
    const current = new Set<string>();
    // When there are more targets than the limit, keep what is on screen
    // first, so an overlay or banner at the end of the DOM stays visible to
    // the model. Document order is kept within each group.
    const view = this.document.defaultView!;
    this.styleCache = new WeakMap();
    try {
      const candidates: Element[] = [];
      const all = this.query(TARGETS);
      let scanned = 0;
      for (const element of all) {
        if (++scanned > 5000) break;
        if (this.isExcluded(element) || !this.isVisible(element)) continue;
        candidates.push(element);
      }
      if (candidates.length > maxTargets) {
        const onScreen = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < view.innerHeight &&
            rect.left < view.innerWidth
          );
        };
        const visible = new Set(candidates.filter(onScreen));
        candidates.splice(
          0,
          candidates.length,
          ...visible,
          ...candidates.filter((element) => !visible.has(element)),
        );
      }
      for (const element of candidates) {
        if (observed.length === maxTargets) {
          truncated = true;
          break;
        }
        const target = this.describe(element);
        if (previous && !previous.has(target.id)) target.new = true;
        current.add(target.id);
        observed.push(target);
      }
      // Targets returned by find() stay addressable in the next snapshot even
      // beyond the target limit, so the follow-up action can use them.
      for (const element of this.pinned) {
        const id = this.refs.get(element);
        if (
          !id ||
          current.has(id) ||
          !element.isConnected ||
          this.isExcluded(element) ||
          !this.isVisible(element)
        )
          continue;
        const target = this.describe(element);
        current.add(target.id);
        observed.push(target);
      }
      this.pinned.clear();
    } finally {
      this.styleCache = undefined;
    }
    const removed = previous
      ? [...previous].filter((id) => !current.has(id)).slice(0, 100)
      : [];
    this.previousIds = current;
    const bytes = this.document.defaultView!.crypto.getRandomValues(
      new Uint8Array(16),
    );
    this.snapshot = immutableCopy({
      protocolVersion: PROTOCOL_VERSION,
      id: `snapshot-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`,
      url: publicUrl,
      title: this.document.title.slice(0, 200),
      text: text.value,
      targets: observed,
      truncated: { text: text.truncated, targets: truncated },
      ...(removed.length ? { removedTargets: removed } : {}),
      ...this.remoteFrames(),
      ...this.remoteTabs(),
    });
    this.snapshotUrl = url.href;
    return this.snapshot;
  }

  /** Well-formed remote frames, bounded like the protocol; never throws. */
  private remoteFrames(): { frames?: FrameSnapshot[] } {
    let frames: readonly FrameSnapshot[];
    try {
      frames = this.options.remoteFrames?.() ?? [];
    } catch {
      return {};
    }
    const kept = frames
      .filter(
        (frame) =>
          /^frame[1-9][0-9]{0,2}$/.test(frame?.id) &&
          Array.isArray(frame.targets) &&
          frame.targets.every((target) =>
            target.id.startsWith(`${frame.id}-target-`),
          ),
      )
      .slice(0, 5)
      .map((frame) => ({
        id: frame.id,
        origin: String(frame.origin).slice(0, 200),
        title: String(frame.title).slice(0, 200),
        text: String(frame.text).slice(0, 4000),
        targets: frame.targets.slice(0, 100),
        truncated: {
          text: Boolean(frame.truncated?.text),
          targets:
            Boolean(frame.truncated?.targets) || frame.targets.length > 100,
        },
      }));
    return kept.length ? { frames: kept } : {};
  }

  /** Well-formed remote tabs, bounded like the protocol; never throws. */
  private remoteTabs(): { tabs?: TabSnapshot[] } {
    let tabs: readonly TabSnapshot[];
    try {
      tabs = this.options.remoteTabs?.() ?? [];
    } catch {
      return {};
    }
    const kept = tabs
      .filter(
        (tab) =>
          /^tab[2-9]$/.test(tab?.id) &&
          /^https?:\/\//.test(String(tab.url)) &&
          Array.isArray(tab.targets) &&
          tab.targets.every((target) =>
            target.id.startsWith(`${tab.id}-target-`),
          ),
      )
      .slice(0, 4)
      .map((tab) => ({
        id: tab.id,
        url: String(tab.url).slice(0, 4096),
        title: String(tab.title).slice(0, 200),
        text: String(tab.text).slice(0, 4000),
        targets: tab.targets.slice(0, 100),
        truncated: {
          text: Boolean(tab.truncated?.text),
          targets: Boolean(tab.truncated?.targets) || tab.targets.length > 100,
        },
        active: tab.active === true,
      }));
    return kept.length ? { tabs: kept } : {};
  }

  /** Main text, optionally led by an outline and followed by frame text. */
  private pageText(limit: number): { value: string; truncated: boolean } {
    const outline = this.options.outline ? this.outline() : '';
    const main = this.text(
      this.document.querySelector('main') ?? this.document.body,
      Math.max(1, limit - outline.length),
    );
    let value = `${outline}${main.value}`;
    let truncated = main.truncated;
    if (this.options.frames && !truncated)
      for (const frame of this.query('iframe').slice(0, 5)) {
        const remaining = limit - value.length - 1;
        if (remaining < 40) break;
        if (this.isExcluded(frame) || !this.isVisible(frame)) continue;
        let body: HTMLElement | null | undefined;
        try {
          // Cross-origin and sandboxed frames expose no document.
          const document = (frame as HTMLIFrameElement).contentDocument;
          if (document?.defaultView?.location.origin === this.origin)
            body = document.body;
        } catch {
          body = undefined;
        }
        if (!body) continue;
        const label = `[Frame${frame.getAttribute('title') ? ` "${frame.getAttribute('title')!.slice(0, 80)}"` : ''}] `;
        const inner = this.text(body, Math.max(1, remaining - label.length));
        if (!inner.value) continue;
        value = `${value} ${label}${inner.value}`;
        truncated ||= inner.truncated;
      }
    return value.length > limit
      ? { value: value.slice(0, limit), truncated: true }
      : { value, truncated };
  }

  /** Visible headings and labelled landmarks, in document order. */
  private outline(): string {
    const entries: string[] = [];
    const landmarks: Record<string, string> = {
      MAIN: 'main',
      NAV: 'navigation',
      ASIDE: 'complementary',
      FORM: 'form',
      DIALOG: 'dialog',
      SEARCH: 'search',
    };
    for (const element of this.query(
      'h1,h2,h3,main,nav,aside,form,dialog[open],search,[role="navigation"],[role="main"],[role="complementary"],[role="search"],[role="dialog"]',
    )) {
      if (entries.length >= 30) break;
      if (this.isExcluded(element) || !this.isVisible(element)) continue;
      const role =
        element.getAttribute('role') ?? landmarks[element.tagName] ?? '';
      const heading = /^H[1-3]$/.test(element.tagName);
      const label = heading
        ? (element.textContent ?? '').replace(/\s+/g, ' ').trim()
        : (element.getAttribute('aria-label') ?? '').trim();
      // Unlabelled forms are too common to be useful structure.
      if (heading ? !label : !role || (role === 'form' && !label)) continue;
      entries.push(
        heading
          ? `${element.tagName.toLowerCase()} ${label.slice(0, 80)}`
          : label
            ? `${role} "${label.slice(0, 80)}"`
            : role,
      );
    }
    return entries.length ? `[Outline: ${entries.join(' | ')}] ` : '';
  }

  requireSnapshot(snapshotId: string): PageSnapshot {
    if (
      !this.snapshot ||
      this.snapshot.id !== snapshotId ||
      this.snapshotUrl !== this.document.URL
    ) {
      throw new PageSquireError(
        'STALE_SNAPSHOT',
        'Observe the current page before choosing another action.',
      );
    }
    this.observableUrl(this.document.URL);
    return this.snapshot;
  }

  resolveTarget(
    snapshotId: string,
    targetId: string,
    interaction: Interaction,
  ): Element {
    this.requireSnapshot(snapshotId);
    const target = this.targets.get(targetId);
    if (
      !target ||
      !target.element.isConnected ||
      target.fingerprint !== this.fingerprint(target.element)
    ) {
      throw new PageSquireError(
        'STALE_TARGET',
        'The observed target changed or is no longer available.',
      );
    }
    if (!this.canInteract(target.element, interaction)) {
      throw new PageSquireError(
        'TARGET_NOT_ALLOWED',
        'This target is not permitted for the requested interaction.',
      );
    }
    return target.element;
  }

  /**
   * Searches every operable public element, not only the snapshot's first
   * targets, and makes matches actionable within the current snapshot.
   */
  find(
    snapshotId: string,
    query: string,
    options: { role?: string; limit?: number } = {},
  ): ObservedTarget[] {
    this.requireSnapshot(snapshotId);
    const needle = query.replace(/\s+/g, ' ').trim().toLowerCase();
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    if (!needle && !options.role) return [];
    const matches: ObservedTarget[] = [];
    for (const element of this.query(TARGETS)) {
      if (this.isExcluded(element) || !this.isVisible(element)) continue;
      const target = this.describe(element);
      if (options.role && target.role !== options.role) continue;
      if (needle && !target.name.toLowerCase().includes(needle)) continue;
      matches.push(target);
      this.pinned.add(element);
      if (matches.length === limit) break;
    }
    return matches;
  }

  /** Matches in the document and in open shadow roots, light DOM first. */
  private query(selector: string): Element[] {
    const results: Element[] = [];
    const visit = (root: Document | ShadowRoot, depth: number) => {
      results.push(...root.querySelectorAll(selector));
      if (depth >= 8) return;
      for (const host of root.querySelectorAll('*'))
        if (host.shadowRoot) visit(host.shadowRoot, depth + 1);
    };
    visit(this.document, 0);
    return results;
  }

  private ref(element: Element): string {
    let id = this.refs.get(element);
    if (!id) {
      id = `target-${this.nextRef++}`;
      this.refs.set(element, id);
    }
    return id;
  }

  /** Describes and registers one target in the current snapshot. */
  private describe(element: Element): ObservedTarget {
    const id = this.ref(element);
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    const target: ObservedTarget = {
      id,
      tag: tag.slice(0, 40),
      name: this.name(element),
      role: (
        element.getAttribute('role') ??
        (tag === 'a'
          ? 'link'
          : tag === 'button' || tag === 'summary'
            ? 'button'
            : tag === 'select'
              ? 'combobox'
              : tag === 'textarea'
                ? 'textbox'
                : tag === 'input'
                  ? (INPUT_ROLES[type] ?? 'textbox')
                  : 'control')
      ).slice(0, 100),
      disabled:
        element.matches(':disabled') ||
        element.getAttribute('aria-disabled') === 'true',
      actionable:
        this.canInteract(element, 'click') || this.canInteract(element, 'fill'),
      ...this.state(element, tag, type),
    };
    if (tag === 'a') {
      try {
        target.href = this.allowedUrl((element as HTMLAnchorElement).href).href;
      } catch {
        /* Out-of-scope destinations are not advertised. */
      }
    }
    this.targets.set(id, { element, fingerprint: this.fingerprint(element) });
    return target;
  }

  /** State flags only; field values are never included. */
  private state(
    element: Element,
    tag: string,
    type: string,
  ): Partial<ObservedTarget> {
    const state: Partial<ObservedTarget> = {};
    const aria = (name: string) => element.getAttribute(name);
    const control = element as HTMLInputElement;
    if (tag === 'input' && (type === 'checkbox' || type === 'radio'))
      state.checked = control.indeterminate ? 'mixed' : control.checked;
    else if (aria('aria-checked') === 'mixed') state.checked = 'mixed';
    else if (['true', 'false'].includes(aria('aria-checked') ?? ''))
      state.checked = aria('aria-checked') === 'true';
    if (['true', 'false'].includes(aria('aria-expanded') ?? ''))
      state.expanded = aria('aria-expanded') === 'true';
    else if (tag === 'summary' && element.parentElement?.tagName === 'DETAILS')
      state.expanded = (element.parentElement as HTMLDetailsElement).open;
    if (['true', 'false'].includes(aria('aria-selected') ?? ''))
      state.selected = aria('aria-selected') === 'true';
    if (
      (control as { required?: boolean }).required === true ||
      aria('aria-required') === 'true'
    )
      state.required = true;
    let userInvalid = false;
    try {
      userInvalid = element.matches(':user-invalid');
    } catch {
      /* Older engines do not support :user-invalid. */
    }
    if (aria('aria-invalid') === 'true' || userInvalid) state.invalid = true;
    if (
      tag === 'textarea' ||
      tag === 'select' ||
      (tag === 'input' && !['checkbox', 'radio'].includes(type))
    )
      state.filled = String(control.value ?? '') !== '';
    const view = this.document.defaultView!;
    const rect = element.getBoundingClientRect();
    state.inViewport =
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < view.innerHeight &&
      rect.left < view.innerWidth;
    return state;
  }

  findUnique(selector: string): Element {
    let matches: Element[];
    try {
      matches = [...this.document.querySelectorAll(selector)].filter(
        (element) => !this.isExcluded(element) && this.isVisible(element),
      );
    } catch {
      throw new PageSquireError(
        'INVALID_SELECTOR',
        'The adapter contains an invalid target selector.',
      );
    }
    if (matches.length !== 1) {
      throw new PageSquireError(
        matches.length ? 'AMBIGUOUS_TARGET' : 'TARGET_MISSING',
        'The adapter must resolve exactly one visible target.',
      );
    }
    return matches[0]!;
  }
}
