# Browser runtime integration

`@pagesquire/core` is the browser engine. It observes the page, runs registered capabilities and verifies their results. It does not include an AI provider or a chat interface. `examples/plain-html/main.ts` is a complete, runnable example with a registry, adapter bindings and the execution loop.

## Initialization

1. Declare capabilities and compile their parameter validators in a trusted build.
2. Install matching execution and verification functions in `CapabilityRegistry`.
3. Create a `PageObserver` with the attached document, an explicit navigation allowlist, and a `canInteract` policy for generic controls.
4. Create `BrowserRuntime` with the observer and registry.
5. Call `runtime.observe()`, select a registered capability, and submit a versioned action with that snapshot ID.
6. Check the result status and postcondition evidence before claiming completion.

Parameters passed to handlers are immutable. Return only non-sensitive evidence.

## Permissions and targets

By default, the runtime cannot act on generic observed targets. The host's `canInteract` callback must explicitly allow a specific element and interaction (`click` or `fill`). Right before acting, `resolveTarget` checks again that the element is still connected, visible, enabled, unchanged and permitted.

`findUnique` is a helper for adapter code. It rejects zero or several visible matches. Selectors are written in adapter code and never taken from the model. Custom handlers are trusted application code and must stay within their declared scope.

### What the observer reads

The observer reads the main document's DOM and open shadow roots. It does not enter frames, closed shadow roots or canvas UIs. Target IDs stay stable across snapshots, targets carry state flags, and snapshots mark `new` and removed targets; see [generic actions and observation v2](generic-actions.md).

Mark up the page with these attributes:

- `data-pagesquire-private` on private areas
- `data-pagesquire-ignore` on unrelated regions
- `data-pagesquire-root` on the assistant's own UI

They only remove content from observation. They never grant permission to act.

### Allowed URLs

Navigation is limited to the starting pathname by default. An allowlist callback can permit more same-origin routes. These are always rejected: foreign origins, non-HTTP(S) schemes, URLs with credentials, and sensitive query keys such as passwords, tokens, signatures, nonces and session IDs. Do not put GET routes that change data on the allowlist.

- `observeUrl` chooses the pages where the assistant may observe and act. It defaults to the navigation allowlist. Set it separately when an SPA should keep working on pages it may not navigate to.
- `redactUrl` rewrites the page URL sent in snapshots, for example to remove reset tokens or email addresses from paths. It must return a same-origin HTTP(S) URL. Staleness checks still use the real URL.
- A `browser.navigate` to a fragment on the current page is verified in place without a navigation checkpoint, because the document never unloads.

## Cancellation and limits

Call `runtime.cancel()` or pass an AbortSignal to `execute`. Set an action timeout (1–60,000 ms) and an action limit (1–1,000). Activity changes can drive a widget's thinking indicator. If that UI callback fails, actions are not affected.

Handlers must honor `context.signal`, especially after awaiting something and before changing state. `context.waitFor` supports cooperative polling. JavaScript cannot undo a side effect or stop code that ignores cancellation. A timeout keeps a late result from being reported as success, but it cannot make an uncooperative handler safe. After a timeout or cancellation, the runtime refuses new actions with `BUSY` until the abandoned handler or verifier settles, for at most one more timeout window, so a late change is not credited to the next action.

The runtime runs one action at a time, and a duplicate in-flight call ID shares the original result. Do not replace the observer's snapshot while an action runs. The replay cache and action budget last for the runtime instance until `runtime.resetSession()`, which `client.reset()` calls when a new conversation starts. This replay protection does not survive a reload.

## Navigation adapters

The default document adapter supports the standard `browser.navigate` capability. Before navigating, it stores minimal same-origin metadata in sessionStorage. On the next document, call `resumeNavigation()` once after bootstrap.

Resuming verifies the destination with the registered navigation verifier, without running the navigation handler again. The checkpoint can be used once and expires after 60 seconds. It holds a call ID, URL, origin, timestamp and protocol version, and no other capability parameters. sessionStorage is not an authorization mechanism.

For SPA routing, pass `{ mode: 'spa', navigate: async (url, signal) => ... }`. Resolve only when the application's router and the destination's state are ready. The runtime then runs the registered verifier and returns a fresh observation. Ready-made adapters are in `@pagesquire/react/inertia` and `@pagesquire/react/next`. A Next.js destination must report readiness from its committed effect, not from a loading fallback. Keep the assistant in a persistent layout.

To continue a conversation across full-document navigation, opt into `ChatNavigationStore` on the client and call `client.resumeNavigation()` once after the destination boots. Do not call `runtime.resumeNavigation()` first: only one of them may consume the checkpoint. The client stores only the conversation and call IDs, the URL and origin, the time and the remaining round budget, for at most 60 seconds. It keeps no messages, page text or provider keys.

Core's `onBeforeNavigate` is a trusted, synchronous hook that saves the checkpoint before navigation starts; if it throws, navigation does not happen. A storage failure, an expired checkpoint or a different destination can never authorize an action. See [the client guide](../packages/client/README.md).

## Native controls

`setControlValue` uses the native prototype setter and dispatches bubbling `input` and `change` events. It handles value controls, but not passwords, files, hidden inputs, checkboxes, radio buttons or submit controls. Adapter verification must still check the application's own state. The Next.js fixture tests navigation and heading state only, not framework-controlled forms and widgets in general.

## Tested environments

Tests run on Chromium on Windows, with Node.js 24 and PHP 8.3 for build and test tooling. Fixtures cover React Strict Mode, Inertia v3 and the Next.js 16.4.2 App Router. Windows and Linux CI results are published [for each commit](https://github.com/naufaldenta/pagesquire/actions/workflows/ci.yml); check the exact revision you use. Iframes, screen readers, live model accuracy and production hosting are not covered by these tests. The [WordPress plugin guide](../packages/wordpress/README.md) describes which adapters and themes the plugin is tested with.

Chat transcripts are not restored after a reload. Only a pending document navigation continues.
