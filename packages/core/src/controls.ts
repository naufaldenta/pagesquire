import { PageSquireError } from './errors.js';

export function setControlValue(
  element: Element,
  value: string,
  signal: AbortSignal,
): void {
  signal.throwIfAborted();
  const view = element.ownerDocument.defaultView;
  if (!view || !['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) {
    throw new PageSquireError(
      'UNSUPPORTED_CONTROL',
      'The target is not a supported value control.',
    );
  }
  if (
    element.tagName === 'INPUT' &&
    /^(password|file|hidden|submit|reset|button|checkbox|radio)$/i.test(
      element.getAttribute('type') ?? 'text',
    )
  ) {
    throw new PageSquireError(
      'UNSUPPORTED_CONTROL',
      'This input type is not supported by the value helper.',
    );
  }
  const prototype =
    element.tagName === 'INPUT'
      ? view.HTMLInputElement.prototype
      : element.tagName === 'TEXTAREA'
        ? view.HTMLTextAreaElement.prototype
        : view.HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter)
    throw new PageSquireError(
      'UNSUPPORTED_CONTROL',
      'The control has no native value setter.',
    );
  setter.call(element, value);
  element.dispatchEvent(new view.Event('input', { bubbles: true }));
  signal.throwIfAborted();
  element.dispatchEvent(new view.Event('change', { bubbles: true }));
}
