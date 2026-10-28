import type { AssistantClient, ChatState } from './client.js';
import { describeActionProgress } from './progress.js';
import { format, resolveMessages } from './i18n.js';
import type { LocaleOptions } from './i18n.js';

export interface WidgetOptions extends LocaleOptions {
  title?: string;
  placeholder?: string;
}

export function mountWidget(
  host: HTMLElement,
  client: AssistantClient,
  options: WidgetOptions = {},
): () => void {
  const document = host.ownerDocument;
  const t = resolveMessages(options, document);
  const widget = document.createElement('section');
  widget.className = 'pagesquire-widget';
  widget.setAttribute('data-pagesquire-root', '');
  widget.setAttribute('aria-label', options.title ?? t['widget.label']);
  const heading = document.createElement('h2');
  heading.textContent = options.title ?? t['widget.title'];
  const status = document.createElement('p');
  status.className = 'pagesquire-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const log = document.createElement('div');
  log.className = 'pagesquire-messages';
  log.setAttribute('role', 'log');
  log.setAttribute('aria-label', t['widget.conversation']);
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-relevant', 'additions');
  const progress = document.createElement('section');
  progress.className = 'pagesquire-action-progress';
  progress.setAttribute('aria-label', t['widget.progress']);
  progress.hidden = true;
  const progressHeading = document.createElement('h3');
  progressHeading.textContent = t['widget.progress'];
  const progressNote = document.createElement('p');
  progressNote.textContent = t['widget.progressNote'];
  progressNote.className = 'pagesquire-progress-note';
  const actions = document.createElement('ol');
  actions.className = 'pagesquire-action-list';
  actions.setAttribute('aria-label', t['widget.recentActions']);
  actions.tabIndex = 0;
  progress.append(progressHeading, progressNote, actions);
  const rows = new Map<
    string,
    {
      row: HTMLLIElement;
      label: HTMLElement;
      stages: HTMLOListElement;
      recovery: HTMLElement;
      count: number;
    }
  >();
  const form = document.createElement('form');
  const label = document.createElement('label');
  const input = document.createElement('textarea');
  const inputId = `pagesquire-${crypto.randomUUID()}`;
  label.htmlFor = inputId;
  label.textContent = t['widget.inputLabel'];
  input.id = inputId;
  input.rows = 2;
  input.maxLength = 4000;
  input.placeholder = options.placeholder ?? t['widget.placeholder'];
  input.required = true;
  const send = document.createElement('button');
  send.type = 'submit';
  send.textContent = t['widget.send'];
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = t['widget.stop'];
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = t['widget.newConversation'];
  const controls = document.createElement('div');
  controls.className = 'pagesquire-controls';
  controls.append(send, cancel, reset);
  form.append(label, input, controls);
  widget.append(heading, status, progress, log, form);
  host.append(widget);
  let rendered = 0;
  let previousBusy = false;
  const render = (state: ChatState) => {
    widget.dataset.emotion = state.emotion;
    // Keep the live status outside the busy message region so progress can be announced.
    widget.dataset.busy = String(state.busy);
    log.setAttribute('aria-busy', String(state.busy));
    const latest = state.actionProgress.at(-1);
    const active =
      latest && ['checking', 'executing', 'verifying'].includes(latest.stage);
    status.textContent = state.busy
      ? active
        ? format(t['widget.statusActing'], {
            stage: describeActionProgress(latest, t).label,
            capability: latest.capabilityId,
          })
        : state.serverStage
          ? format(t['widget.statusServer'], {
              stage: t[`server.${state.serverStage}`],
            })
          : t['widget.statusThinking']
      : format(t['widget.statusReady'], { emotion: state.emotion });
    progress.hidden = !state.actionProgress.length;
    const ids = new Set(state.actionProgress.map((entry) => entry.id));
    for (const [id, value] of rows) {
      if (!ids.has(id)) {
        value.row.remove();
        rows.delete(id);
      }
    }
    for (const entry of state.actionProgress) {
      let value = rows.get(entry.id);
      if (!value) {
        const row = document.createElement('li');
        const name = document.createElement('strong');
        name.className = 'pagesquire-action-name';
        name.textContent = entry.capabilityId;
        const label = document.createElement('span');
        label.className = 'pagesquire-action-outcome';
        const stages = document.createElement('ol');
        stages.className = 'pagesquire-action-stages';
        stages.setAttribute('aria-label', t['widget.observedStages']);
        const recovery = document.createElement('p');
        recovery.className = 'pagesquire-action-guidance';
        row.append(name, label, stages, recovery);
        actions.append(row);
        value = { row, label, stages, recovery, count: 0 };
        rows.set(entry.id, value);
      }
      value.row.dataset.stage = entry.stage;
      const description = describeActionProgress(entry, t);
      value.label.textContent = description.label;
      value.recovery.textContent = description.message;
      for (const stage of entry.stages.slice(value.count)) {
        const step = document.createElement('li');
        step.textContent = describeActionProgress({ stage }, t).label;
        value.stages.append(step);
      }
      value.count = entry.stages.length;
    }
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
        message.role === 'user'
          ? format(t['widget.you'], { text: message.text })
          : message.text;
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
