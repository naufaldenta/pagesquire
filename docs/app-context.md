# Public app context and contextual availability

AppContext lets a host share a small, public summary of its app state with the assistant, such as the current gallery category, how many items are selected or which panel is open. It can also say when a registered capability is unavailable in the current state. It is optional and works with any framework and provider.

AppContext does not train the model, discover state on its own, prove identity or authorize anything on the server.

## Configure the browser runtime

Use the same registry as your real runtime. The values you read are public summaries that your app owns, not the whole application store.

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

Leave out `appContext` to keep the original request format. Nothing is read at construction, and there is no polling, listener or cache. `runtime.readAppContext()` and `appContext.snapshot()` read the fields on demand. `AssistantClient` reads them once before **every** transport round, including continuations after an action result. Cancellation is checked after reading and before sending.

Read functions must be synchronous, quick and read-only. In persistent React, Inertia or Next.js layouts, read current state through a ref or your app's current-state mechanism, not a closure captured at mount. Plain JavaScript, PHP and WordPress hosts use the same browser API. When you replace the registry, create the context and runtime again together; a context built for a different registry is rejected. Cancel or dispose the assistant on teardown as usual.

## Field types and limits

Every field needs `public: true`, a lowercase name matching `^[a-z][a-z0-9_]{0,63}$`, and a `read` function. Only own data properties are registered; accessor properties in the configuration are rejected without being called. The configuration is copied, but callbacks still read live host state.

| Type      | Accepted value / configuration                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------- |
| `boolean` | Exactly `true` or `false`.                                                                                           |
| `number`  | Finite number, within optional `min`/`max` and the absolute wire range ±1,000,000,000,000. No coercion.              |
| `enum`    | One of 1–50 unique declared strings, each at most 200 characters.                                                    |
| `string`  | Explicit public text only; default maximum 120 UTF-16 code units, configurable `maxLength` from 1–200. Prefer enums. |

Values cannot be nested objects, arrays, functions, null, DOM nodes or whole stores. To say that nothing is selected, use an enum value such as `none`, or a Boolean.

Limits:

- At most 20 fields and 100 availability callbacks.
- The serialized envelope must fit in **16 KiB of UTF-8**, names and statuses included. Fields that are each within their own limit can still overflow it together.
- A read that throws, is async or returns an invalid value raises a fixed `APP_CONTEXT_INVALID` error before anything is sent. The error contains no values or exception messages.

Do not shorten a value in a way that changes its meaning.

`public: true` is your promise that a value is public. It is **not a secret detector**. Do not include credentials, auth or session tokens, personal details, private IDs or content, whole form values or store dumps. A short, valid-looking string can still be private. Callbacks are trusted code and are not sandboxed: a faulty one can change state, send a request or block the main thread.

## Availability statuses

Callbacks can only be registered for capability IDs in the registry. The model cannot supply selectors, free-form reasons or expressions.

| Status                                                        | Behavior                                                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `available`                                                   | Can be proposed, if otherwise authorized. This does not mean it will succeed.                                                |
| `needs_preparation`                                           | Can be proposed; the real handler must prepare its UI. A hidden menu does not mean the feature is missing.                   |
| `not_applicable`, `loading`, `requires_selection`, `disabled` | Left out of the catalog for new proposals. The assistant should explain which state or selection is needed.                  |
| `check_failed`                                                | Fail closed for that capability. Throwing, async or invalid-status callbacks become this fixed status without error details. |

A capability without a callback is `not_checked` locally and sends no availability entry; authorization and verification work as before. Callbacks apply to the whole capability, **not to individual parameters**. For example, do not disable reading for all scopes because one scope is hidden. Parameter checks belong in the handler or verifier.

The browser checks availability again **inside the queued handler call**, after the parameter and snapshot checks and just before execution. A state change while the provider is responding cannot slip past it. A denied call returns `CAPABILITY_UNAVAILABLE` without running the handler, verifier or presentation. It still counts toward the action budget and replay protection, so replaying the same call never retries it. A new call after a real state change can run. A completed navigation is still verified, never replayed or blocked after the fact.

The check happens when the handler starts. A handler that waits for preparation or network work must check the relevant state and permissions again right before its own side effects. Availability is a hint, not a lock.

## Server and model

The Node and native PHP engines, the Laravel adapter and the WordPress bundle accept the optional envelope after strict schema and semantic validation. The server's trusted catalog, the session's permissions and the browser's registered IDs stay authoritative. Context can **remove** capabilities from future proposals. It cannot grant capabilities, unblock consequential actions, change schemas or reset budgets.

Continuations still carry the full list of registered `capabilityIds`. If an action disables its own button, its result must still match the pending authorized call and be accepted: filtering applies only to **new proposals**. If a provider proposes an unavailable capability anyway, the server answers HTTP 409 `CAPABILITY_UNAVAILABLE`, charges the attempt once and does not retry or fall back. A permission denial is still `CAPABILITY_DENIED`. Cached replies still need current server permission, and the browser runs its own check before executing.

The provider receives the current context in the latest user-data envelope as `untrustedAppContext`, separate from `untrustedPage`. Availability for capabilities the user is not allowed to use is left out. The system instructions tell the model to treat these values as untrusted data, never as commands, identity or proof of success. A model can still misread the state.

Structured context is **not saved in durable history**, action evidence, navigation checkpoints or inspector diagnostics. It is rebuilt every round and stops being sent once you remove it. The model can still quote a value in an answer, which is then kept like any other transcript text, and custom transports, providers or loggers may store requests. Review those, tell visitors that their data goes to the provider, and keep your existing privacy and erasure policies.

## Wire format and rollout

`ChatRequest.appContext` has its own `schemaVersion: 1`, a `fields` array of `{name,value}` and an `availability` array of `{capabilityId,status}`. Unknown properties, types or statuses, duplicate field names or capability IDs, too many items and oversized content are all rejected. The generated JavaScript and PHP schemas check structure. `validateAppContext`, `validateChatRequest` and the native `ProtocolValidator` also check uniqueness and byte limits; anything that only uses the raw schema must do those checks itself.

This is an **opt-in extension** of protocol `0.1`. Updated servers accept old requests, and clients that do not use it leave the field out, but older servers reject requests that include it. There is no negotiation, silent dropping or retry. Deploy matching protocol, core, client and server builds (Node, PHP or WordPress) before you enable it. The state envelope and release version are unchanged; see [API boundaries](api-contract.md).

## Example

After `npm run build` and `npm run demo`, `/driving.html` shares two Booleans (for the article and the panel) and a public heading color. Its browser tests cover updates on each round, state changes just before the handler runs, and a control that disables itself after success. They use no live provider, credentials or database. The WordPress plugin's default widget does not register custom app state or add a settings screen for it; that remains a custom integration.
