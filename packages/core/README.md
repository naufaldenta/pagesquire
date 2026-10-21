# @pagesquire/core

Private development preview of the PageSquire browser foundation.

Optional `BrowserDriver`, `createControlBindings`, `createPageCapabilities`, `createPageBindings` and `PageObserver.readContent` provide presentation, verified host controls and bounded public reading. See [assistant driving](../../docs/assistant-driving.md). A presenter never clicks or authorizes; handlers still need real postcondition checks.

Exports `CapabilityRegistry`, `PageObserver`, `BrowserRuntime`, navigation helpers, and the native `setControlValue` helper. It imports no React, Inertia, Laravel, or model-provider SDK.

The module can be imported in a server environment without touching a global document. Construct the observer/runtime only with an attached HTTP(S) browser document.

Handlers and verifiers are installed by the website owner. Generic target interaction is denied unless `canInteract` explicitly permits it. Consequential capabilities are blocked in this preview.

No package has been published. See the workspace runtime guide for cancellation, navigation, permissions, and current limitations. Foundation code is MIT licensed.
