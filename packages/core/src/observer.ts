import { PROTOCOL_VERSION } from '@pagesquire/protocol';
import type { ObservedTarget, PageSnapshot } from '@pagesquire/protocol';
import { PageSquireError } from './errors.js';
import { immutableCopy } from './json.js';

export type Interaction = 'click' | 'fill';

export interface ObserverOptions {
  document: Document;
  canInteract?: (element: Element, interaction: Interaction) => boolean;
  allowUrl?: (url: URL) => boolean;
  maxTextLength?: number;
  maxTargets?: number;
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
const sensitiveQueryKey = /password|token|secret|authorization|api[_-]?key/i;

export class PageObserver {
  readonly document: Document;
  private readonly options: ObserverOptions;
  private readonly origin: string;
  private readonly initialPath: string;
  private snapshot: PageSnapshot | undefined;
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
    this.allowedUrl(initial.href);
  }

  allowedUrl(value: string): URL {
    const url = new URL(value, this.document.URL);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== this.origin ||
      url.username ||
      url.password ||
      [...url.searchParams.keys()].some((key) => sensitiveQueryKey.test(key)) ||
      [...new URLSearchParams(url.hash.slice(1)).keys()].some((key) =>
        sensitiveQueryKey.test(key),
      ) ||
      !(this.options.allowUrl?.(url) ?? url.pathname === this.initialPath)
    ) {
      throw new PageSquireError(
        'URL_NOT_ALLOWED',
        'The destination is outside the configured navigation scope.',
      );
    }
    return url;
  }

  isVisible(element: Element): boolean {
    if (
      !element.isConnected ||
      element.ownerDocument !== this.document ||
      element.closest('[hidden], [inert], [aria-hidden="true"]')
    ) {
      return false;
    }
    if (element.getClientRects().length === 0) return false;
    for (
      let current: Element | null = element;
      current;
      current = current.parentElement
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
      const style = this.document.defaultView!.getComputedStyle(current);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.opacity === '0'
      )
        return false;
    }
    return true;
  }

  isExcluded(element: Element): boolean {
    return Boolean(
      element.closest(excluded) ||
      (element.tagName === 'INPUT' &&
        sensitiveInput.test(element.getAttribute('type') ?? 'text')) ||
      sensitiveAutocomplete.test(element.getAttribute('autocomplete') ?? ''),
    );
  }

  private text(
    root: Element,
    limit: number,
  ): { value: string; truncated: boolean } {
    const walker = this.document.createTreeWalker(root, 4);
    const parts: string[] = [];
    let length = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (
        !parent ||
        this.isExcluded(parent) ||
        parent.closest('input,textarea,select') ||
        !this.isVisible(parent)
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
    const url = this.allowedUrl(this.document.URL);
    const maxText = this.options.maxTextLength ?? 4000;
    const maxTargets = this.options.maxTargets ?? 100;
    const text = this.text(
      this.document.querySelector('main') ?? this.document.body,
      maxText,
    );
    const nodes = this.document.querySelectorAll(
      'a[href],button,input,textarea,select,[role="button"],[role="link"],[data-pagesquire-id]',
    );
    const observed: ObservedTarget[] = [];
    this.targets.clear();
    let truncated = false;
    for (const element of nodes) {
      if (this.isExcluded(element) || !this.isVisible(element)) continue;
      if (observed.length === maxTargets) {
        truncated = true;
        break;
      }
      const id = `target-${observed.length + 1}`;
      const target: ObservedTarget = {
        id,
        tag: element.tagName.toLowerCase().slice(0, 40),
        name: this.name(element),
        role: (
          element.getAttribute('role') ??
          (element.tagName === 'A'
            ? 'link'
            : element.tagName === 'BUTTON'
              ? 'button'
              : 'control')
        ).slice(0, 100),
        disabled:
          element.matches(':disabled') ||
          element.getAttribute('aria-disabled') === 'true',
        actionable:
          this.canInteract(element, 'click') ||
          this.canInteract(element, 'fill'),
      };
      if (element.tagName === 'A') {
        try {
          target.href = this.allowedUrl(
            (element as HTMLAnchorElement).href,
          ).href;
        } catch {
          /* Out-of-scope destinations are not advertised. */
        }
      }
      observed.push(target);
      this.targets.set(id, { element, fingerprint: this.fingerprint(element) });
    }
    const bytes = this.document.defaultView!.crypto.getRandomValues(
      new Uint8Array(16),
    );
    this.snapshot = immutableCopy({
      protocolVersion: PROTOCOL_VERSION,
      id: `snapshot-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`,
      url: url.href,
      title: this.document.title.slice(0, 200),
      text: text.value,
      targets: observed,
      truncated: { text: text.truncated, targets: truncated },
    });
    return this.snapshot;
  }

  requireSnapshot(snapshotId: string): PageSnapshot {
    if (
      !this.snapshot ||
      this.snapshot.id !== snapshotId ||
      this.snapshot.url !== this.document.URL
    ) {
      throw new PageSquireError(
        'STALE_SNAPSHOT',
        'Observe the current page before choosing another action.',
      );
    }
    this.allowedUrl(this.document.URL);
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
