import type { VisitorRequest } from '@pagesquire/core';
import { resolveMessages } from './i18n.js';
import type { LocaleOptions } from './i18n.js';

export type VisitorPromptOptions = LocaleOptions;

/**
 * Returns a `visitor` function for `BrowserRuntime` that shows ui.ask
 * questions as option buttons and ui.hand_off requests as a "Your turn"
 * panel in `host`. Only a click on an offered option, or on "I'm done",
 * answers; cancel, Escape, withdrawal and timeouts resolve `null`.
 * Text is rendered with textContent, never as HTML.
 */
export function createVisitorPrompt(
  host: HTMLElement,
  options: VisitorPromptOptions = {},
): (request: VisitorRequest) => Promise<string | null> {
  let pending: Promise<string | null> | undefined;
  const t = resolveMessages(options, host.ownerDocument);
  return (request) => {
    if (pending) return Promise.resolve(null);
    const document = host.ownerDocument;
    const panel = document.createElement('div');
    panel.className = 'pagesquire-visitor';
    panel.setAttribute('data-pagesquire-root', '');
    panel.setAttribute('data-kind', request.kind);
    const id = `pagesquire-visitor-${Math.random().toString(36).slice(2)}`;
    const heading = document.createElement('p');
    heading.id = `${id}-title`;
    heading.className = 'pagesquire-visitor-title';
    const summary = document.createElement('p');
    summary.id = `${id}-summary`;
    panel.setAttribute('aria-labelledby', heading.id);
    panel.setAttribute('aria-describedby', summary.id);
    const actions = document.createElement('div');
    actions.className = 'pagesquire-visitor-actions';
    const button = (label: string) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.textContent = label;
      return element;
    };
    const cancel = button(t['visitor.cancel']);
    const choices: [HTMLButtonElement, string][] = [];
    if (request.kind === 'choice') {
      // A question blocks the step until answered, like an approval.
      panel.setAttribute('role', 'alertdialog');
      heading.textContent = t['visitor.questionTitle'];
      summary.textContent = request.question;
      for (const option of request.options)
        choices.push([button(option), option]);
    } else {
      // A hand-off leaves the page usable: no focus move, a polite announcement.
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-live', 'polite');
      heading.textContent = t['visitor.handoffTitle'];
      summary.textContent = request.instruction;
      choices.push([button(t['visitor.done']), 'done']);
    }
    actions.append(...choices.map(([element]) => element), cancel);
    panel.append(heading, summary);
    if (request.kind === 'handoff') {
      const help = document.createElement('p');
      help.className = 'pagesquire-visitor-help';
      help.textContent = t['visitor.handoffHelp'];
      panel.append(help);
    }
    panel.append(actions);
    pending = new Promise<string | null>((resolve) => {
      const finish = (answer: string | null) => {
        request.signal.removeEventListener('abort', withdraw);
        panel.remove();
        pending = undefined;
        resolve(answer);
      };
      const withdraw = () => finish(null);
      if (request.signal.aborted) return finish(null);
      request.signal.addEventListener('abort', withdraw, { once: true });
      for (const [element, answer] of choices)
        element.addEventListener('click', () => finish(answer), {
          once: true,
        });
      cancel.addEventListener('click', () => finish(null), { once: true });
      panel.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') finish(null);
      });
      host.append(panel);
      if (request.kind === 'choice') choices[0]?.[0].focus();
    });
    return pending;
  };
}
