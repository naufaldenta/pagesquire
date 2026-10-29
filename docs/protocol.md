# Protocol 0.1

The protocol package exports types and JSON Schema for capabilities, manifests, action calls and results, page snapshots, assistant responses, chat requests and replies, and provider drafts. A breaking protocol change needs an explicit version change.

## Capabilities

A manifest contains `schemaVersion: "0.1"` and a list of capabilities. Each capability declares its stable ID, an English description, its browser handler, a closed object schema for its parameters, its risk and its verifier ID.

```json
{
  "id": "accessibility.set_heading_color",
  "description": "Change heading color without changing body text.",
  "execution": "browser",
  "handler": "accessibility.set_heading_color",
  "inputSchema": {
    "type": "object",
    "properties": {
      "color": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" }
    },
    "required": ["color"],
    "additionalProperties": false
  },
  "risk": "reversible",
  "verification": { "handler": "accessibility.set_heading_color.verify" }
}
```

`read_only`, `reversible` and `consequential` describe a capability's impact. The runtime blocks consequential actions unless [approval](webmcp-and-approval.md) is configured. Whether an action really is reversible is the adapter author's responsibility, never the model's.

## Registry bindings

The registry requires a handler, a verifier and a compiled parameter validator for every capability. The validator embeds its source schema. Registration rejects schema drift, duplicate IDs, missing bindings and inherited bindings.

The build compiles the fixture parameter validators to standalone Ajv code and bundles their runtime helpers; see `scripts/compile-validators.mjs` and `scripts/build-demo.mjs`. The onboarding CLI does the same with `validate --compile`. Never compile schemas supplied by the model in the browser. Shared JSON conformance cases run PHP and Node against the same expected protocol outcomes.

Handlers receive immutable parameters and an execution context. A verifier returns `{ verified: boolean, evidence?: JsonObject }`. Verification must confirm the desired application state, not just that a click event was dispatched.

## Conversation envelopes

`ChatRequest` includes `protocolVersion`, a unique `requestId`, a filtered `snapshot` and the `capabilityIds` installed in the browser. A new turn contains `message`. A continuation after a pending action contains `result` and `conversationId` instead. The schema requires exactly one of `message` and `result`.

[PageSquire Link](link.md#handoff-phase-6b) adds two more kinds of request:

- `linkCode` alone starts a conversation from a partner's handoff code.
- `handoff: { callId, skill? }` with `conversationId` records that the visitor approved a pending `link.handoff` call. `skill` names the partner they chose when the call listed alternatives. The reply to an approval carries `response.handoff.url`.

A message is at most 4,000 characters. Capability IDs must be unique, at most 100 of them. The server never accepts client history, a system prompt, schemas, provider settings, budgets or permission grants from the request.

`ChatReply` contains `protocolVersion`, a `conversationId` owned by the server and an `AssistantResponse`. An unfinished response carries one tool call, and a finished response carries none. The server assigns call and snapshot IDs; the provider draft only names an authorized capability and its parameters. Each result must match the pending call before inference continues. These sequencing and authorization rules are checked in addition to JSON Schema validation.

A snapshot may include optional `tabs`: up to four other same-origin tabs in the [companion extension's](companion-extension.md#tabs-4d-4) session (the page itself is `tab1`). Each has an `id` (`tab2`…), its `url` (origin and path only), `title`, bounded `text`, `targets` whose IDs start with the tab ID, `truncated` flags, and whether it is `active`.

A snapshot may also include optional `frames`: up to five granted cross-origin frames read by the [companion extension](companion-extension.md#frames-4d-3). Each has an `id` (`frame1`…), its `origin`, `title`, bounded `text`, `targets` whose IDs start with the frame ID, and `truncated` flags.

All ten schema files are generated from the same definitions for JavaScript and PHP. JSON objects and arrays stay distinct at raw HTTP input. On the PHP side, associative arrays must be normalized to objects on purpose for empty parameters and evidence. Results from the browser are never server authorization.

### App context

`ChatRequest.appContext` is optional. It has its own `schemaVersion: 1`, up to 20 flat primitive fields and up to 100 availability entries from a fixed set of statuses. The JavaScript and native PHP validators also enforce unique names and a 16 KiB limit on the serialized size. It is untrusted public state: not a permission, not instructions, and not part of `PageSnapshot` or action evidence. Pending results keep the registered IDs, while new proposals may be narrowed. Old requests remain valid, but older servers with closed schemas reject the field, so update servers before browsers start sending it. See [app context](app-context.md).

## Calls and results

An action call contains `protocolVersion`, `callId`, `capabilityId`, `snapshotId` and `parameters`, and optionally a server `signature` that only the [companion extension](companion-extension.md#signed-action-calls) checks. The snapshot must be the current observation. Replaying the same call ID and payload returns the earlier promise or result instead of running the handler again. Reusing a call ID with a different payload is rejected.

A result contains the call and capability IDs, a status, a code, an English message, bounded JSON evidence and usually a fresh observation. A verified `ui.screenshot` result may also carry `screenshot`: a redacted JPEG (`mediaType`, base64 `data` of at most 100,000 characters, `width`, `height`) that engines forward once and never store ([screenshots](companion-extension.md#screenshots-4d-5)). Early rejections such as `BUSY` do not replace the snapshot of an action that is running.

| Status       | Meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| `success`    | The postcondition was verified                                 |
| `unverified` | A postcondition failed, or navigation awaits the next document |
| `failed`     | Validation, execution, policy, or timeout failed               |
| `cancelled`  | Execution was cancelled                                        |

Never turn `unverified` into a successful assistant response.

## Responses and activity

Every assistant response includes an explicit `emotion`: `idle`, `happy`, `sad`, `thinking`, `confused` or `hover`. `normalizeEmotion` supplies a fallback for unsupported values. The runtime reports `thinking` while an action runs and `idle` afterwards. Mapping emotions to an avatar is up to the host.

## Observation limits

Snapshots contain page text and metadata, never field values. They say when text or the target list was truncated. Password, file and hidden fields, sensitive autocomplete controls, private areas, hidden content and the assistant's own UI are left out. Snapshot IDs and target IDs identify what was observed; they grant no authority.

Schema validation checks structure only. It cannot tell an action's business meaning, how sensitive it is, or what a visitor is allowed to do.
