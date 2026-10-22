# Public app context and contextual availability

C3 lets a host explicitly share a small public semantic projection, such as the current gallery category, selection count or open panel. It also describes when a registered capability is unavailable in the current app state. This is optional, framework-independent and provider-independent. It is **not model training, automatic store/DOM discovery, identity proof or server authorization**.

## Configure the browser runtime

Use the same registry as your real runtime. These state references are host-owned public projections, not an entire application store.

```ts
import { AppContext, BrowserRuntime } from '@pagesquire/core';

const appContext = new AppContext({
  registry,
  fields: {
    view: {
      public: true,
      type: 'enum',
      values: ['gallery', 'article'],
      read: () => publicState.view,
    },
    selected_count: {
      public: true,
      type: 'number',
      min: 0,
      max: 100,
      read: () => publicState.selectedCount,
    },
    settings_open: {
      public: true,
      type: 'boolean',
      read: () => publicState.settingsOpen,
    },
  },
  availability: {
    'accessibility.set_heading_color': () =>
      publicState.settingsDisabled
        ? 'disabled'
        : publicState.settingsOpen
          ? 'available'
          : 'needs_preparation',
  },
});
const runtime = new BrowserRuntime({ registry, observer, appContext });
// Pass runtime to your existing AssistantClient and transport.
```

Omit `appContext` to retain the original request behavior. No field is read at construction. There is no polling, listener, persistent cache or automatic context storage in this helper. `runtime.readAppContext()` / `appContext.snapshot()` explicitly read it; `AssistantClient` does so once before **each** transport round, including action-result continuations. Cancellation is checked after collection and before dispatch.

Read functions must be synchronous, bounded and read-only. In React/Inertia/Next persistent layouts, read current public state through the host's current-state/ref mechanism rather than a stale mount-time closure. Plain JS/PHP/WordPress hosts use the same browser API with a reviewed public projection. Recreate context/runtime together when replacing the registry; mismatched registry instances are rejected. Cancel/dispose the existing assistant on teardown as usual.

## Field types and limits

Every field requires `public: true`, a lowercase name matching `^[a-z][a-z0-9_]{0,63}$`, and a `read` function. Only own data properties are registered; configuration accessors are rejected without evaluating them. Configuration is copied; callbacks can still read live host state.

| Type      | Accepted value / configuration                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| `boolean` | Exactly `true` or `false`.                                                                                           |
| `number`  | Finite number, within optional `min`/`max` and the absolute wire range ±1,000,000,000,000. No coercion.              |
| `enum`    | One of 1–50 unique declared strings, each at most 200 characters.                                                    |
| `string`  | Explicit public text only; default maximum 120 UTF-16 code units, configurable `maxLength` from 1–200. Prefer enums. |

No nested objects, arrays, functions, null, DOM nodes or whole stores can be field values. Represent missing selection with a reviewed enum such as `none` or a Boolean. At most 20 fields and 100 registered availability callbacks are allowed. The serialized envelope is bounded to **16 KiB UTF-8**, including names/statuses; individual limits do not guarantee the combined envelope fits. Throwing, async or invalid field reads produce a fixed `APP_CONTEXT_INVALID` error before transport, without values/private exception messages. Do not truncate a value into a different meaning.

`public: true` is a developer assertion, **not a secret detector**. Do not include credentials, auth/session tokens, personal details, private IDs/content, whole form values or arbitrary store dumps. A permitted name/short string does not prove a value is public. Callbacks are trusted integration code and cannot be sandboxed here: an incorrect one can mutate state, send a request or block the main thread.

## Availability statuses

Only registered capability IDs may have callbacks. There are no model-authored selectors, arbitrary reason strings or executable expressions.

| Status                                                        | Behavior                                                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `available`                                                   | Eligible for an otherwise authorized new proposal, not proof of successful execution.                                        |
| `needs_preparation`                                           | Eligible; the real handler must prepare its UI. A hidden menu does not mean the feature is absent.                           |
| `not_applicable`, `loading`, `requires_selection`, `disabled` | Excluded from the current future-proposal catalog. Explain the required state/selection.                                     |
| `check_failed`                                                | Fail closed for that capability. Throwing, async or invalid-status callbacks become this fixed status without error details. |

No callback means `not_checked` locally and no wire availability entry; existing authorization/verification behavior remains. Callbacks are capability-wide, **not parameter-specific**: do not disable multi-scope reading because one scope is hidden while others remain valid. Parameter-specific checks still belong in the handler/verifier.

The browser rechecks availability **inside the queued handler callback**, after parameter/snapshot checks and before fresh execution. A change while the provider responds cannot bypass it. Denial returns `CAPABILITY_UNAVAILABLE` without running the handler/verifier/presentation. The call stays accounted/replay-protected; a new call after a legitimate state change can run. Identical replay never retries a denied action. Completed navigation is still verified, not replayed or retroactively blocked.

This is a handler-entry check. A handler awaiting preparation/network work must still recheck relevant actual state/permissions immediately before its own side effects. A hint is not an atomic transaction lock.

## Server and model boundary

Node/native PHP engines, the Laravel adapter and the rebuilt WordPress bundle accept the optional envelope after strict schema/semantic validation. Trusted server catalog, principal/session permissions and registered browser IDs remain authoritative. Context can **remove** future candidates; it cannot grant capabilities, lift the consequential-action block, change schemas or reset budgets.

The full registered `capabilityIds` list remains on continuations. If an action disables its button, its result must still match the pending authorized call and be accepted. Filtering applies only to **new proposals**, not pending-result authorization. A provider nevertheless proposing an unavailable capability receives safe HTTP 409 `CAPABILITY_UNAVAILABLE`; its attempt is charged once, with no automatic retry/fallback. Permission denial remains `CAPABILITY_DENIED`. Cached exact replies still require current server permission; the browser performs its fresh local check before execution.

Current context reaches the provider in the latest user-data envelope as `untrustedAppContext`, separately from `untrustedPage`. Availability entries for unauthorized IDs are omitted. System instructions treat values as untrusted data, never commands, identity or proof of success. This deterministic boundary is not a guarantee that every model understands all state or always explains it correctly.

Raw structured context is **not automatically appended to durable history**, action evidence, navigation checkpoints or C2 diagnostics. It is rebuilt each round and stops being sent when omitted. A model can quote a public value in an answer that follows normal transcript retention; custom transports/providers/loggers may also persist requests. Review them, disclose provider transfer and retain existing privacy/erasure policies. This does not make conversation content anonymous.

## Wire compatibility and rollout

`ChatRequest.appContext` has its own `schemaVersion: 1`, `fields` array of `{name,value}` and `availability` array of `{capabilityId,status}`. Unknown properties/types/statuses, duplicate field names/capability IDs, excessive items and over-budget content fail closed. Generated JS/PHP schemas validate structure; `validateAppContext`/`validateChatRequest` and native `ProtocolValidator` also enforce uniqueness and byte limits. Raw-schema-only consumers must perform those semantic checks too.

This is an **opt-in extension** of alpha protocol `0.1`, not a promise that old closed-schema servers accept new fields. Deploy/rebuild matching protocol, core/client and server/PHP/WordPress artifacts before enabling it. Updated servers accept old requests; clients without the option omit it. Old servers reject opted-in requests. No automatic negotiation, silent dropping, fallback or paid retry exists. State envelopes/release version are unchanged; see [API boundaries](api-contract.md).

After `npm run build` / `npm run demo`, `/driving.html` shares only article/panel Booleans and a public heading color. Synthetic browser cases cover per-round updates, pre-handler races and a control disabling after success. No live provider/credential/database is used. WordPress's default widget/setup does not register custom app state or expose a new context-setting screen; custom host integration remains opt-in.
