import type { AssistantClient, ChatState } from './client.js';

export interface WidgetOptions {
  title?: string;
  placeholder?: string;
}

export function mountWidget(
  host: HTMLElement,
  client: AssistantClient,
  options: WidgetOptions = {},
): () => void {
  const document = host.ownerDocument;
  const widget = document.createElement('section');
  widget.className = 'pagesquire-widget';
  widget.setAttribute('data-pagesquire-root', '');
  widget.setAttribute('aria-label', options.title ?? 'PageSquire assistant');
  const heading = document.createElement('h2');
  heading.textContent = options.title ?? 'PageSquire';
  const status = document.createElement('p');
  status.className = 'pagesquire-status';
  status.setAttribute('role', 'status');
  const log = document.createElement('div');
  log.className = 'pagesquire-messages';
  log.setAttribute('role', 'log');
  log.setAttribute('aria-label', 'Conversation');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-relevant', 'additions');
  const form = document.createElement('form');
  const label = document.createElement('label');
  const input = document.createElement('textarea');
  const inputId = `pagesquire-${crypto.randomUUID()}`;
  label.htmlFor = inputId;
  label.textContent = 'How can I help with this page?';
  input.id = inputId;
  input.rows = 2;
  input.maxLength = 4000;
  input.placeholder = options.placeholder ?? 'Try “Make headings red”';
  input.required = true;
  const send = document.createElement('button');
  send.type = 'submit';
  send.textContent = 'Send';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Stop';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'New conversation';
  const controls = document.createElement('div');
  controls.className = 'pagesquire-controls';
  controls.append(send, cancel, reset);
  form.append(label, input, controls);
  widget.append(heading, status, log, form);
  host.append(widget);
  let rendered = 0;
  let previousBusy = false;
  const render = (state: ChatState) => {
    widget.dataset.emotion = state.emotion;
    widget.setAttribute('aria-busy', String(state.busy));
    status.textContent = state.busy
      ? 'Thinking… You can stop at any time.'
      : `Ready · ${state.emotion}`;
    input.readOnly = state.busy;
    send.disabled = state.busy;
    reset.disabled = state.busy;
    cancel.disabled = !state.busy;
    if (state.messages.length < rendered || state.messages.length === 100) {
      log.replaceChildren();
      rendered = 0;
    }
    for (const message of state.messages.slice(rendered)) {
      const entry = document.createElement('p');
      entry.className = `pagesquire-message pagesquire-${message.role}`;
      entry.textContent =
        message.role === 'user' ? `You: ${message.text}` : message.text;
      if (message.status) entry.dataset.status = message.status;
      if (message.emotion) entry.dataset.emotion = message.emotion;
      log.append(entry);
    }
    rendered = state.messages.length;
    if (previousBusy && !state.busy && widget.isConnected) input.focus();
    previousBusy = state.busy;
  };
  const unsubscribe = client.subscribe(render);
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const message = input.value;
    if (!message.trim() || client.state.busy) return;
    input.value = '';
    void client.send(message).catch(() => {
      input.value = message;
    });
  };
  const stop = () => client.cancel();
  const startOver = () => {
    client.reset();
    input.focus();
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && client.state.busy) {
      event.preventDefault();
      client.cancel();
    }
  };
  form.addEventListener('submit', submit);
  cancel.addEventListener('click', stop);
  reset.addEventListener('click', startOver);
  widget.addEventListener('keydown', keyboard);
  return () => {
    unsubscribe();
    client.cancel();
    form.removeEventListener('submit', submit);
    cancel.removeEventListener('click', stop);
    reset.removeEventListener('click', startOver);
    widget.removeEventListener('keydown', keyboard);
    widget.remove();
  };
}
