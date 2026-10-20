import { PageSquireError } from '@pagesquire/core';
import type { NavigationAdapter } from '@pagesquire/core';

export interface NextRouter {
  push(href: string, options?: { scroll?: boolean }): void;
}
export interface NextNavigation extends NavigationAdapter {
  /** Call from the destination's ready/committed client effect, not from a loading fallback. */
  committed(url: string): void;
}
/** Injection keeps framework internals and server-only modules out of the browser runtime. */
export function createNextNavigation(
  router: NextRouter,
  options: { document: Document; timeoutMs?: number },
): NextNavigation {
  const timeout = options.timeoutMs ?? 10000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60000)
    throw new PageSquireError('INVALID_OPTIONS', 'Invalid navigation timeout.');
  let pending:
    | {
        expected: string;
        resolve: () => void;
        reject: (reason: unknown) => void;
      }
    | undefined;
  return {
    mode: 'spa',
    navigate(url, signal) {
      signal.throwIfAborted();
      const current = new URL(options.document.URL);
      if (
        url.origin !== current.origin ||
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return Promise.reject(
          new PageSquireError(
            'URL_DENIED',
            'Navigate only to a permitted same-origin URL.',
          ),
        );
      if (pending)
        return Promise.reject(
          new PageSquireError('BUSY', 'A navigation is already pending.'),
        );
      if (url.href === current.href) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const finish = (error?: unknown) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          pending = undefined;
          if (error) reject(error);
          else resolve();
        };
        const abort = () =>
          finish(
            new PageSquireError(
              'CANCELLED',
              'Navigation waiting was cancelled.',
            ),
          );
        const timer = setTimeout(
          () =>
            finish(
              new PageSquireError(
                'TIMEOUT',
                'The destination did not report readiness.',
              ),
            ),
          timeout,
        );
        pending = {
          expected: url.href,
          resolve: () => finish(),
          reject: (error) => finish(error),
        };
        signal.addEventListener('abort', abort, { once: true });
        try {
          router.push(url.pathname + url.search + url.hash, { scroll: true });
        } catch (error) {
          finish(error);
        }
      });
    },
    committed(value) {
      if (!pending) return;
      let actual: URL;
      try {
        actual = new URL(value, options.document.URL);
      } catch {
        return;
      }
      if (actual.href !== options.document.URL) return;
      if (actual.href !== pending.expected)
        pending.reject(
          new PageSquireError(
            'NAVIGATION_MISMATCH',
            'The committed destination did not match the requested route.',
          ),
        );
      else pending.resolve();
    },
  };
}
