import { PageSquireError } from '@pagesquire/core';
import type { NavigationAdapter } from '@pagesquire/core';

export interface InertiaVisitOptions {
  method: 'get';
  preserveState: boolean;
  onCancelToken: (token: { cancel: () => void }) => void;
  onSuccess: () => void;
  onError: () => void;
  onCancel: () => void;
  onHttpException: () => false;
  onNetworkError: () => false;
  onFinish: () => void;
}
export interface InertiaRouter {
  visit(url: string, options: InertiaVisitOptions): void;
}

/** The caller supplies its installed v3 router. No global router or framework import in core. */
export function createInertiaNavigation(
  router: InertiaRouter,
): NavigationAdapter {
  return {
    mode: 'spa',
    navigate: (url, signal) =>
      new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        let settled = false;
        let token: { cancel: () => void } | undefined;
        const finish = (error?: unknown) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', abort);
          if (error) reject(error);
          else resolve();
        };
        const failure = () =>
          finish(
            new PageSquireError(
              'NAVIGATION_FAILED',
              'The Inertia visit did not complete.',
            ),
          );
        const abort = () => {
          token?.cancel();
          finish(
            signal.reason ??
              new PageSquireError(
                'CANCELLED',
                'The Inertia visit was cancelled.',
              ),
          );
        };
        signal.addEventListener('abort', abort, { once: true });
        try {
          router.visit(url.href, {
            method: 'get',
            preserveState: false,
            onCancelToken: (value) => {
              token = value;
              if (signal.aborted) value.cancel();
            },
            onSuccess: () => finish(),
            onError: failure,
            onCancel: () =>
              finish(
                new PageSquireError(
                  'CANCELLED',
                  'The Inertia visit was cancelled.',
                ),
              ),
            onHttpException: () => {
              failure();
              return false;
            },
            onNetworkError: () => {
              failure();
              return false;
            },
            onFinish: () => {
              if (!settled) failure();
            },
          });
        } catch {
          failure();
        }
      }),
  };
}
