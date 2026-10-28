# @pagesquire/core

Optional `RuntimeOptions.onActionProgress`, `execute(..., {onActionProgress})` and `resumeNavigation({onActionProgress})` expose immutable operational metadata at real handler/verifier boundaries. Fixed stages/codes distinguish failed checks, cache replay, pending navigation, cancellation/timeouts and actual verification; they never grant permission or expose parameters/evidence. See [action progress](../../docs/action-progress.md).

Private development preview of the PageSquire browser foundation.

`AppContext` optionally registers explicit public primitive/enum state and fixed-enum availability checks. Pass it as `BrowserRuntime({ ..., appContext })` with the same registry. Clients read it per round and runtime rechecks before handlers; it never grants permission. See [context/privacy and coordinated rollout](../../docs/app-context.md).

Optional `CapabilityInspector` reads an already valid registry, expected feature IDs and explicit synchronous host target probes. It never invokes actions/verifiers/preparation or grants permission. `exportDiagnostics()` whitelists metadata from the last check. See [capability inspection and privacy limits](../../docs/capability-inspector.md).

Optional `BrowserDriver`, `createControlBindings`, `createPageCapabilities`, `createPageBindings` and `PageObserver.readContent` provide presentation, verified host controls and bounded public reading. See [assistant driving](../../docs/assistant-driving.md). A presenter never clicks or authorizes; handlers still need real postcondition checks.

Exports `CapabilityRegistry`, `PageObserver`, `BrowserRuntime`, navigation helpers, and the native `setControlValue` helper. It imports no React, Inertia, Laravel, or model-provider SDK.

The module can be imported in a server environment without touching a global document. Construct the observer/runtime only with an attached HTTP(S) browser document.

Handlers and verifiers are installed by the website owner. Generic target interaction is denied unless `canInteract` explicitly permits it. Consequential capabilities are blocked unless the runtime has an `approve` prompt and a person approves each call. `exposeToWebMcp` registers capabilities as WebMCP tools when the browser supports them. See [WebMCP, approvals and WordPress Abilities](../../docs/webmcp-and-approval.md).

No package has been published. See the workspace runtime guide for cancellation, navigation, permissions, and current limitations. Foundation code is MIT licensed.
