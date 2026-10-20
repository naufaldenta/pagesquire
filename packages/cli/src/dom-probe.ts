import { PageObserver } from '@pagesquire/core';

/** Runs read-only inside an isolated browser. Never returns labels, page text or values. */
export function observePage() {
  const observer = new PageObserver({
    document,
    maxTextLength: 1,
    maxTargets: 300,
  });
  const controls: Array<{
    tag: string;
    role: string;
    selectorHint: string | null;
    matches: number;
    disabled: boolean;
  }> = [];
  for (const element of document.querySelectorAll(
    'button, a[href], input, textarea, select, [role="button"], [data-pagesquire-id]',
  )) {
    if (observer.isExcluded(element) || !observer.isVisible(element)) continue;
    let selectorHint: string | null = null;
    const id = element.getAttribute('data-pagesquire-id') ?? element.id;
    if (
      /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) &&
      !/password|token|secret|private|key|email|phone/i.test(id)
    )
      selectorHint = element.hasAttribute('data-pagesquire-id')
        ? `[data-pagesquire-id="${id}"]`
        : `#${id}`;
    const role = element.getAttribute('role') ?? '';
    const tag = element.tagName.toLowerCase();
    controls.push({
      tag: [
        'button',
        'a',
        'input',
        'textarea',
        'select',
        'div',
        'span',
        'section',
        'label',
      ].includes(tag)
        ? tag
        : 'other',
      role: /^(?:button|link|textbox|checkbox|radio|combobox|switch)$/.test(
        role,
      )
        ? role
        : '',
      selectorHint,
      matches: selectorHint
        ? Math.min(100000, document.querySelectorAll(selectorHint).length)
        : 0,
      disabled: element.matches(':disabled, [aria-disabled="true"]'),
    });
    if (controls.length >= 300) break;
  }
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(
    (element) => !observer.isExcluded(element) && observer.isVisible(element),
  ).length;
  return {
    controls,
    headings: Math.min(1000, headings),
    truncated: controls.length >= 300 || headings > 1000,
  };
}
