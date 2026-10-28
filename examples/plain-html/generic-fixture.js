// Local-only fixture behaviour for tests/browser/generic.spec.mjs.
const $ = (selector) => document.querySelector(selector);

$('#name').addEventListener('input', (event) => {
  $('#greeting').textContent = `Hello, ${event.target.value || 'stranger'}`;
});
$('#profile').addEventListener('submit', (event) => {
  event.preventDefault();
  $('#saved').hidden = false;
});
$('#login').addEventListener('submit', (event) => event.preventDefault());
$('#dark-mode').addEventListener('click', (event) => {
  const next = event.currentTarget.getAttribute('aria-checked') !== 'true';
  event.currentTarget.setAttribute('aria-checked', String(next));
});
$('#reset-form').addEventListener('click', () => {
  if (window.confirm('Reset the form?'))
    $('#greeting').textContent = 'Hello, stranger';
});
$('#open-dialog').addEventListener('click', () => {
  $('#dialog').hidden = false;
});
$('#close-dialog').addEventListener('click', () => {
  $('#dialog').hidden = true;
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') $('#dialog').hidden = true;
});
$('#load-more').addEventListener('click', async () => {
  await fetch('/demo.css', { cache: 'no-store' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  for (const index of [2, 3]) {
    const item = document.createElement('li');
    item.textContent = `Item ${index}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `Open item ${index}`;
    item.append(' ', button);
    $('#items').append(item);
  }
});

customElements.define(
  'fixture-widget',
  class extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: 'open' });
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Shadow action';
      const status = document.createElement('span');
      status.textContent = 'Shadow idle';
      button.addEventListener('click', () => {
        status.textContent = 'Shadow done';
        this.setAttribute('data-state', 'done');
      });
      root.append(button, status);
    }
  },
);
