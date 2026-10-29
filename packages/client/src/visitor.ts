import type { VisitorRequest } from '@pagesquire/core';
import { format, resolveMessages } from './i18n.js';
import type { LocaleOptions } from './i18n.js';

export type VisitorPromptOptions = LocaleOptions;

/**
 * Returns a `visitor` function for `BrowserRuntime` that shows ui.ask
 * questions as option buttons, ui.hand_off requests as a "Your turn" panel
 * and PageSquire Link handoffs as a "Continue on partner?" panel listing
 * the partner's origin, the goal and every field, in `host`. When several
 * partners offer the skill, each gets its own block with its origin, its
 * fields and its own Continue button. Only a click on an offered option,
 * "I'm done" or "Continue on …" answers; cancel,
 * Escape, withdrawal and timeouts resolve `null`.
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
    } else if (request.kind === 'link') {
      // Nothing leaves this site until the visitor reads this and continues.
      panel.setAttribute('role', 'alertdialog');
      const name = { name: request.partner.name };
      heading.textContent = request.alternatives?.length
        ? t['visitor.linkChooseTitle']
        : format(
            t[request.back ? 'visitor.returnTitle' : 'visitor.linkTitle'],
            name,
          );
      summary.textContent = request.goal;
      if (!request.alternatives?.length)
        choices.push([
          button(
            format(
              t[
                request.back ? 'visitor.returnContinue' : 'visitor.linkContinue'
              ],
              name,
            ),
          ),
          'continue',
        ]);
    } else {
      // A hand-off leaves the page usable: no focus move, a polite announcement.
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-live', 'polite');
      heading.textContent = t['visitor.handoffTitle'];
      summary.textContent = request.instruction;
      choices.push([button(t['visitor.done']), 'done']);
    }
    panel.append(heading, summary);
    if (request.kind === 'link') {
      const fieldList = (values: Readonly<Record<string, unknown>>) => {
        const list = document.createElement('dl');
        list.className = 'pagesquire-visitor-fields';
        for (const [name, value] of Object.entries(values)) {
          const term = document.createElement('dt');
          term.textContent = name;
          const detail = document.createElement('dd');
          detail.textContent = String(value);
          list.append(term, detail);
        }
        return list.childElementCount ? [list] : [];
      };
      const help = document.createElement('p');
      help.className = 'pagesquire-visitor-help';
      if (request.alternatives?.length) {
        // One block per partner, so the visitor sees what each would receive.
        for (const [index, choice] of [
          request,
          ...request.alternatives,
        ].entries()) {
          const group = document.createElement('div');
          group.className = 'pagesquire-visitor-choice';
          group.setAttribute('role', 'group');
          const label = document.createElement('p');
          label.id = `${id}-choice-${index}`;
          label.className = 'pagesquire-visitor-partner';
          label.textContent = `${choice.partner.name} (${choice.partner.origin})`;
          group.setAttribute('aria-labelledby', label.id);
          const go = button(
            format(t['visitor.linkContinue'], { name: choice.partner.name }),
          );
          choices.push([go, index ? `continue:${index}` : 'continue']);
          group.append(label, ...fieldList(choice.fields), go);
          panel.append(group);
        }
        help.textContent = t['visitor.linkChoiceHelp'];
      } else {
        panel.append(...fieldList(request.fields));
        help.textContent = format(t['visitor.linkOrigin'], {
          origin: request.partner.origin,
        });
      }
      panel.append(help);
    }
    actions.append(
      ...choices
        .map(([element]) => element)
        .filter((element) => !element.parentElement),
      cancel,
    );
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
      if (request.kind !== 'handoff') choices[0]?.[0].focus();
    });
    return pending;
  };
}
