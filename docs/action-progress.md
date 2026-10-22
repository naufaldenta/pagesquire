# Truthful action progress

C4 exposes operational browser stages, not model reasoning or estimated completion. The standard `mountWidget` and React wrapper show a compact timeline when their client receives runtime events. Custom UIs can read `client.state.actionProgress` and use `describeActionProgress`. Nothing in this feature grants permission, executes a partial model response, retries inference or replaces the registered verifier.

## Use the shared widget or a custom UI

No extra option is needed for a matching `BrowserRuntime` / `AssistantClient` / `mountWidget` installation. Rebuild browser assets and import the existing external `@pagesquire/client/widget.css` stylesheet. The neutral `/driving.html` example uses a deterministic provider and displays real action progress without keys.

```ts
import { describeActionProgress } from '@pagesquire/client';

const unsubscribe = client.subscribe((state) => {
  for (const action of state.actionProgress) {
    const { label, message } = describeActionProgress(action);
    // Render capabilityId, label, message and action.stages with textContent
    // or framework text nodes. Do not turn metadata into HTML or executable UI.
    renderAction(action.id, action.capabilityId, label, message, action.stages);
  }
});
// On teardown: unsubscribe(), unmount your UI and cancel the client as usual.
```

`ActionTimelineEntry` contains a local attempt `id`, protocol `callId`, registered `capabilityId`, current `stage`, up to eight observed `stages`, and an optional fixed-enum `code`. Attempt IDs distinguish a cache lookup from an earlier execution with the same call ID. Entries are ordered and limited to the **latest 20 attempts per client instance**. Subscription snapshots are immutable. The list does not grow with every status repaint.

There is no fabricated percentage, elapsed-time estimate, model thought, parameter dump, evidence, DOM text, URL or private adapter/provider exception in these records. Registered capability IDs and call IDs remain metadata: do not encode secrets/personal information in them.

## Stage meanings

| Stage                | Meaning                                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checking`           | A fresh runtime attempt is checking its snapshot, registered capability and parameters. For destination resumption, the navigation preflight may already have passed. |
| `executing`          | The queued handler boundary has been reached after authorization/schema/availability checks. The handler may still be preparing UI; this is not success.              |
| `verifying`          | The queued registered verifier boundary has been reached after handler completion, or on destination resumption without executing navigation again.                   |
| `navigation_pending` | Full-document navigation started; the destination is **not yet verified**. A matching continuation must perform that verification.                                    |
| `verified`           | The actual registered postcondition returned a valid positive result. It does not certify every part of a compound request or all later page state.                   |
| `unverified`         | The verifier returned a valid negative result. Changes may already exist; inspect the page before another request.                                                    |
| `failed`             | A check, handler or verifier failed. Only reached stages are recorded; preflight rejection does not invent execution/verification.                                    |
| `cancelled`          | Waiting was stopped. Existing/in-flight effects are not rolled back.                                                                                                  |
| `timed_out`          | The action or client time limit expired. An uncooperative in-flight handler may still finish.                                                                         |
| `replayed`           | A recorded result was reused. No new execution or fresh verification is claimed, even if the cached result was successful.                                            |

Callbacks are delivered immediately before handler/verifier invocation; an observer cancelling at that boundary can still prevent invocation. No preparation-specific stage is guessed from cursor animation or a model claim. The existing thinking emotion covers provider/browser waiting and is separate from action evidence.

The client retains a verified result when a subsequent provider round fails. Failure of the follow-up answer is not retroactive action failure. Cancelled/expired runs ignore late progress; a new run/reset cannot be overwritten by an old handler. Invalid/mismatched/regressing custom progress is ignored. Runtimes without progress callbacks leave the timeline empty rather than inventing stages from old result messages.

## Optional host diagnostics

```ts
import { BrowserRuntime } from '@pagesquire/core';

const runtime = new BrowserRuntime({
  observer,
  registry,
  onActionProgress(event) {
    // Read-only metadata for a trusted local UI. Do not upload by default.
    renderOperationalStatus(event);
  },
});
const result = await runtime.execute(call, {
  signal,
  onActionProgress: (event) => renderThisAttempt(event),
});
// Advanced hosts managing their own navigation checkpoint can pass the same
// callback option to runtime.resumeNavigation(). With AssistantClient, use
// client.resumeNavigation() instead; never consume its checkpoint separately.
```

`ActionProgressEvent`, `ActionProgressListener`, immutable `ACTION_PROGRESS_STAGES` and `ACTION_PROGRESS_CODES` are exported from core. Events contain only `callId`, `capabilityId`, `stage` and an optional allowlisted code. Unknown custom error codes become `ACTION_FAILED` in progress, without changing the underlying action-result contract. Event objects are frozen. Global and per-invocation hooks are isolated from thrown/rejected observer errors; their returned promises are not awaited. There is no global client event subscription to leak after unmount.

Hooks are trusted integration code, not a sandbox: a slow callback can block the main thread, and a callback can deliberately cancel or perform its own side effects. It must be fast/read-only, not a second execution/authorization path. Use per-call identifiers when observing different calls/replays; do not assume a single flattened global stream proves completion order.

## Recovery, privacy and navigation

`describeActionProgress({stage, code})` returns fixed English `{label, message}` copy. It distinguishes unavailable app state, stale pages, missing/ambiguous targets, invalid parameters, denied actions, limits, invalid verification and navigation mismatch. It never renders arbitrary raw error messages. Recovery asks the user to inspect state or submit a **new explicit request**; it does not add a retry/approve/undo button or promise rollback. Consequential actions remain blocked by the existing runtime/server contracts.

Progress is client memory only: it is not added to chat requests, action evidence, provider prompts, C2 diagnostics, navigation checkpoints, server transcripts, localStorage or analytics. `client.reset()` clears this list and visible messages, not the runtime replay cache, durable server history or usage budgets. Custom observers/loggers/state persistence can still retain it; review those separately. Existing [privacy and erasure boundaries](operations.md) remain in force.

Full-document navigation discards the previous document's local timeline. The destination starts a **verification-only** entry after consuming existing minimal checkpoints, never a fake reconstruction of prior execution stages. Without continuation, the prior page can only report pending navigation. SPA navigation stays in the same runtime and follows actual handler/verifier events.

## Integration and rollout

- Plain JS/PHP/Node/Laravel hosts use the same browser APIs; their backend configuration/DB schema does not change for C4.
- The React wrapper inherits the standard widget timeline. A custom React/Inertia/Next UI must deliberately render the new client state; existing custom production demos are not automatically restyled or deployed.
- Rebuilt WordPress ZIP assets include the shared widget timeline. No new admin screen, action mapping, privilege or provider option is enabled.
- This alpha adds required `ChatState.actionProgress`; manually authored typed state fixtures must provide `[]`. Rebuild matching core/client/widget assets. The widget busy selector is now `data-busy="true|false"`; `aria-busy` is scoped to the message log so the adjacent polite status is not suppressed. Private DOM selectors are not a stable styling API.
- C4 does not change protocol/storage formats. C3's separate opt-in context still requires matching server schemas; see [upgrading](upgrading.md).

The native ordered timeline is keyboard-readable, uses text labels as well as color, does not steal focus on progress updates, and supports narrow layouts without added animation. Status semantics follow the [ARIA status guidance](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role); the mutating timeline is not mislabelled as an append-only log. Synthetic unit/browser/packed-consumer checks are not a live-model, real assistive-technology, remote-CI or production-host certification. Independent user testing and the existing [beta gates](beta.md) remain open.
