import type { ApprovalRequest } from '@pagesquire/core';
import { resolveMessages } from './i18n.js';
import type { LocaleOptions } from './i18n.js';

export interface ApprovalPromptOptions extends LocaleOptions {
  title?: string;
  approveLabel?: string;
  denyLabel?: string;
  /** Plain-text summary shown to the person; defaults to the capability description and parameters. */
  describe?: (request: ApprovalRequest) => string;
}

/**
 * Returns an `approve` function for `BrowserRuntime` that shows an inline,
 * accessible confirmation in `host`. Only a click on the approve button
 * resolves `true`; deny, cancellation and timeouts resolve `false`.
 * Text is rendered with textContent, never as HTML.
 */
export function createApprovalPrompt(
  host: HTMLElement,
  options: ApprovalPromptOptions = {},
): (request: ApprovalRequest) => Promise<boolean> {
  let pending: Promise<boolean> | undefined;
  const t = resolveMessages(options, host.ownerDocument);
  return (request) => {
    if (pending) return Promise.resolve(false);
    const document = host.ownerDocument;
    const panel = document.createElement('div');
    panel.className = 'pagesquire-approval';
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('data-pagesquire-root', '');
    const id = `pagesquire-approval-${Math.random().toString(36).slice(2)}`;
    const heading = document.createElement('p');
    heading.id = `${id}-title`;
    heading.className = 'pagesquire-approval-title';
    heading.textContent = options.title ?? t['approval.title'];
    const summary = document.createElement('p');
    summary.id = `${id}-summary`;
    let text: string;
    try {
      text = options.describe?.(request) ?? defaultSummary(request);
    } catch {
      text = defaultSummary(request);
    }
    summary.textContent = text;
    panel.setAttribute('aria-labelledby', heading.id);
    panel.setAttribute('aria-describedby', summary.id);
    const actions = document.createElement('div');
    actions.className = 'pagesquire-approval-actions';
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.textContent = options.approveLabel ?? t['approval.approve'];
    const deny = document.createElement('button');
    deny.type = 'button';
    deny.textContent = options.denyLabel ?? t['approval.deny'];
    actions.append(deny, approve);
    panel.append(heading, summary, actions);
    pending = new Promise<boolean>((resolve) => {
      const finish = (approved: boolean) => {
        request.signal.removeEventListener('abort', cancel);
        panel.remove();
        pending = undefined;
        resolve(approved);
      };
      const cancel = () => finish(false);
      if (request.signal.aborted) return finish(false);
      request.signal.addEventListener('abort', cancel, { once: true });
      approve.addEventListener('click', () => finish(true), { once: true });
      deny.addEventListener('click', () => finish(false), { once: true });
      panel.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') finish(false);
      });
      host.append(panel);
      // Focus starts on the safe choice.
      deny.focus();
    });
    return pending;
  };
}

function defaultSummary(request: ApprovalRequest): string {
  const parameters = JSON.stringify(request.parameters);
  return `${request.description}${parameters === '{}' ? '' : ` ${parameters}`}`.slice(
    0,
    1000,
  );
}
