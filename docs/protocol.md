# Protocol 0.1

The protocol package exports types and JSON Schema for capabilities, manifests, action calls/results, page snapshots, assistant responses, chat requests/replies, and provider drafts. Breaking protocol changes require an explicit version transition.

## Capabilities

A manifest contains `schemaVersion: "0.1"` and a capability list. Each capability declares its stable ID, English description, browser handler, closed object parameter schema, risk, and verifier ID.

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

`read_only`, `reversible`, and `consequential` describe capability impact. The foundation runtime rejects consequential actions; declaring an action reversible is a responsibility of the installed adapter, not of the model.

## Registry bindings

The registry requires a handler, verifier, and compiled parameter validator for every capability. The validator includes the source schema; registration rejects schema drift, duplicate IDs, missing bindings, and inherited bindings.

## F2 conversation envelopes

`ChatRequest` includes `protocolVersion`, a unique `requestId`, a filtered `snapshot`, and `capabilityIds` installed on the browser. A new turn contains `message`; a pending-action continuation contains `result` and `conversationId` instead. The schema requires exactly one of message/result. Message length is at most 4,000 characters; capability IDs are unique and limited to 100. The server accepts no client history, system prompt, schema, provider setting, budget, or permission grant.

`ChatReply` contains `protocolVersion`, a server-owned `conversationId`, and an `AssistantResponse`. F2 accepts one tool call in an unfinished response, and none in a finished response. The server assigns call/snapshot IDs; the provider draft only names an authorized capability and its parameters. Each result must match the pending call before inference continues. These sequencing/authorization rules are enforced beyond structural JSON validation.

All ten schema artifacts are generated from the same definitions for JavaScript and PHP. JSON objects and arrays remain distinct at raw HTTP ingress. Server-side associative PHP values require deliberate object normalization for empty parameters/evidence. Browser telemetry is not server authorization.

C3 optionally adds `ChatRequest.appContext` with its own `schemaVersion: 1`, up to 20 flat primitive field entries and 100 fixed-enum availability entries. JS/native PHP semantic validators also enforce unique identities and a 16-KiB serialized byte budget. It is untrusted public state, not permission/instructions or part of `PageSnapshot`/action evidence. Pending results retain registered IDs while new proposals may be reduced. Old requests remain valid; old closed-schema servers reject opted-in fields, so coordinated rollout is required. See [app context](app-context.md).

The build compiles fixture parameter validators using Ajv standalone code and bundles their runtime helpers. See `scripts/compile-validators.mjs` and `scripts/build-demo.mjs`. The local onboarding CLI provides `validate --compile`; packages remain unpublished. Do not compile arbitrary model-provided schemas in the browser. Shared JSON conformance cases exercise PHP and Node against identical expected protocol outcomes.

Handlers receive immutable parameters and an execution context. A verifier returns `{ verified: boolean, evidence?: JsonObject }`. Verification must establish the desired application state, not merely that a click event was dispatched.

## Calls and results

An action call contains `protocolVersion`, `callId`, `capabilityId`, `snapshotId`, and `parameters`. The snapshot must be the current observation. Replaying the same call ID and payload returns the previous promise/result rather than rerunning the handler. Reusing an ID for a different payload is rejected.

Results contain the call/capability IDs, status, code, English message, bounded JSON evidence, and normally a fresh observation. Early rejections such as BUSY do not replace an active action's snapshot.

| Status       | Meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| `success`    | The postcondition was verified                                 |
| `unverified` | A postcondition failed, or navigation awaits the next document |
| `failed`     | Validation, execution, policy, or timeout failed               |
| `cancelled`  | Execution was cancelled                                        |

Never turn `unverified` into a successful assistant response. Backend authorization and inference budgets remain requirements for the later provider integration.

## Responses and activity

Every assistant response includes an explicit `emotion`: `idle`, `happy`, `sad`, `thinking`, `confused`, or `hover`. `normalizeEmotion` supplies a fallback for unsupported values. Local runtime activity emits thinking while an action runs and idle afterward. Avatar trigger mapping and response generation are not yet implemented.

## Observation limits

Snapshots expose page text and metadata, not field values. They identify truncated text/target lists. Password/file/hidden fields, sensitive autocomplete controls, private areas, hidden content, and assistant UI are excluded. Snapshot IDs and target IDs are observations, not grants of authority.

Schema validation checks structure. It cannot establish an action's business meaning, sensitivity, or a visitor's permissions.
