# Generic actions, observation v2 and recovery

PageSquire works best with capabilities the site owner registers. Some pages have ordinary controls that nobody mapped, such as forms, filters, dialogs and web components. For those pages, a host can opt in to **generic `ui.*` tools**. They borrow the reliability techniques of browser agents such as Playwright MCP, Browser Use and Claude in Chrome, adapted to an assistant that runs as JavaScript inside the page.

## Observation v2

Snapshots now carry more than text and target names.

- **Stable target IDs.** An element keeps its `target-N` ID across snapshots for as long as it exists. A stale or changed element fails with `STALE_TARGET` rather than being guessed.
- **State flags.** Targets report `checked`, `expanded`, `selected`, `required`, `invalid`, `filled` and `inViewport` when these apply. Field values are never sent; `filled` only says whether a field has a value.
- **Better roles.** Roles are derived from the element: `textbox`, `combobox`, `checkbox`, `radio`, `switch`, `slider` and others.
- **Open shadow DOM.** Targets inside open shadow roots are included. Exclusion and visibility rules cross shadow boundaries.
- **Diffs.** A target that appeared since the previous snapshot is marked `new: true`, and `removedTargets` lists the IDs that disappeared. Each action result's `observation` is diffed against the snapshot that action used, so the model sees exactly what the action changed.
- **`find`.** `observer.find(snapshotId, query, {role})` searches every operable public element, not only the first `maxTargets`. Matches stay addressable in the next snapshot.

Two opt-in observer options add structure. Neither changes the protocol.

- **`outline: true`** starts the snapshot text with a compact outline of visible `h1`–`h3` headings and landmarks (navigation, main, complementary, search, dialogs, and labelled forms), e.g. `[Outline: navigation "Main menu" | main | h1 Shop | h2 Filters]`.
- **`frames: true`** appends the visible text of up to five same-origin iframes, labelled with their `title`. This is read-only: elements inside frames never become targets, and cross-origin, sandboxed and excluded frames are skipped. Acting inside frames needs a browser extension; see the [companion extension design](companion-extension.md).

These are additive optional protocol fields. Deploy the server (Node, PHP, Laravel or WordPress) before or together with the browser bundle, because older servers reject the new fields.

## Generic tools

| Tool            | What it does                                                                                                                  | Verified when                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `ui.find`       | Searches elements by visible name and optional role                                                                           | Always; returns matching target IDs           |
| `ui.click`      | Full pointer sequence, then the element's own activation                                                                      | The page responded (DOM, focus, URL or state) |
| `ui.type`       | Native value setter plus `input`/`change` events, so React and similar libraries see it                                       | The field holds the expected text             |
| `ui.select`     | Chooses a native `<select>` option by label or value                                                                          | The chosen option matches                     |
| `ui.check`      | Sets checkboxes, radios, switches and toggles                                                                                 | The state matches                             |
| `ui.press_key`  | Enter, Escape, Tab, Space, arrows, Home/End, PageUp/PageDown and Backspace                                                    | The page responded                            |
| `ui.hover`      | Pointer-over sequence, e.g. to reveal menus                                                                                   | Always (with response evidence)               |
| `ui.scroll`     | Scrolls by about a screen, or to the top or bottom                                                                            | The position changed or reached the edge      |
| `ui.wait_for`   | Waits until text is visible or hidden                                                                                         | The condition holds                           |
| `ui.ask`        | Asks the visitor to pick one of 2–5 short options                                                                             | The visitor chose an offered option           |
| `ui.hand_off`   | Hands a step to the visitor ("Your turn"), e.g. sign-in, CAPTCHA, a one-time code or payment                                  | The visitor pressed "I'm done"                |
| `ui.switch_tab` | Shows the visitor another tab of the session (companion extension only)                                                       | That tab is in front                          |
| `ui.screenshot` | Opt-in (`createScreenshotCapabilities`): a redacted screenshot of a session tab for a visual check (companion extension only) | The extension returned an image               |

Before a pointer action, each tool scrolls the target into view. It then checks, Playwright-style, that the target is visible, enabled, stable for two frames and not covered by another element (`elementFromPoint`).

After acting, the tool waits for the page to **settle**: a quiet DOM period (300 ms by default, at most 2 s) and no in-flight `fetch`/XHR requests. The quiet period is counted from the last request too. PageSquire's own widget, prompts and cursor never count as the page responding.

Failure codes tell the model what to try next: `TARGET_HIDDEN`, `TARGET_DISABLED`, `TARGET_UNSTABLE`, `TARGET_COVERED`, `LINK_NAVIGATION` (use `browser.navigate`), `UNSUPPORTED_TARGET` and `OPTION_MISSING`. The `OPTION_MISSING` message lists the available options.

```js
import { createGenericBindings, BrowserRuntime } from '@pagesquire/core';
import { createApprovalPrompt } from '@pagesquire/client';

const generic = createGenericBindings();
// Add generic.capabilities to the manifest, and generic.handlers/verifiers
// to the registry bindings. Then:
const observer = new PageObserver({
  document,
  canInteract: (element) => Boolean(element.closest('main')), // the actable region
});
const runtime = new BrowserRuntime({
  observer,
  registry,
  approve: createApprovalPrompt(widgetHost),
  timeoutMs: 8000,
});
```

**Native dialogs.** While a generic action runs, `alert`, `confirm` and `prompt` are wrapped:

- The visitor still sees and answers the real dialog.
- The result evidence records `dialog: {type, message, answer}`, so the model learns what was asked. For `prompt`, it records only whether the visitor answered.

**Re-rendered elements.** Many UIs replace an element after a change, such as a re-rendered list or form. When that happens, `ui.type`, `ui.select` and `ui.check` verify the unique element with the same role and name, instead of reporting a successful action as failed.

## Asking the visitor and handing off

`ui.ask` and `ui.hand_off` pause the action for the visitor. They need a `visitor` prompt on the runtime, such as `createVisitorPrompt(widgetHost)` from the client package. Without one, they fail with `VISITOR_UNAVAILABLE`.

```js
import { createApprovalPrompt, createVisitorPrompt } from '@pagesquire/client';

const runtime = new BrowserRuntime({
  observer,
  registry,
  approve: createApprovalPrompt(widgetHost),
  visitor: createVisitorPrompt(widgetHost),
  visitorTimeoutMs: 300000, // up to 15 minutes, e.g. for a sign-in
});
```

- **Questions** appear as an `alertdialog` with one button per option. Only a click on an offered option answers. The model receives `{answer}`: one of its own options, never free text from the visitor.
- **Hand-offs** appear as a "Your turn" (Indonesian: "Giliranmu") region. It does not move focus, so the visitor can keep using the page. Only "I'm done" counts, and the model then reads the next snapshot. Field values are never sent, so the assistant does not receive what the visitor types.
- **Declining.** Cancel, Escape, a withdrawn call and the time limit fail with `VISITOR_DECLINED` or `VISITOR_TIMEOUT`. The action timer is paused while the visitor answers.

The one-tag embed configures both prompts when `data-generic="true"` is set.

## Guarded mode

Generic tools are off unless the host adds them, and they act only where the host allows.

- **Region.** The observer's `canInteract` policy decides which elements are actionable at all. The embed uses `data-actable`, which defaults to the content root.
- **Built-in risk tiers** (`defaultRisk`):
  - **Denied** inside any form that contains a password, file, payment (`cc-*`) or one-time-code field. Sign-in and payment stay with the visitor.
  - **Approval** for form-submitting buttons, Enter in a form field, any `ui.press_key`, and clicks on elements named like delete, remove, pay, buy, checkout, order, send, submit, confirm, publish or sign out. This also covers Indonesian equivalents.
  - **Allowed** otherwise.
  - `data-pagesquire-risk="allow|approve|deny"` on an element or ancestor overrides the tier, and a custom `risk(element, action)` function replaces it.
- **Approval.** Approval-tier steps call `context.requestApproval`, which shows the runtime's approval prompt and pauses the action timer while the person decides. Without a prompt they fail with `CONFIRMATION_REQUIRED`.
- **Links.** Links to other pages, downloads and new windows are refused, so navigation stays within the `browser.navigate` allowlist and checkpoint.
- **Event trust.** Events are synthetic (`isTrusted=false`). A few sites ignore them, and closed shadow roots and cross-origin iframes are out of reach. Those need a browser extension or CDP.

Because generic tools act on ordinary controls, the model can now do more than a curated catalog allows. Review the actable region and risk tiers for each site, and keep server-side authorization authoritative.

## Server-led recovery

Set `maxRecoveries` (0–5, default 0) on the Node or PHP engine, or `pagesquire.limits.max_recoveries` in Laravel. When an action fails or cannot be verified:

1. The engine keeps the conversation going instead of stopping.
2. It sends the failure code to the model with an instruction to re-read the page and try a different target or approach, or to explain the limitation.

Cancellations always stop the turn. A proposal identical to the last failed one (same capability and parameters) ends the turn instead of looping, and the step and attempt budgets still apply.

On the browser side, set `allowRecovery: true` on `AssistantClient` so it continues after a failed action and shows the model's final explanation. Shared Node/PHP conformance cases cover recovery, repeat detection, the recovery budget and cancellation.

## Typed-data screening

Before a `ui.type` proposal reaches the browser, the Node and PHP engines check the text for emails, links and long digit runs (9 or more digits: phone, account or card numbers). Each of these must appear in the visitor's own messages.

If any does not, the turn ends with "I won't type contact details, links or long numbers that you didn't give me". So text injected into a page cannot make the model enter attacker-chosen contact details, URLs or account numbers.

Dates and short numbers are not affected.

## Completion validator

With `validateCompletion: true` (Node or PHP engine; `pagesquire.limits.validate_completion` in Laravel), the engine asks the provider once more before showing a final answer that follows browser actions. The provider acts as a strict reviewer and decides whether the visitor's request is verifiably complete, from the verified results and the current page.

- An unconfirmed completion is shown with "I could not confirm this is complete: …" and the `confused` emotion, instead of as success.
- A reviewer failure keeps the original answer.
- This costs one extra attempt per acted turn. Skyvern reported a similar validator step as its largest WebVoyager gain.

## Visible plan

With `plan: true` (Node or PHP engine; `pagesquire.limits.plan` in Laravel), the engine asks the provider once per visitor message for a plan before acting.

- **What the visitor sees.** A plan of 2 to 5 short steps is sent as the reply's optional `plan` field with the first action. The widget shows it as a "Plan:" message before that action runs.
- **What the model sees.** The plan is added to the system prompt for later steps of the same request, so the model follows it and adapts when the page differs.
- **Single-step requests** and planner failures get no plan.
- **Cost.** One extra attempt per visitor message.

A plan describes intended steps and never claims progress. Each action is still verified before the model continues. Older clients reject the new `plan` field, so update browser bundles before you enable it.

## Action check

With `checkActions: true` (Node or PHP engine; `pagesquire.limits.check_actions` in Laravel), every model-chosen action that is not `read_only` is reviewed before it reaches the browser. One extra provider call acts as a strict reviewer. It decides whether the action serves the visitor's own request rather than instructions found on the page.

- **Rejected.** The turn stops with "I stopped before acting because that step did not match your request: …".
- **Fail-closed.** A failed or invalid review also stops the turn, because this is a defence against prompt injection.
- **Not reviewed.** Cached replays, which were verified before, and read-only tools such as `ui.find` and `ui.ask`.
- **Cost.** One extra attempt per reviewed action.

This complements the rule-based [typed-data screening](#typed-data-screening). It is not a guarantee against injection. Registered capabilities, guarded regions and approvals stay the primary boundary.

## Trajectory cache

With a `trajectoryCache`, verified turns are replayed without calling the provider.

- **Configuration.**
  - Node: `MemoryTrajectoryCache` or your own implementation.
  - PHP: implement `TrajectoryCache`, or use `MemoryTrajectoryCache` within a worker.
  - Laravel: `pagesquire.trajectory_cache.enabled` uses the application cache store.
- **Key.** The visitor's normalized wording, the page path and the offered capability IDs.
- **Replay.** Targets are resolved again by their unique name in the live snapshot, and every step passes the current authorization, availability and schema checks.
- **Fallback.** An unresolved target, or a step that fails, deletes the entry and hands the turn back to the model, without spending a recovery.
- **What is cached.** Only turns where every action was verified, and that the validator confirmed when it is enabled. Recovered or failed turns are never cached.
- **Privacy.** A step is cached only if any free text in it appears in the visitor's own instruction. Targets must have a unique name, so page-derived data such as another visitor's address is never replayed. Scope a shared cache to visitors who see the same site behaviour.

In the oracle evaluation run twice (`--cache --repeat 2`), the second round replayed 28 of 36 tasks with no provider calls, cutting provider calls by about 79%. The remaining tasks were deliberately not cached: failed, refused or recovered turns, and select options that were not worded in the instruction.

## Real input through the companion extension

Generic tools dispatch synthetic DOM events, so some sites ignore them (`isTrusted` is false). Pass `driver: createCompanionDriver()` to `createGenericBindings`, or add `data-companion="true"` to the embed. Then clicks, typing and keys arrive as real input when the visitor installed the [companion extension](companion-extension.md#development-build-4d-1-to-4d-5) and allowed the site, and the server signs its calls (`signing`). Without them, nothing changes. The extension can also read and act in [cross-origin frames](companion-extension.md#frames-4d-3) the site declares: they appear as `snapshot.frames`, with target IDs such as `frame1-target-3`. Likewise for [other tabs](companion-extension.md#tabs-4d-4) of the same origin that the page opens or the visitor shares: `snapshot.tabs` and `tab2-target-3`, with `ui.switch_tab` to show one. The development build works only on local and `.test` sites.

## One-tag embed

Add `data-generic="true"` (and optionally `data-actable="main"`) to the embed script. The embed then offers the `ui.*` tools, uses the built-in approval and visitor prompts and enables client recovery. Add `data-outline="true"` and `data-frames="true"` for the observer options above, and `data-companion="true"` for real input through the companion extension. With `data-companion`, `data-screenshots="true"` also offers `ui.screenshot` ([screenshots](companion-extension.md#screenshots-4d-5)). The server must load the embed's `manifest.json` and grant the `ui.*` IDs; set `maxRecoveries` there too.
