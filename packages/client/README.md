# @pagesquire/client

C4 adds immutable `state.actionProgress` (latest 20 local attempts), `describeActionProgress` and a shared-widget timeline driven by actual runtime events. Navigation suspension/cache replay are not labelled as fresh success. Fixed failure guidance never renders private adapter errors or automatically retries. Busy state is exposed as widget `data-busy`, with `aria-busy` scoped to messages. See [action progress](../../docs/action-progress.md) for custom UI, lifecycle, privacy and rollout limits.

Optional `GuidedTour` and `SpeechOutput` reuse the external widget stylesheet. Tours use host-authored targets and keyboard cancellation; speech starts disabled/local-only. See [assistant driving](../../docs/assistant-driving.md) for lifecycle, speech-queue/privacy limits and six-state Rive mapping. No mascot, microphone or paid speech endpoint is included.

Framework-independent conversation client and accessible DOM widget. Requires the PageSquire protocol/core packages. No API key, framework import, Markdown renderer, or dynamic evaluation is included.

When its runtime has an explicit `AppContext`, the client sends a fresh bounded public projection per round without dropping registered IDs needed for pending results. It checks cancellation after collection, emits safe unavailable feedback and never retries inference automatically. Opted-in fields require matching server schemas; see [app context](../../docs/app-context.md).

`mountInspector(container, inspector)` optionally mounts a separate developer/admin capability inspector using the same external stylesheet. It provides search/status filters, schema disclosures, explicit target refresh and metadata-only JSON for deliberate copying. It runs no actions or AI requests and returns cleanup; no production widget/plugin mount is enabled automatically. Protect the host surface and review [inspection/privacy limits](../../docs/capability-inspector.md).

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

The host supplies `runtime`, `serverGeneratedEndpoint`, and optionally `avatar`. Use your framework's route generator rather than hardcoding the endpoint. Supply a fresh CSRF token, not an AI credential.

`send(message)`, `cancel()`, `reset()`, `state`, and `subscribe(listener)` also support custom UIs. `send` resolves after handling operational errors as safe assistant messages; it rejects invalid user input and concurrent submissions. Subscription state is immutable. `mountWidget` returns cleanup that unsubscribes, removes DOM/listeners, and cancels its active request.

Defaults: 12 server rounds, 60-second conversation timeout, 4,000-character messages, 100 visible messages. Timeout configuration is bounded at 120 seconds. Final messages have emotion metadata; loading stays `thinking` throughout provider and browser work. Emotions are `idle`, `happy`, `sad`, `thinking`, `confused`, and `hover`. Callback failures cannot interrupt execution. No Rive asset/input names are assumed.

The client accepts one action per unfinished response, binds it to the current snapshot, and uses `BrowserRuntime.execute`. Tool-proposal narration is never shown as completed work. Failed/unverified results cannot trigger another browser action. The HTTP transport enforces same-origin POST, credentials, CSRF, redirect refusal, sanitized failures, and a 192-KiB response cap. Chat/page text uses `textContent`, never HTML.

The widget has a labeled input, live conversation log, status, keyboard cancellation with Escape, explicit Stop/New conversation controls, and focus restoration. The supplied CSS is external for restrictive CSPs and is scoped to `.pagesquire-widget`. Screen-reader testing remains a release gate. Localize custom UI via the client API; built-in control labels are English in this beta.

Browser abort does not guarantee that remote inference has stopped. Do not share a runtime between simultaneous clients. Do not store sensitive transcripts in localStorage.

## Full-document navigation continuation

For an approved same-origin multi-page site, pass `navigationStore: new ChatNavigationStore(sessionStorage)` to AssistantClient (import ChatNavigationStore from this package). Mount the same runtime/catalog/client on each permitted destination and then await `client.resumeNavigation()` once. Do not consume runtime.resumeNavigation() separately. Leave this option unset to retain the original stop-and-reopen behavior.

The client saves minimal conversation/call IDs, expected URL/origin, issue time and remaining round budget before the navigation handler changes documents. The core separately saves the navigation verification marker. The destination consumes both once, verifies the actual URL/registered postcondition without executing navigation again, and sends the result to the existing server conversation. No messages, page text, action parameters or provider keys are persisted. Expiry is 60 seconds, per-tab sessionStorage; browser storage is not authorization. Server state still requires session/principal authorization and expiry. Wrong/expired/missing checkpoints fail closed; the user may need a new conversation. General reload restoration and cross-tab chat are not implemented. Storage failure prevents checkpoint-enabled navigation from starting. Default storage names assume one PageSquire instance per tab; provide distinct keys for separately scoped deployments.
