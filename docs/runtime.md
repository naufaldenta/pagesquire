# Browser runtime integration

This preview supplies a browser engine, not an AI provider or chat interface. The synthetic example shows a complete registry, adapter bindings, and execution loop.

## Initialization

1. Declare capabilities and compile their parameter validators during a trusted build.
2. Install matching execution and verification functions in `CapabilityRegistry`.
3. Create a `PageObserver` with the attached document, an explicit navigation allowlist, and a `canInteract` policy for generic controls.
4. Create `BrowserRuntime` with the observer and registry.
5. Call `runtime.observe()`, select a registered capability, and submit a versioned action with that snapshot ID.
6. Inspect the result status and postcondition evidence before claiming completion.

Use `examples/plain-html/main.ts` as the current runnable integration example. Parameters passed to handlers are immutable. Return only non-sensitive evidence.

## Permissions and targets

Generic observed targets are non-actionable by default. The host callback must explicitly authorize a specific element and interaction (`click` or `fill`). Recheck connectedness, visibility, disabled state, fingerprint, and permission immediately before acting through `resolveTarget`.

`findUnique` is a trusted adapter utility. It rejects zero or multiple visible matches. Selector strings are authored in adapter code, not accepted from a model. Custom handlers remain trusted application code and must obey their declared scope.

The observer works with the main document's DOM and open shadow roots. It does not traverse frames, closed shadow roots or canvas interfaces. Target IDs are stable across snapshots, targets carry state flags, and snapshots report `new` and removed targets; see [generic actions and observation v2](generic-actions.md). Hosts must mark private areas with `data-pagesquire-private`, exclude unrelated regions with `data-pagesquire-ignore`, and mark assistant UI with `data-pagesquire-root`. These attributes can remove data from observation; they do not grant action permissions.

Navigation defaults to the initial pathname. An allowlist callback may permit additional same-origin routes. Foreign origins, non-HTTP(S) schemes, URL credentials, and sensitive query keys (passwords, tokens, signatures, nonces, session IDs and similar) are rejected. Avoid exposing mutating GET routes through this allowlist. `observeUrl` separately selects the pages where the assistant may observe and act; it defaults to the navigation allowlist, so an SPA can keep working on pages it should not navigate to. `redactUrl` rewrites the current page URL sent in snapshots (for example, to drop reset tokens or emails from paths) and must return a same-origin HTTP(S) URL; staleness checks still use the real document URL. A fragment-only `browser.navigate` destination on the current document is verified in place without a navigation checkpoint, because the document never unloads.

## Cancellation and limits

Call `runtime.cancel()` or pass an AbortSignal to `execute`. Configure a bounded action timeout (1–60,000 ms) and action limit (1–1,000). Activity changes can update a widget's thinking indicator. UI activity callback failures do not authorize or interrupt actions.

Handlers must honor `context.signal`, especially after awaiting work and before mutating state. `context.waitFor` supports cooperative polling. JavaScript cannot forcibly undo a side effect or stop arbitrary code that ignores cancellation. Timeouts prevent a late result from being reported as success, but they cannot make an uncooperative handler safe. After a timeout or cancellation, the runtime refuses new actions with `BUSY` until the abandoned handler or verifier settles, for at most one further timeout window, so a late mutation is not credited to the next verifier.

Do not replace an observer snapshot while an action runs. The runtime rejects concurrent actions; duplicate in-flight call IDs share the original result. The bounded replay cache and action budget live for the current runtime instance until `runtime.resetSession()`, which `client.reset()` calls when a new conversation starts. Ordinary action replay protection is not durable across reloads.

## Navigation adapters

The default document adapter supports the standard `browser.navigate` capability. Before navigation it stores minimal same-origin metadata in sessionStorage. After bootstrap on the next document, call `resumeNavigation()` once.

Resumption verifies the destination and registered navigation verifier without executing the navigation handler again. The checkpoint is consumed once and expires after 60 seconds. It contains a call ID, URL, origin, timestamp, and protocol version; no general capability parameters are persisted. sessionStorage is not an authorization mechanism.

For SPA routing, supply `{ mode: 'spa', navigate: async (url, signal) => ... }`. Resolve only after the application's router and destination state are ready. The runtime then executes the registered verifier and returns a fresh observation. Injected adapters are available in `@pagesquire/react/inertia` and `@pagesquire/react/next`. The Next.js destination must explicitly notify readiness from its committed effect, not a loading fallback. Keep the assistant in a persistent layout.

For full-document conversations, opt into `ChatNavigationStore` on the client and call `client.resumeNavigation()` once after destination bootstrap. Do not also consume `runtime.resumeNavigation()` first: the checkpoint has one owner. The client stores only conversation/call IDs, URL/origin, time and remaining round budget, for at most 60 seconds. It preserves no message, page text or provider key. Core `onBeforeNavigate` is a trusted synchronous execution hook used to save that checkpoint before document navigation begins; throwing prevents navigation. Storage failure, expired checkpoints or mismatched destinations cannot authorize an action. See [the client guide](../packages/client/README.md).

## Native controls

`setControlValue` uses the native prototype setter and dispatches bubbling input/change events. It supports value controls, not passwords, files, hidden inputs, checkboxes, radio buttons, or submission controls. Adapter verification must still check the host application's state. The Next.js fixture verifies navigation and heading state, not every framework-controlled form/widget.

## Current support

The local verification target is Chromium on Windows with Node.js 24/PHP 8.3 build/test tooling. Fixtures cover React Strict Mode, Inertia v3 and Next.js 16.4.2 App Router. Windows/Linux CI results are published [per commit](https://github.com/naufaldenta/pagesquire/actions/workflows/ci.yml); consult the exact revision rather than assuming a configured host passed. No iframe, shadow-DOM, live-provider accuracy, screen-reader, production-host or universal WordPress compatibility claim is made by this preview. The separate [WordPress plugin guide](../packages/wordpress/README.md) defines its tested basic-adapter/theme scope. General reload/chat transcript restoration is not implemented; only explicit pending document-navigation continuation is supported.
