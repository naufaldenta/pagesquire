# Action progress

The widget shows what each browser action is actually doing: checking, executing, verifying and so on. These are real runtime stages, not model reasoning or an estimate of how far along it is. `mountWidget` and the React wrapper show a compact timeline automatically. A custom UI can read `client.state.actionProgress` and format it with `describeActionProgress`.

Progress is for display only. It grants no permission, runs nothing from a partial model response, retries nothing and does not replace the registered verifier.

## Use the shared widget or a custom UI

With a standard `BrowserRuntime`, `AssistantClient` and `mountWidget`, no option is needed. Rebuild your browser assets and import `@pagesquire/client/widget.css`. The `/driving.html` example uses a scripted provider and shows real action progress without any keys.

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

Each `ActionTimelineEntry` has:

- a local attempt `id`, which tells a cache lookup apart from an earlier run with the same call ID
- the protocol `callId`
- the registered `capabilityId`
- the current `stage`, and up to eight observed `stages`
- an optional `code` from a fixed list

The list keeps the **latest 20 attempts per client**, in order. Snapshots are immutable, and the list does not grow when the status repaints.

Entries never contain percentages, time estimates, model thoughts, parameters, evidence, DOM text, URLs or private exception messages. Capability IDs and call IDs do appear, so do not put secrets or personal data in them.

## Stage meanings

| Stage                | Meaning                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checking`           | A new attempt is checking its snapshot, registered capability and parameters. When resuming at a destination, the navigation preflight may already have passed.              |
| `executing`          | The handler has been reached after the authorization, schema and availability checks. The handler may still be preparing the UI; this is not success.                        |
| `verifying`          | The registered verifier has been reached after the handler finished, or on arrival at a destination without running navigation again.                                        |
| `navigation_pending` | Full-document navigation started. The destination is **not verified yet**; a matching continuation must verify it.                                                           |
| `verified`           | The registered postcondition check passed. It does not cover every part of a compound request or later changes to the page.                                                  |
| `unverified`         | The verifier reported that the postcondition does not hold. Changes may already have happened; check the page before another request.                                        |
| `failed`             | A check, the handler or the verifier failed. Only stages actually reached are recorded; a rejection during checks does not add execution or verification stages.             |
| `cancelled`          | Waiting was stopped. Effects already applied or in progress are not rolled back.                                                                                             |
| `timed_out`          | The action or client time limit expired. An uncooperative in-flight handler may still finish; new actions return `BUSY` until it settles or a further timeout window passes. |
| `replayed`           | A recorded result was reused. Nothing ran again and nothing was verified again, even if the cached result was a success.                                                     |

Progress is reported just before the handler or verifier is called, so an observer that cancels at that moment can still prevent the call. There is no preparation stage guessed from cursor animation or model claims. The `thinking` emotion covers waiting for the provider and browser and is separate from action progress.

If the next provider round fails after a verified action, the action stays verified. Cancelled or expired runs ignore late progress, and an old handler cannot overwrite a new run or a reset. Invalid, mismatched or backwards custom progress is ignored. Runtimes without progress callbacks leave the timeline empty instead of inventing stages.

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

Core exports `ActionProgressEvent`, `ActionProgressListener` and the immutable `ACTION_PROGRESS_STAGES` and `ACTION_PROGRESS_CODES`. An event contains only `callId`, `capabilityId`, `stage` and an optional code from the allowlist. Unknown custom error codes appear as `ACTION_FAILED` in progress; the action result itself is unchanged. Event objects are frozen. Errors thrown by listeners are caught, and returned promises are not awaited. There is no global client event subscription that could leak after unmount.

Listeners are trusted code and are not sandboxed. Keep them fast and read-only: a slow one blocks the main thread, and a listener can cancel or cause its own side effects. Do not use them as a second way to execute or authorize anything. Use per-call IDs to follow different calls and replays; one combined stream does not prove the order in which actions completed.

## Recovery, privacy and navigation

`describeActionProgress({stage, code})` returns fixed `{label, message}` text, which you can translate with its optional `messages` argument ([languages](i18n.md)). It distinguishes unavailable app state, stale pages, missing or ambiguous targets, invalid parameters, denied actions, limits, failed verification and navigation mismatches. It never shows raw error messages. Recovery text asks the visitor to check the page or make a **new request**. There are no retry, approve or undo buttons, and no promise of rollback. Consequential actions stay blocked by the runtime and server rules.

Progress lives only in client memory. It is not sent in chat requests, action evidence or provider prompts, and not stored in inspector diagnostics, navigation checkpoints, server transcripts, localStorage or analytics. `client.reset()` clears the list and the visible messages, but not the runtime replay cache, server history or usage budgets. Your own observers, loggers or state persistence may keep it, so review those. See [operations](operations.md) for privacy and erasure.

A full-document navigation discards the old page's timeline. After reading the navigation checkpoint, the destination starts a **verification-only** entry; it does not rebuild the earlier stages. Without continuation, the old page can only show that navigation is pending. SPA navigation stays in the same runtime and shows the real handler and verifier events.

## Integration notes

- Plain JavaScript, PHP, Node and Laravel hosts use the same browser APIs. Backend configuration and database schemas do not change.
- The React wrapper shows the standard widget timeline. A custom React, Inertia or Next.js UI has to render the client state itself.
- The WordPress plugin's widget includes the timeline. It adds no admin screen, action mapping, privilege or provider option.
- `ChatState.actionProgress` is required. Hand-written typed state fixtures must set it to `[]`. Rebuild the core, client and widget assets together.
- The widget's busy attribute is `data-busy="true|false"`. `aria-busy` is set on the message log only, so the polite status next to it is still announced. Other DOM selectors are private and not a styling API.
- Progress does not change the protocol or storage formats. [AppContext](app-context.md) is separate and needs matching server schemas; see [upgrading](upgrading.md).

The timeline is a native ordered list. It can be read with the keyboard, uses text labels as well as color, does not move focus on updates and fits narrow layouts without extra animation. It uses [status semantics](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role) rather than a log role, because entries change in place. It has unit, browser and packaged-consumer tests, but has not been tried with real assistive technology yet.
