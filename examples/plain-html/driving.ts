import {
  BrowserDriver,
  BrowserRuntime,
  CapabilityRegistry,
  CapabilityInspector,
  AppContext,
  PageObserver,
  createControlBindings,
  createPageBindings,
} from '@pagesquire/core';
import type { ActionCall, ChatReply, JsonObject } from '@pagesquire/protocol';
import {
  AssistantClient,
  GuidedTour,
  SpeechOutput,
  mountWidget,
  mountInspector,
} from '@pagesquire/client';
// @ts-expect-error Built from this same reviewed host example.
import * as catalog from './driving-capabilities.mjs';
// @ts-expect-error Generated static validators, no unsafe evaluation.
import { parameters } from './dist/driving-bindings.js';
const { drivingManifest, controlDefinition, openDefinition } = catalog;

const observer = new PageObserver({ document, canInteract: () => false });
const driver = new BrowserDriver({ observer });
const article = () => observer.findUnique('#driving-article');
const headings = () => [...document.querySelectorAll<HTMLElement>('main h2')];
const color = document.querySelector<HTMLInputElement>(
  '#driver-heading-color',
)!;
const panel = document.querySelector<HTMLDetailsElement>('#settings')!;
let opens = 0;
color.addEventListener('input', () => {
  for (const heading of headings()) heading.style.color = color.value;
});
document.querySelector('#open-article')!.addEventListener('click', () => {
  document.querySelector<HTMLElement>('#driving-article')!.hidden = false;
  document.querySelector('main')!.setAttribute('data-route', 'article');
  opens++;
});
const controls = createControlBindings([
  {
    definition: controlDefinition,
    target: () => observer.findUnique('#driver-heading-color'),
    prepare: async (_p, context) => {
      if (!panel.open) {
        await context.present(
          observer.findUnique('#settings summary'),
          'click',
        );
        context.signal.throwIfAborted();
        panel.open = true;
      }
    },
    value: (p) => String(p.color),
    isApplied: (p) => {
      const sample = document.createElement('span');
      sample.style.color = String(p.color);
      return (
        headings().length > 0 &&
        headings().every(
          (heading) => getComputedStyle(heading).color === sample.style.color,
        )
      );
    },
  },
  {
    definition: openDefinition,
    target: () => observer.findUnique('#open-article'),
    isApplied: () =>
      document.querySelector('main')!.getAttribute('data-route') === 'article',
  },
]);
const pages = createPageBindings({
  scopes: {
    article: () => article(),
    guide: () => observer.findUnique('#guide'),
  },
  driver,
});
const registry = new CapabilityRegistry(drivingManifest, {
  handlers: { ...controls.handlers, ...pages.handlers },
  verifiers: { ...controls.verifiers, ...pages.verifiers },
  parameters,
});
const runtime = new BrowserRuntime({
  observer,
  registry,
  appContext: new AppContext({
    registry,
    fields: {
      article_open: {
        public: true,
        type: 'boolean',
        read: () =>
          !document.querySelector<HTMLElement>('#driving-article')!.hidden,
      },
      settings_open: { public: true, type: 'boolean', read: () => panel.open },
      heading_color: {
        public: true,
        type: 'string',
        maxLength: 7,
        read: () => color.value,
      },
    },
    availability: {
      [controlDefinition.id]: () =>
        color.disabled
          ? 'disabled'
          : panel.open
            ? 'available'
            : 'needs_preparation',
      [openDefinition.id]: () =>
        document.querySelector<HTMLButtonElement>('#open-article')!.disabled
          ? 'disabled'
          : 'available',
    },
  }),
  presentation: driver,
  timeoutMs: 15000,
});
let probeCalls = 0;
const probe = (selector: string) => () => {
  probeCalls++;
  return [...document.querySelectorAll(selector)];
};
// Inspector probes sample host-selected targets; they do not cover every parameter.
const inspector = new CapabilityInspector({
  registry,
  observer,
  expected: [...registry.list().map((entry) => entry.id), 'site.search'],
  probes: {
    [controlDefinition.id]: {
      resolve: probe('#driver-heading-color'),
      requiresPreparation: true,
    },
    [openDefinition.id]: { resolve: probe('#open-article') },
    'page.read': { resolve: probe('#driving-article') },
    'page.scroll_to': { resolve: probe('#guide') },
    'page.highlight': { resolve: probe('#guide') },
  },
});
let unmountInspector: (() => void) | undefined;
const inspectorButton =
  document.querySelector<HTMLButtonElement>('#toggle-inspector')!;
inspectorButton.setAttribute('aria-expanded', 'false');
inspectorButton.addEventListener('click', () => {
  if (unmountInspector) {
    unmountInspector();
    unmountInspector = undefined;
  } else {
    unmountInspector = mountInspector(
      document.querySelector<HTMLElement>('#capability-inspector')!,
      inspector,
    );
  }
  inspectorButton.textContent = unmountInspector
    ? 'Close capability inspector'
    : 'Open capability inspector';
  inspectorButton.setAttribute(
    'aria-expanded',
    String(Boolean(unmountInspector)),
  );
});
const tour = new GuidedTour({ observer, driver });
const speech = new SpeechOutput({ window, lang: 'en', localOnly: true });
const results: unknown[] = [];
const contexts: unknown[] = [];
const emotions: string[] = [];
let requests = 0;
let plan: 'reading' | 'headings' = 'reading';
const client = new AssistantClient({
  runtime,
  onEmotionChange: (emotion) => {
    emotions.push(emotion);
    document.querySelector('#driving-status')!.textContent = emotion;
  },
  transport: async (request): Promise<ChatReply> => {
    requests++;
    contexts.push(request.appContext);
    const result = request.result;
    if (result) results.push(result);
    const next: { id: string; parameters: JsonObject } | null = !result
      ? plan === 'headings'
        ? { id: controlDefinition.id, parameters: { color: '#c52b28' } }
        : { id: openDefinition.id, parameters: {} }
      : result.capabilityId === openDefinition.id && result.status === 'success'
        ? {
            id: 'page.read',
            parameters: { scope: 'article', mode: 'summary', offset: 0 },
          }
        : null;
    if (next)
      return {
        protocolVersion: '0.1',
        conversationId: 'driving-conversation',
        response: {
          protocolVersion: '0.1',
          text: 'Checking the requested action…',
          emotion: 'thinking',
          finished: false,
          toolCalls: [
            {
              protocolVersion: '0.1',
              callId: crypto.randomUUID(),
              capabilityId: next.id,
              snapshotId: request.snapshot.id,
              parameters: next.parameters,
            },
          ],
        },
      };
    const text =
      result?.status === 'success'
        ? result.capabilityId === 'page.read'
          ? `Synthetic summary from the verified read: ${String(result.evidence.text).slice(0, 200)}. Coverage: ${result.evidence.truncated ? 'partial' : 'complete'}.`
          : 'The registered heading state was verified.'
        : 'The action was not verified; no summary is claimed.';
    return {
      protocolVersion: '0.1',
      conversationId: 'driving-conversation',
      response: {
        protocolVersion: '0.1',
        text,
        emotion: result?.status === 'success' ? 'happy' : 'confused',
        finished: true,
        toolCalls: [],
      },
    };
  },
});
mountWidget(document.querySelector<HTMLElement>('#driver-chat')!, client);
async function run(message: string, kind: 'reading' | 'headings') {
  plan = kind;
  await client.send(message);
  document.querySelector('#driving-result')!.textContent = JSON.stringify(
    results,
    null,
    2,
  );
}
document.querySelector('#open-summary')!.addEventListener('click', () => {
  void run('Open the article, read it and summarize it.', 'reading');
});
document.querySelector('#change-headings')!.addEventListener('click', () => {
  void run('Make headings red without changing body text.', 'headings');
});
document.querySelector('#cancel-driving')!.addEventListener('click', () => {
  client.cancel();
  runtime.cancel();
  tour.cancel();
  speech.cancel();
});
document.querySelector('#start-tour')!.addEventListener('click', () => {
  void tour.start([
    {
      target: () => observer.findUnique('#guide'),
      text: 'Registered public reading scope.',
    },
    {
      target: () => observer.findUnique('#settings summary'),
      text: 'Host-owned accessibility controls. Nothing is clicked by the tour.',
    },
  ]);
});
document.querySelector('#speak-answer')!.addEventListener('click', () => {
  speech.setEnabled(true);
  const answer = client.state.messages
    .filter((message) => message.role === 'assistant')
    .at(-1);
  if (answer) void speech.speak(answer.text);
});
async function call(capabilityId: string, values: JsonObject = {}) {
  const snapshot = runtime.observe();
  const input: ActionCall = {
    protocolVersion: '0.1',
    callId: crypto.randomUUID(),
    capabilityId,
    snapshotId: snapshot.id,
    parameters: values,
  };
  return runtime.execute(input);
}
Object.assign(window, {
  pagesquireDriving: {
    runtime,
    observer,
    driver,
    client,
    tour,
    speech,
    inspector,
    get probeCalls() {
      return probeCalls;
    },
    call,
    results,
    contexts,
    emotions,
    get opens() {
      return opens;
    },
    get requests() {
      return requests;
    },
  },
});
window.addEventListener(
  'pagehide',
  () => {
    client.cancel();
    runtime.cancel();
    tour.dispose();
    speech.dispose();
    driver.dispose();
    unmountInspector?.();
  },
  { once: true },
);
