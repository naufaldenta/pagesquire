import type { JsonObject, ServerProgressStage } from '@pagesquire/protocol';
import type { ActionProgressStage } from '@pagesquire/core';

/**
 * One step of a conversation as the client saw it. Events can contain the
 * visitor's message, model text, action parameters and evidence, so they are
 * delivered only to the host's local onTrace hook and never uploaded.
 */
export type TraceEvent =
  | { type: 'message'; at: number; text: string }
  | {
      type: 'request';
      at: number;
      requestId: string;
      snapshot: {
        id: string;
        url: string;
        targets: number;
        newTargets: number;
        removedTargets: number;
        truncated: boolean;
      };
      capabilities: number;
      result?: { callId: string; status: string; code: string };
    }
  | {
      type: 'reply';
      at: number;
      requestId: string;
      durationMs: number;
      finished: boolean;
      emotion: string;
      text: string;
      plan?: string[];
      action?: { callId: string; capabilityId: string; parameters: JsonObject };
    }
  | {
      type: 'progress';
      at: number;
      callId: string;
      capabilityId: string;
      stage: ActionProgressStage;
      code?: string;
    }
  | {
      type: 'result';
      at: number;
      callId: string;
      capabilityId: string;
      status: string;
      code: string;
      durationMs: number;
      evidence: JsonObject;
    }
  | { type: 'server'; at: number; stage: ServerProgressStage }
  | { type: 'error'; at: number; code: string; message: string };

export interface TraceRecorderOptions {
  /** Keep at most this many events (default 500, maximum 5000). */
  limit?: number;
  /**
   * Keep message text, model text, parameter values and evidence values.
   * Off by default: only lengths and keys are kept.
   */
  includeContent?: boolean;
}

/** Bounded local trace for debugging; pass `recorder.record` as `onTrace`. */
export class TraceRecorder {
  private readonly events: TraceEvent[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly limit: number;
  private readonly includeContent: boolean;

  constructor(options: TraceRecorderOptions = {}) {
    this.limit = options.limit ?? 500;
    if (!Number.isInteger(this.limit) || this.limit < 1 || this.limit > 5000)
      throw new RangeError('The trace limit must be between 1 and 5000.');
    this.includeContent = options.includeContent === true;
  }

  readonly record = (event: TraceEvent): void => {
    this.events.push(this.includeContent ? event : redact(event));
    if (this.events.length > this.limit) this.events.shift();
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* Viewers cannot break recording. */
      }
    }
  };

  get entries(): readonly TraceEvent[] {
    return structuredClone(this.events);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  clear(): void {
    this.events.length = 0;
    for (const listener of this.listeners) listener();
  }

  /** A JSON export with simple aggregate counts. */
  toJSON(): {
    schemaVersion: 1;
    summary: Record<string, number>;
    events: TraceEvent[];
  } {
    const count = (predicate: (event: TraceEvent) => boolean) =>
      this.events.filter(predicate).length;
    return {
      schemaVersion: 1,
      summary: {
        requests: count((event) => event.type === 'request'),
        actions: count((event) => event.type === 'result'),
        verified: count(
          (event) => event.type === 'result' && event.status === 'success',
        ),
        failed: count(
          (event) => event.type === 'result' && event.status !== 'success',
        ),
        errors: count((event) => event.type === 'error'),
      },
      events: structuredClone(this.events),
    };
  }
}

function redact(event: TraceEvent): TraceEvent {
  const hide = (value: JsonObject): JsonObject =>
    Object.fromEntries(Object.keys(value).map((key) => [key, '…']));
  switch (event.type) {
    case 'message':
      return { ...event, text: `[${[...event.text].length} characters]` };
    case 'reply':
      return {
        ...event,
        text: `[${[...event.text].length} characters]`,
        ...(event.plan ? { plan: event.plan.map(() => '…') } : {}),
        ...(event.action
          ? {
              action: {
                ...event.action,
                parameters: hide(event.action.parameters),
              },
            }
          : {}),
      };
    case 'result':
      return { ...event, evidence: hide(event.evidence) };
    case 'request':
      return {
        ...event,
        snapshot: { ...event.snapshot, url: originOf(event.snapshot.url) },
      };
    default:
      return event;
  }
}

function originOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return '';
  }
}

const describe: Record<TraceEvent['type'], (event: never) => string> = {
  message: (event: Extract<TraceEvent, { type: 'message' }>) =>
    `Visitor: ${event.text}`,
  request: (event: Extract<TraceEvent, { type: 'request' }>) =>
    `Request: ${event.snapshot.targets} targets (${event.snapshot.newTargets} new, ${event.snapshot.removedTargets} removed)${event.snapshot.truncated ? ', truncated' : ''}${event.result ? `; result ${event.result.status} ${event.result.code}` : ''}`,
  reply: (event: Extract<TraceEvent, { type: 'reply' }>) =>
    event.action
      ? `Model proposed ${event.action.capabilityId} ${JSON.stringify(event.action.parameters)} (${event.durationMs} ms)`
      : `Model answered: ${event.text} (${event.durationMs} ms)`,
  progress: (event: Extract<TraceEvent, { type: 'progress' }>) =>
    `  ${event.capabilityId}: ${event.stage}${event.code ? ` ${event.code}` : ''}`,
  result: (event: Extract<TraceEvent, { type: 'result' }>) =>
    `Result ${event.capabilityId}: ${event.status} ${event.code} (${event.durationMs} ms) ${JSON.stringify(event.evidence)}`,
  server: (event: Extract<TraceEvent, { type: 'server' }>) =>
    `  Server: ${event.stage}`,
  error: (event: Extract<TraceEvent, { type: 'error' }>) =>
    `Error ${event.code}: ${event.message}`,
};

/**
 * Explicit developer/admin mount: a readable timeline of a recorder with
 * filtering, export and clear. All text is rendered with textContent.
 */
export function mountTraceViewer(
  container: HTMLElement,
  recorder: TraceRecorder,
): () => void {
  const doc = container.ownerDocument;
  const root = doc.createElement('section');
  root.className = 'pagesquire-inspector pagesquire-trace';
  root.setAttribute('data-pagesquire-root', '');
  root.setAttribute('aria-label', 'PageSquire trace');
  const heading = doc.createElement('h2');
  heading.textContent = 'Conversation trace';
  const summary = doc.createElement('p');
  summary.setAttribute('role', 'status');
  const controls = doc.createElement('div');
  controls.className = 'pagesquire-inspector-controls';
  const label = doc.createElement('label');
  label.textContent = 'Show ';
  const filter = doc.createElement('select');
  for (const value of ['all', 'actions', 'model', 'errors']) {
    const option = doc.createElement('option');
    option.value = value;
    option.textContent = value;
    filter.append(option);
  }
  label.append(filter);
  const exporter = doc.createElement('button');
  exporter.type = 'button';
  exporter.textContent = 'Export JSON';
  const clear = doc.createElement('button');
  clear.type = 'button';
  clear.textContent = 'Clear';
  controls.append(label, exporter, clear);
  const list = doc.createElement('ol');
  list.className = 'pagesquire-trace-events';
  root.append(heading, summary, controls, list);
  container.append(root);
  const shown: Record<string, (event: TraceEvent) => boolean> = {
    all: () => true,
    actions: (event) =>
      event.type === 'progress' ||
      event.type === 'result' ||
      (event.type === 'reply' && Boolean(event.action)),
    model: (event) =>
      event.type === 'reply' ||
      event.type === 'request' ||
      event.type === 'server',
    errors: (event) =>
      event.type === 'error' ||
      (event.type === 'result' && event.status !== 'success'),
  };
  const render = () => {
    const exported = recorder.toJSON();
    const counts = exported.summary;
    summary.textContent = `${counts.requests} requests, ${counts.actions} actions (${counts.verified} verified, ${counts.failed} not), ${counts.errors} errors.`;
    const start = exported.events[0]?.at ?? 0;
    list.replaceChildren(
      ...exported.events
        .filter(shown[filter.value] ?? shown.all!)
        .map((event) => {
          const item = doc.createElement('li');
          item.dataset.type = event.type;
          if (
            event.type === 'error' ||
            (event.type === 'result' && event.status !== 'success')
          )
            item.dataset.problem = 'true';
          item.textContent = `+${((event.at - start) / 1000).toFixed(2)}s ${(
            describe[event.type] as (value: TraceEvent) => string
          )(event)}`.slice(0, 600);
          return item;
        }),
    );
  };
  filter.addEventListener('change', render);
  clear.addEventListener('click', () => recorder.clear());
  exporter.addEventListener('click', () => {
    const view = doc.defaultView;
    if (!view) return;
    const url = view.URL.createObjectURL(
      new view.Blob([JSON.stringify(recorder.toJSON(), null, 2)], {
        type: 'application/json',
      }),
    );
    const link = doc.createElement('a');
    link.href = url;
    link.download = 'pagesquire-trace.json';
    link.click();
    view.setTimeout(() => view.URL.revokeObjectURL(url), 0);
  });
  const unsubscribe = recorder.subscribe(render);
  render();
  return () => {
    unsubscribe();
    root.remove();
  };
}
