# @pagesquire/core

The browser foundation of PageSquire. It exports `CapabilityRegistry`, `PageObserver`, `BrowserRuntime`, navigation helpers and the native `setControlValue` helper, and imports no React, Inertia, Laravel or model-provider SDK.

You can import the module on a server without touching a global `document`. Construct the observer and runtime only in the browser, with an attached HTTP(S) document.

## Permissions

The website owner installs the handlers and verifiers. Generic interaction with a target is denied unless `canInteract` allows it. Consequential capabilities are blocked unless the runtime has an `approve` prompt and a person approves each call. `exposeToWebMcp` registers capabilities as WebMCP tools when the browser supports them. See [WebMCP, approvals and WordPress Abilities](../../docs/webmcp-and-approval.md).

## Optional features

- **Action progress.** `RuntimeOptions.onActionProgress`, `execute(..., {onActionProgress})` and `resumeNavigation({onActionProgress})` report immutable progress at the real handler and verifier boundaries. Fixed stages and codes tell apart failed checks, cache replay, pending navigation, cancellation, timeouts and actual verification. Progress never grants permission or exposes parameters or evidence. See [action progress](../../docs/action-progress.md).
- **App context.** `AppContext` registers explicit public state (primitive and enum values) and availability checks with fixed enum results. Pass it as `BrowserRuntime({ ..., appContext })` with the same registry. The client reads it every round, and the runtime checks it again before running a handler. It never grants permission. See [app context](../../docs/app-context.md).
- **Capability inspector.** `CapabilityInspector` reads an already valid registry, the feature IDs you expect and explicit synchronous target probes from the host. It never runs actions, verifiers or preparation steps, and never grants permission. `exportDiagnostics()` exports an allowlisted set of metadata from the last check. See [capability inspection](../../docs/capability-inspector.md).
- **Assistant driving.** `BrowserDriver`, `createControlBindings`, `createPageCapabilities`, `createPageBindings` and `PageObserver.readContent` provide on-screen presentation, verified host controls and bounded reading of public content. A presenter never clicks or authorizes anything; handlers still need real postcondition checks. See [assistant driving](../../docs/assistant-driving.md).

Not yet published to npm. See the [runtime guide](../../docs/runtime.md) for cancellation, navigation, permissions and current limits. MIT licensed.
