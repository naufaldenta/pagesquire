# WebMCP, approvals and WordPress Abilities

Three optional features, all off by default.

## WebMCP bridge

[WebMCP](https://github.com/webmachinelearning/webmcp) lets a page register tools that browser-integrated agents can call through `document.modelContext.registerTool()`. Chrome 149 and Edge 150 run origin trials. In Chrome, you can also turn on `about:flags#enable-webmcp-testing` for local development.

```js
import { exposeToWebMcp } from '@pagesquire/core';

const webmcp = await exposeToWebMcp(runtime, {
  include: (definition) => definition.risk === 'read_only', // optional
});
// Later: webmcp.dispose();
```

- When `document.modelContext` is missing, the bridge does nothing. It never ships a polyfill.
- Each registered capability becomes a tool. The tool name is the capability ID (WebMCP allows dots), and the tool description and input schema are the capability's own.
- Annotations come from the capability's `risk`:
  - `readOnlyHint` is set for `read_only` capabilities.
  - `untrustedContentHint` is always set.
  - `consequentialHint` is set for consequential capabilities. These are exposed only when the runtime has an approval prompt (see below).
- Agent calls take the same path as the PageSquire widget: a fresh observation, schema validation, one action at a time, cancellation, the action time limit and the registered verifier.
- The agent receives only `{status, code, message, evidence}`. It never receives page text, observations or host errors.
- An agent call runs a new observation. A widget proposal that is still pending against an older snapshot then fails as stale and must be re-planned.
- `registerTool` rejects a name another script already registered. That capability is reported in `rejected` and is not overwritten.

## Approval for consequential capabilities

Consequential capabilities stay blocked unless all three of these layers opt in:

1. **Server.** Set `allowConsequential: true` on `ConversationEngine` (Node), `allowConsequential: true` on the PHP `ConversationEngine`, or `PAGESQUIRE_ALLOW_CONSEQUENTIAL=true` in Laravel. The host's own authorization must also allow each ID: `allowedIds`, `capabilityIds`, or the Laravel `pagesquire.capability` gate.
2. **Browser.** Pass an `approve` function to `BrowserRuntime`. Without it, consequential calls still fail with `CONFIRMATION_REQUIRED`, and the client does not offer those IDs to the server.
3. **Person.** Each call waits for an explicit answer. Only `true` runs the handler. A denial, a thrown error or a non-boolean answer returns `cancelled` / `APPROVAL_DENIED`.

```js
import { BrowserRuntime } from '@pagesquire/core';
import { createApprovalPrompt } from '@pagesquire/client';

const runtime = new BrowserRuntime({
  observer,
  registry,
  approve: createApprovalPrompt(widgetHost),
  approvalTimeoutMs: 120000, // default; maximum 600000
});
```

`createApprovalPrompt` renders an inline `alertdialog`:

- All text is set with `textContent`.
- Focus starts on **Deny**, and Escape denies.
- Only one prompt can be open at a time.
- The prompt is excluded from page observation.

The time limit for the action itself starts only after approval, and the snapshot is checked again at that point. `approvalTimeoutMs` bounds the wait (`APPROVAL_TIMEOUT`), and cancelling the conversation closes the prompt.

The client's conversation timeout (`timeoutMs`, 60 seconds by default) still bounds the whole turn, so raise it when people need longer to decide. The server never treats a browser approval as authorization; it is a confirmation step on top of the host's permissions.

## WordPress Abilities (read-only)

WordPress 6.9+ abilities registered with `meta.annotations.readonly === true` can be offered to the assistant:

1. Add the `wordpress.run_ability` adapter to the mapping.
2. Tick the abilities to offer in the dashboard. You can choose up to 20.

Abilities without the read-only annotation are never listed or run.

- **Where abilities run.** They run on the server through `WP_Ability::execute()`, so each ability's own input schema and `permission_callback` apply to the current visitor. The Abilities REST API requires logged-in users, so PageSquire uses its own session-, CSRF- and quota-protected route instead.
- **Every run is checked again.** An ability must still be registered, still selected and still read-only. Output over 16 KB is refused.
- **What the model sees.** The model receives the selected abilities' names, labels, descriptions and input schemas as site context. Browser evidence holds the output, which is withheld (`truncated: true`) when it is over 8 KB. Ability output is untrusted data.
- **Page inspection.** The adapter does not need a per-page inspection. Readiness reports a gap when the adapter is mapped but no ability is selected.
