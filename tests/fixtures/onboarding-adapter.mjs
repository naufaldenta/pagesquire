export function handler0(args, context) {
  context.signal.throwIfAborted();
  context.document.querySelector('#accessibility-panel').hidden = false;
  const control = context.observer.findUnique('#heading-color');
  control.value = args.color;
  control.dispatchEvent(new Event('input', { bubbles: true }));
}
export function verifier0(args, context) {
  const headings = [...context.document.querySelectorAll('main h1, main h2')];
  const sample = context.document.createElement('span');
  sample.style.color = args.color;
  return {
    verified:
      headings.length > 0 &&
      headings.every(
        (heading) => getComputedStyle(heading).color === sample.style.color,
      ),
    evidence: { scope: 'headings' },
  };
}
export function handler1(args, context) {
  context.signal.throwIfAborted();
  context.document
    .querySelector('main')
    .classList.toggle('links-highlighted', args.enabled);
}
export function verifier1(args, context) {
  return {
    verified:
      context.document
        .querySelector('main')
        .classList.contains('links-highlighted') === args.enabled,
  };
}
export function handler2(args, context) {
  context.signal.throwIfAborted();
  context.document.querySelector('#accessibility-panel').hidden = false;
  const control = context.observer.findUnique('#font-weight');
  control.value = String(args.weight);
  control.dispatchEvent(new Event('input', { bubbles: true }));
}
export function verifier2(args, context) {
  return {
    verified:
      getComputedStyle(context.document.body).fontWeight ===
      String(args.weight),
  };
}
