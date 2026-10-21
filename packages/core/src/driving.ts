import { PageSquireError } from './errors.js';
import type { PageObserver } from './observer.js';

export type PresentationKind = 'click' | 'fill' | 'highlight';

export interface ActionPresentation {
  present(
    target: Element,
    signal: AbortSignal,
    kind?: PresentationKind,
  ): Promise<void>;
  clear(): void;
}

export interface BrowserDriverOptions {
  observer: PageObserver;
  durationMs?: number;
  motion?: 'system' | 'none';
}

/** Optional presentation only: this helper never clicks, fills or authorizes. */
export class BrowserDriver implements ActionPresentation {
  private readonly observer: PageObserver;
  private readonly duration: number;
  private readonly motion: 'system' | 'none';
  private readonly lifetime = new AbortController();
  private overlay: HTMLElement | undefined;
  private animation: Animation | undefined;
  private active = false;
  private highlighted: Element | undefined;
  private x = 16;
  private y = 16;

  constructor(options: BrowserDriverOptions) {
    this.observer = options.observer;
    this.duration = options.durationMs ?? 240;
    this.motion = options.motion ?? 'system';
    if (
      !Number.isInteger(this.duration) ||
      this.duration < 0 ||
      this.duration > 1500 ||
      !['system', 'none'].includes(this.motion)
    ) {
      throw new PageSquireError(
        'INVALID_OPTIONS',
        'Configure a bounded driver duration and motion preference.',
      );
    }
  }

  private get view(): Window & typeof globalThis {
    return this.observer.document.defaultView!;
  }

  private get milliseconds(): number {
    return this.motion === 'none' ||
      this.view.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : this.duration;
  }

  private target(element: Element): void {
    if (
      element.ownerDocument !== this.observer.document ||
      !element.isConnected ||
      this.observer.isExcluded(element) ||
      !this.observer.isVisible(element)
    ) {
      throw new PageSquireError(
        'TARGET_MISSING',
        'Presentation requires one visible, public, attached host target.',
      );
    }
  }

  private async work(
    signal: AbortSignal,
    run: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    if (this.active)
      throw new PageSquireError(
        'BUSY',
        'The presentation helper is already active.',
      );
    const combined = AbortSignal.any([signal, this.lifetime.signal]);
    combined.throwIfAborted();
    this.active = true;
    this.clear();
    try {
      await run(combined);
      combined.throwIfAborted();
    } catch (error) {
      this.clear();
      throw error;
    } finally {
      this.active = false;
    }
  }

  private async tween(
    signal: AbortSignal,
    update: (fraction: number) => void,
  ): Promise<void> {
    signal.throwIfAborted();
    const duration = this.milliseconds;
    if (!duration) {
      update(1);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const start = this.view.performance.now();
      let frame = 0;
      const abort = () => {
        this.view.cancelAnimationFrame(frame);
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      const tick = (now: number) => {
        if (signal.aborted) {
          abort();
          return;
        }
        const progress = Math.min(1, (now - start) / duration);
        try {
          update(1 - Math.pow(1 - progress, 3));
        } catch (error) {
          signal.removeEventListener('abort', abort);
          reject(error);
          return;
        }
        if (progress < 1) frame = this.view.requestAnimationFrame(tick);
        else {
          signal.removeEventListener('abort', abort);
          resolve();
        }
      };
      frame = this.view.requestAnimationFrame(tick);
    });
  }

  private async reveal(
    element: Element,
    signal: AbortSignal,
    end = false,
    alignEdge = false,
  ): Promise<void> {
    this.target(element);
    const containers: Element[] = [];
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (
        parent === this.observer.document.scrollingElement ||
        /(auto|scroll)/.test(this.view.getComputedStyle(parent).overflowY)
      )
        containers.push(parent);
    }
    const documentScroller = this.observer.document.scrollingElement;
    if (documentScroller && !containers.includes(documentScroller))
      containers.push(documentScroller);
    for (const container of containers) {
      signal.throwIfAborted();
      this.target(element);
      const rect = element.getBoundingClientRect();
      const isDocument = container === documentScroller;
      const box = isDocument
        ? { top: 0, height: this.view.innerHeight }
        : container.getBoundingClientRect();
      const from = container.scrollTop;
      const offset = end
        ? rect.bottom - box.top - box.height + (alignEdge ? 0 : 16)
        : rect.top - box.top - (alignEdge ? 0 : Math.min(64, box.height / 4));
      const to = Math.max(
        0,
        Math.min(
          container.scrollHeight - container.clientHeight,
          from + offset,
        ),
      );
      if (Math.abs(to - from) < 1) continue;
      await this.tween(signal, (fraction) => {
        this.target(element);
        container.scrollTo({
          top: from + (to - from) * fraction,
          behavior: 'instant',
        });
      });
    }
  }

  async scrollTo(
    target: Element,
    signal: AbortSignal,
    position: 'start' | 'end' = 'start',
  ): Promise<void> {
    if (!['start', 'end'].includes(position))
      throw new PageSquireError(
        'INVALID_PARAMETERS',
        'Unknown scroll position.',
      );
    await this.work(signal, (current) =>
      this.reveal(target, current, position === 'end', true),
    );
  }

  async present(
    target: Element,
    signal: AbortSignal,
    kind: PresentationKind = 'highlight',
  ): Promise<void> {
    if (!['click', 'fill', 'highlight'].includes(kind))
      throw new PageSquireError(
        'INVALID_PARAMETERS',
        'Unknown presentation kind.',
      );
    await this.work(signal, async (current) => {
      await this.reveal(target, current);
      this.target(target);
      const doc = this.observer.document;
      const overlay = doc.createElement('div');
      overlay.className = 'pagesquire-driving';
      overlay.setAttribute('data-pagesquire-ignore', '');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.pointerEvents = 'none';
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.zIndex = '2147483000';
      const cursor = doc.createElement('div');
      cursor.className = 'pagesquire-driving__cursor';
      cursor.textContent = '➤';
      const label = doc.createElement('span');
      label.textContent = 'PageSquire';
      cursor.append(label);
      const ring = doc.createElement('div');
      ring.className = 'pagesquire-driving__target';
      const rect = target.getBoundingClientRect();
      Object.assign(ring.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      overlay.append(ring, cursor);
      doc.body.append(overlay);
      this.overlay = overlay;
      this.highlighted = target;
      const x = Math.max(
        8,
        Math.min(this.view.innerWidth - 32, rect.left + rect.width / 2),
      );
      const y = Math.max(
        8,
        Math.min(
          this.view.innerHeight - 32,
          rect.top + Math.min(rect.height / 2, 32),
        ),
      );
      const fromX = this.x,
        fromY = this.y;
      await this.tween(current, (fraction) => {
        this.target(target);
        this.x = fromX + (x - fromX) * fraction;
        this.y = fromY + (y - fromY) * fraction;
        cursor.style.transform = `translate(${this.x}px, ${this.y}px)`;
      });
      if (
        kind === 'click' &&
        this.milliseconds &&
        typeof ring.animate === 'function'
      ) {
        const animation = ring.animate(
          [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }],
          { duration: this.milliseconds },
        );
        this.animation = animation;
        const abort = () => animation.cancel();
        current.addEventListener('abort', abort, { once: true });
        try {
          await animation.finished;
        } finally {
          current.removeEventListener('abort', abort);
          animation.cancel();
          this.animation = undefined;
        }
      }
      current.throwIfAborted();
    });
  }

  /** A bounded visual scan, not proof that all lazy-loaded content was read. */
  async scan(target: Element, signal: AbortSignal, steps = 4): Promise<void> {
    if (!Number.isInteger(steps) || steps < 1 || steps > 8)
      throw new PageSquireError(
        'INVALID_OPTIONS',
        'Scan steps must be between one and eight.',
      );
    await this.work(signal, async (current) => {
      this.target(target);
      if (!this.milliseconds) return;
      const positions = new Map<Element, number>();
      for (let node: Element | null = target; node; node = node.parentElement)
        positions.set(node, node.scrollTop);
      const scroller = this.observer.document.scrollingElement;
      if (scroller) positions.set(scroller, scroller.scrollTop);
      await this.reveal(target, current);
      for (let index = 1; index <= steps; index++) {
        current.throwIfAborted();
        this.target(target);
        const rect = target.getBoundingClientRect();
        const from = scroller?.scrollTop ?? 0;
        const distance = Math.max(0, rect.height - this.view.innerHeight / 2);
        const to = Math.max(
          0,
          Math.min(
            (scroller?.scrollHeight ?? 0) - this.view.innerHeight,
            from + rect.top + (distance * index) / steps,
          ),
        );
        if (scroller)
          await this.tween(current, (fraction) => {
            this.target(target);
            scroller.scrollTo({
              top: from + (to - from) * fraction,
              behavior: 'instant',
            });
          });
      }
      for (const [node, top] of positions) {
        current.throwIfAborted();
        if (node.isConnected) node.scrollTo({ top, behavior: 'instant' });
      }
    });
  }

  clear(): void {
    this.animation?.cancel();
    this.animation = undefined;
    this.overlay?.remove();
    this.overlay = undefined;
    this.highlighted = undefined;
  }

  isPresenting(target: Element): boolean {
    if (
      this.highlighted !== target ||
      !this.overlay?.isConnected ||
      !target.isConnected ||
      this.observer.isExcluded(target) ||
      !this.observer.isVisible(target)
    )
      return false;
    const ring = this.overlay.querySelector('.pagesquire-driving__target');
    if (!ring || ring.getClientRects().length === 0) return false;
    // Decorative aria-hidden overlays need visual, not accessibility-tree checks.
    for (let node: Element | null = ring; node; node = node.parentElement) {
      const style = this.view.getComputedStyle(node);
      if (
        node.hasAttribute('hidden') ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.opacity === '0' ||
        style.contentVisibility === 'hidden'
      )
        return false;
    }
    const rect = ring.getBoundingClientRect();
    const style = this.view.getComputedStyle(ring);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < this.view.innerHeight &&
      rect.left < this.view.innerWidth &&
      style.outlineStyle !== 'none' &&
      Number.parseFloat(style.outlineWidth) >= 1 &&
      style.outlineColor !== 'transparent' &&
      !/rgba\([^)]*,\s*0\s*\)$/.test(style.outlineColor)
    );
  }

  dispose(): void {
    this.lifetime.abort(
      new PageSquireError('CANCELLED', 'The presentation helper was disposed.'),
    );
    this.clear();
  }
}
