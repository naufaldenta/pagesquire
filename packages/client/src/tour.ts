import { BrowserDriver, PageObserver, PageSquireError } from '@pagesquire/core';

export interface TourStep {
  target: () => Element;
  text: string;
  prepare?: (signal: AbortSignal) => void | Promise<void>;
}

/** Host-authored steps only. Tour text is never parsed as HTML or selectors. */
export class GuidedTour {
  private readonly lifetime = new AbortController();
  private active: AbortController | undefined;
  private root: HTMLElement | undefined;

  constructor(
    private readonly options: { observer: PageObserver; driver: BrowserDriver },
  ) {}

  async start(
    steps: readonly TourStep[],
    signal?: AbortSignal,
  ): Promise<'completed' | 'cancelled'> {
    if (
      !steps.length ||
      steps.length > 30 ||
      steps.some(
        (step) =>
          typeof step.target !== 'function' ||
          typeof step.text !== 'string' ||
          !step.text.trim() ||
          step.text.length > 1000 ||
          (step.prepare !== undefined && typeof step.prepare !== 'function'),
      )
    )
      throw new PageSquireError(
        'INVALID_OPTIONS',
        'Provide one to thirty explicit, bounded tour steps.',
      );
    if (this.active)
      throw new PageSquireError('BUSY', 'A guided tour is already open.');
    const controller = new AbortController();
    const current = AbortSignal.any([
      controller.signal,
      this.lifetime.signal,
      ...(signal ? [signal] : []),
    ]);
    current.throwIfAborted();
    this.active = controller;
    const doc = this.options.observer.document;
    const previous = doc.activeElement;
    const root = doc.createElement('section');
    root.className = 'pagesquire-tour';
    root.setAttribute('data-pagesquire-root', '');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'PageSquire guided tour');
    const label = doc.createElement('p');
    label.setAttribute('aria-live', 'polite');
    const back = doc.createElement('button'),
      next = doc.createElement('button'),
      stop = doc.createElement('button');
    for (const button of [back, next, stop]) button.type = 'button';
    back.textContent = 'Previous';
    next.textContent = 'Next';
    stop.textContent = 'Stop tour';
    root.append(label, back, next, stop);
    doc.body.append(root);
    this.root = root;
    const stopTour = () => this.cancel();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') this.cancel();
    };
    stop.addEventListener('click', stopTour);
    doc.addEventListener('keydown', escape);
    try {
      let index = 0;
      while (index < steps.length) {
        current.throwIfAborted();
        this.options.observer.allowedUrl(doc.URL);
        const step = steps[index]!;
        back.disabled = true;
        next.disabled = true;
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(current.reason);
          current.addEventListener('abort', abort, { once: true });
          Promise.resolve()
            .then(() => {
              current.throwIfAborted();
              return step.prepare?.(current);
            })
            .then(
              () => {
                current.removeEventListener('abort', abort);
                resolve();
              },
              (error) => {
                current.removeEventListener('abort', abort);
                reject(error);
              },
            );
          if (current.aborted) abort();
        });
        current.throwIfAborted();
        await this.options.driver.present(step.target(), current, 'highlight');
        current.throwIfAborted();
        label.textContent = `${index + 1} / ${steps.length} — ${step.text}`;
        back.disabled = index === 0;
        next.disabled = false;
        next.textContent = index === steps.length - 1 ? 'Finish' : 'Next';
        next.focus({ preventScroll: true });
        const direction = await new Promise<number>((resolve, reject) => {
          const cleanup = () => {
            back.removeEventListener('click', backward);
            next.removeEventListener('click', forward);
            current.removeEventListener('abort', abort);
          };
          const backward = () => {
            cleanup();
            resolve(-1);
          };
          const forward = () => {
            cleanup();
            resolve(1);
          };
          const abort = () => {
            cleanup();
            reject(current.reason);
          };
          back.addEventListener('click', backward);
          next.addEventListener('click', forward);
          current.addEventListener('abort', abort, { once: true });
          if (current.aborted) abort();
        });
        index += direction;
      }
      return 'completed';
    } catch (error) {
      if (current.aborted) return 'cancelled';
      throw error;
    } finally {
      stop.removeEventListener('click', stopTour);
      doc.removeEventListener('keydown', escape);
      root.remove();
      this.root = undefined;
      this.options.driver.clear();
      this.active = undefined;
      if (
        previous instanceof doc.defaultView!.HTMLElement &&
        previous.isConnected
      )
        previous.focus({ preventScroll: true });
    }
  }

  cancel(): void {
    this.active?.abort(
      new PageSquireError('CANCELLED', 'The guided tour was cancelled.'),
    );
  }
  dispose(): void {
    this.lifetime.abort(
      new PageSquireError('CANCELLED', 'The guided tour was disposed.'),
    );
    this.cancel();
    this.root?.remove();
  }
}
