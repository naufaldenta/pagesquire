# Traces and the generic task evaluation

## Conversation traces

`AssistantClient` accepts an `onTrace` hook that receives one event per step:

| Event      | Contents                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------- |
| `message`  | The visitor's message                                                                               |
| `request`  | Snapshot summary: target count, new and removed targets, truncation, plus the result being returned |
| `reply`    | Model latency, whether it finished, its text, and the proposed action                               |
| `progress` | Each runtime stage (checking, executing, verifying …)                                               |
| `result`   | Status, code, duration and evidence                                                                 |
| `error`    | Code and the message shown to the visitor                                                           |

`TraceRecorder` keeps a bounded copy for debugging:

- 500 events by default, at most 5000.
- `toJSON()` exports the events with summary counts.
- By default it redacts content. Message and model text become lengths, parameter and evidence values become `…`, and snapshot URLs lose their query.
- Set `includeContent: true` only in development.

`mountTraceViewer(host, recorder)` renders the trace in the page:

- an accessible, filterable timeline (all, actions, model, errors)
- per-event timing
- **Export JSON** and **Clear** buttons

```js
import { TraceRecorder, mountTraceViewer } from '@pagesquire/client';

const trace = new TraceRecorder();
const client = new AssistantClient({
  runtime,
  transport,
  onTrace: trace.record,
});
mountTraceViewer(devPanel, trace); // developer/admin surfaces only
```

The one-tag embed supports `data-trace="true"`, or `"content"` in development. Its recorder is available as `window.PageSquire.trace`.

Traces never leave the browser unless someone exports them. Treat exports as sensitive: they can contain page content and, with `includeContent`, the visitor's words.

## Generic task evaluation

`scripts/eval-generic.mjs` measures how well an agent completes ordinary browser tasks with the guarded `ui.*` tools, graded automatically from the final page state.

- **36 tasks** on four local fixture pages: the generic fixture, a shop, settings and a todo list. They are defined in `tests/eval/generic-tasks.mjs`.
- **Categories:**
  - forms
  - widgets (tabs, switches, dialogs, shadow DOM)
  - dynamic content
  - multi-step tasks
  - approvals (submit, checkout, delete)
  - recovery (a covered button, a rejected form)
  - `find` (a target beyond the snapshot limit)
  - safety (credential forms, sold-out items, links, a denied account deletion)
- **Grader.** Each task has declarative checks of the final state, such as text, value, checked, hidden, attribute, property, element count or location. The same grader is used for every policy.
- **Simulated visitor.** The harness answers approval prompts as each task specifies (approve, or deny for `delete-denied`).
- **Full stack.** Each task runs the real embed bundle, client, runtime and generic tools in Chromium under a strict CSP. The real `ConversationEngine` runs in-process with `maxRecoveries: 3`.

### Offline self-check (CI)

```sh
npm run test:eval-generic
```

The **oracle** policy replays each task's reference solution: a list of tool calls by target name, sometimes including a deliberate failing step. It makes no provider calls. It must pass every task, so it checks that tasks, fixtures, tools, recovery and the grader all agree.

This self-check found a real defect while it was being built. Snapshots truncated to 100 targets dropped a full-screen cookie banner that sat at the end of the DOM. Targets on screen are now kept first.

Each oracle task also declares how many of its steps are meant to fail (`expectFailures`, default 0). Any other failed action fails the self-check even when the final state is right.

This check caught a verifier that reported a successful checkbox change as failed after the list re-rendered.

Engine options for comparisons:

- `--validate` enables the completion validator.
- `--cache` shares a trajectory cache across tasks.
- `--repeat N` runs the task set N times.

The report records provider calls per task and in total.

### Live model run

```sh
export PAGESQUIRE_PROVIDER=openrouter PAGESQUIRE_API_KEY=… PAGESQUIRE_MODEL=…
npm run eval:generic:live -- --max-calls 80 --tasks type-name,covered-lamp
```

- Live mode needs an explicit `--max-calls` budget. It never retries a provider call.
- Once the budget is used up, it marks the remaining tasks as skipped.
- `--headed` shows the browser.

Reports go to `test-results/eval-generic/report-<mode>-<time>.json`. Each report has:

- success rate, overall and per category
- average actions per task
- for every task: failures, number of actions and failed actions, approvals, duration, the final message and the full trace
- in live mode, provider calls, token usage and failure counts

Live results describe one model, provider and date on these synthetic pages. They are not a general accuracy claim. Compare runs on the same task set and commit, and keep the reports with the commit they measured.
