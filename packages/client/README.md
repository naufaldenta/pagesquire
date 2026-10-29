# @pagesquire/client

The framework-independent conversation client and accessible DOM widget. It depends on the PageSquire protocol and core packages. It includes no API key, framework import, Markdown renderer or dynamic code evaluation.

## Usage

```ts
import {
  AssistantClient,
  createHttpTransport,
  mountWidget,
} from '@pagesquire/client';
import '@pagesquire/client/widget.css';

const client = new AssistantClient({
  runtime, // A host-configured BrowserRuntime with explicit capabilities.
  transport: createHttpTransport({
    endpoint: serverGeneratedEndpoint,
    baseUrl: location.href,
    csrfToken: () => document.querySelector('meta[name="csrf-token"]').content,
  }),
  onEmotionChange: (emotion) => avatar?.setEmotion(emotion),
});
const unmount = mountWidget(document.querySelector('#assistant'), client);
```

The host supplies `runtime`, `serverGeneratedEndpoint` and, optionally, `avatar`. Get the endpoint from your framework's route generator instead of hardcoding it. Pass a fresh CSRF token, never an AI credential.

For a custom UI, use `send(message)`, `cancel()`, `reset()`, `state` and `subscribe(listener)`. `send` turns operational errors into safe assistant messages and then resolves; it rejects invalid input and concurrent submissions. Subscription state is immutable. `mountWidget` returns a cleanup function that unsubscribes, removes the DOM and listeners, and cancels any active request.

## Defaults and behaviour

- 12 server rounds, a 60-second conversation timeout (configurable up to 120 seconds), 4,000-character messages and 100 visible messages.
- Final messages carry an emotion: `idle`, `happy`, `sad`, `thinking`, `confused` or `hover`. The emotion stays `thinking` while the provider and the browser are working. No Rive asset or input names are assumed.
- A failing callback cannot interrupt execution.
- The client accepts one action per unfinished response, binds it to the current snapshot and runs it with `BrowserRuntime.execute`. Narration of a proposed action is never shown as finished work, and a failed or unverified result cannot trigger another browser action.
- The HTTP transport enforces same-origin POST, credentials and CSRF. It refuses redirects, sanitizes failures and caps responses at 192 KiB.
- Chat and page text are rendered with `textContent`, never as HTML.

The widget has a labelled input, a live conversation log, a status line, Escape to cancel, Stop and New conversation buttons, and focus restoration. Its CSS is an external file scoped to `.pagesquire-widget`, so it works under a strict CSP. Built-in text comes in English and Indonesian and follows the page language; override any text with `messages` ([languages](../../docs/i18n.md)). Screen-reader testing is still to be done.

Keep in mind:

- Aborting in the browser does not guarantee that remote inference has stopped.
- Don't share one runtime between clients running at the same time.
- Don't store sensitive transcripts in localStorage.

## Optional features

- **Action progress.** `state.actionProgress` holds the latest 20 local attempts. `describeActionProgress` and the widget's timeline are driven by real runtime events, so a suspended navigation or a cache replay is not shown as a fresh success. Failure guidance uses fixed text, never shows private adapter errors and never retries automatically. The widget exposes busy state as `data-busy`, with `aria-busy` on the message list. See [action progress](../../docs/action-progress.md).
- **Guided tours and speech.** `GuidedTour` and `SpeechOutput` reuse the widget stylesheet. Tours point at targets the host defines and can be cancelled from the keyboard. Speech is off by default and runs locally. No mascot, microphone or paid speech service is included. See [assistant driving](../../docs/assistant-driving.md), which also maps the six emotions to Rive states.
- **App context.** When the runtime has an `AppContext`, the client sends a fresh, bounded public projection each round and keeps any registered IDs that pending results need. It checks for cancellation after collecting, reports unavailability safely and never retries inference on its own. Opted-in fields need matching server schemas; see [app context](../../docs/app-context.md).
- **Capability inspector.** `mountInspector(container, inspector)` mounts a separate developer or admin inspector with the same stylesheet. It offers search and status filters, schema details, a manual target refresh and metadata-only JSON you can copy. It runs no actions or AI requests, returns a cleanup function and is never mounted automatically. Protect the page you put it on, and see [the inspector's privacy limits](../../docs/capability-inspector.md).

## Full-document navigation continuation

For a same-origin site with several pages, pass `navigationStore: new ChatNavigationStore(sessionStorage)` to `AssistantClient` (`ChatNavigationStore` is exported from this package). Mount the same runtime, catalog and client on each allowed destination page, then call `await client.resumeNavigation()` once. Don't call `runtime.resumeNavigation()` separately. If you leave the option unset, the conversation stops on navigation and the visitor reopens it, as before.

Before the navigation handler changes pages, the client saves only what it needs: the conversation and call IDs, the expected URL and origin, the time and the remaining round budget. The core saves its own navigation verification marker. On the destination, both are read once. The client checks the actual URL and the registered postcondition without navigating again, then sends the result to the existing server conversation.

- No messages, page text, action parameters or provider keys are stored.
- Checkpoints live in per-tab sessionStorage and expire after 60 seconds. Browser storage is not authorization: the server still checks the session, the principal and expiry.
- A wrong, expired or missing checkpoint fails closed, and the visitor may need to start a new conversation.
- If storage fails, the navigation does not start.
- Restoring chat after an ordinary reload, and chat across tabs, are not supported.
- The default storage keys assume one PageSquire instance per tab. Give separately scoped deployments their own keys.
