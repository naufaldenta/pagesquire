# Public API review baseline

R1 starts with an inventory and a drift guard, **not an API freeze or a stable release**. PageSquire remains `0.1.0-beta.0`; all current contracts may still change with a documented prerelease. Independent beta acceptance, an approved frozen support/API scope and release-candidate/stable policy are outstanding. See [beta gates](beta.md) and [maintenance policy](maintenance.md).

## Integration surfaces

C4 adds core progress event/stage/code/listener types and optional runtime/per-invocation callbacks, required `ChatState.actionProgress`/`ActionTimelineEntry` and client `describeActionProgress`. Matching assets are needed; hand-built typed states must supply an empty list. The widget busy DOM selector changes to `data-busy` while message `aria-busy` no longer suppresses the adjacent status. Protocol/storage/permissions remain unchanged. These are reviewed alpha additions, not a freeze; see [progress boundaries](action-progress.md).

C3 adds core `AppContext`/field options, `RuntimeOptions.appContext`, `readAppContext()`, protocol context/status types/schema and `validateAppContext`. `ChatRequest.appContext` is optional; JS/PHP semantic validators enforce uniqueness/byte limits beyond structural checks. Laravel preserves validated context. Old requests remain valid, but old closed-schema servers reject opted-in payloads: coordinated deployment is required. This is an intentional wire extension, not only a local helper addition. Persistence formats and authorization remain unchanged; see [context boundaries](app-context.md).

C2 adds optional `CapabilityInspector`/inspection types in core and `mountInspector` in client. These are additive local development diagnostics: existing constructors, protocol/storage formats, runtime permissions and provider policy are unchanged. Inspector diagnostics schema `1` is not a wire-protocol change. The new declarations are intentionally reviewed in the baseline; see [capability inspector](capability-inspector.md).

Screenshots add the optional `ActionResult.screenshot` with `Screenshot`, `Verification.screenshot`, `InputDriver.screenshot`, `createScreenshotCapabilities`, server `EngineOptions.screenshots`, `ProviderImageMessage` (providers now receive `(ProviderMessage | ProviderImageMessage)[]`) and `siteDeclaration`'s `screenshots`, PHP engine `screenshots` and `ActionSigner::declaration`'s second argument, and Laravel `companion.screenshots`. Update servers before browsers that send screenshots.

Session tabs add the optional `PageSnapshot.tabs` with `TabSnapshot`, `ObserverOptions.remoteTabs`, `InputDriver.switchTab`, `CompanionDriver.tabs`, and the generic `ui.switch_tab` tool, which joins the generic manifest. Update servers before browsers that send tabs.

Cross-origin frames add the optional `PageSnapshot.frames` with `FrameSnapshot`, `ObserverOptions.remoteFrames`, `InputDriver.frameTarget`/`frameAct` with `FrameTargetInfo`, `FrameActRequest` and `FrameEffect`, and `CompanionDriver.frames`. Update servers before browsers that send frames, because older servers reject the field.

Signed action calls add the optional `ActionCall.signature` and `ActionCallSignature`, server `EngineOptions.signing`, `ActionSigning`, `SignatureClaims`, `SIGNATURE_CONTEXT`, `SIGNATURE_TTL_SECONDS`, `createSigningKey`, `signingPublicKey`, `checkSigning`, `signActionCall`, `verifyActionCall` and `siteDeclaration`, the PHP `ActionSigner` class and engine `signer` argument, Laravel `companion.signing_key`/`companion.origin` config with the `pagesquire.declaration` route, and the `signing-key` CLI command. Update browsers before servers sign, because older clients reject the new field.

The companion extension work adds core `InputDriver`, `GenericOptions.driver`, `createCompanionDriver`, `CompanionOptions`, `CompanionDriver` and `COMPANION_PROTOCOL`, and the embed's `data-companion` attribute. The page-to-extension messages are versioned separately (`version: 1`) and documented in the [companion extension](companion-extension.md#wire-format) guide. The development extension itself is not a published package.

The visitor and planning work adds the optional `AssistantResponse.plan` (2–5 strings, only sent when an engine enables `plan`), core `VisitorPrompt`/`VisitorRequest`, `RuntimeOptions.visitor`/`visitorTimeoutMs`, `ExecutionContext.askVisitor`, `VISITOR_DECLINED`/`VISITOR_TIMEOUT`/`VISITOR_UNAVAILABLE` codes, `ui.ask`/`ui.hand_off`, `ObserverOptions.outline`/`frames`, client `createVisitorPrompt`, engine `plan`/`checkActions` options and `planSteps` (Node and PHP), Laravel `limits.plan`/`limits.check_actions`, the Laravel `HandleChat::handle` progress argument, and the `plan` trace field. Update browsers before enabling `plan`, because older clients reject the field.

Streaming adds protocol `SERVER_PROGRESS_STAGES`, `ServerProgressStage`, `ChatStreamEvent` and `CHAT_STREAM_TYPE`; an optional `onProgress` argument to Node/PHP `ConversationEngine.handle`, PHP `ChatEndpoint::handle` and the client `ChatTransport`; PHP `ChatEndpoint::stream`; transport `stream` option; `ChatState.serverStage`; and `server` trace events. Non-streaming requests and responses are unchanged.

The language work adds client `en`, `id`, `locales`, `Locale`, `Messages`, `MessageKey`, `LocaleOptions`, `localeFor`, `resolveMessages` and `format`; `locale`/`messages` on widget, transport, client, approval prompt and guided tour options; an optional `messages` argument to `describeActionProgress`; Node `ENGINE_TEXT`, `EngineLocale` and `EngineOptions.locale`; and PHP `ConversationEngine::TEXT` with a `locale` argument. Defaults follow `<html lang>` in the browser and stay English on the server.

Phase 4C adds Node `EngineOptions.validateCompletion`/`trajectoryCache`, `TrajectoryCache`, `MemoryTrajectoryCache`, `CachedStep`/`CachedTrajectory`, `trajectoryKey` and `unrequestedData`; PHP `validateCompletion`/`trajectoryCache` engine arguments, `TrajectoryCache`, `MemoryTrajectoryCache` and `ConversationEngine::unrequestedData`/`trajectoryKey`; Laravel `CacheTrajectoryCache` and config keys; and `ConversationState.replay`/`recording`. Generic `ui.type` proposals with unrequested contact data, links or long numbers now end the turn.

Phase 4B adds client `TraceEvent`, `ClientOptions.onTrace`, `TraceRecorder` and `mountTraceViewer`. Snapshot truncation now keeps on-screen targets first.

Phase 4A adds optional snapshot fields (`ObservedTarget` state flags and `new`, `PageSnapshot.removedTargets`), `PageObserver.find`/`observableUrl` helpers and `composedClosest`, core `createGenericCapabilities`/`createGenericBindings`/`defaultRisk`, `ExecutionContext.requestApproval`, new progress codes, `EngineOptions.maxRecoveries`, the PHP `maxRecoveries` argument, Laravel `limits.max_recoveries`, client `allowRecovery`, and `ConversationState.recoveries`/`failedCall`. Snapshot target IDs are now stable across snapshots. Deploy servers before browsers that send the new optional fields.

Phase 3 adds core `exposeToWebMcp` and WebMCP types, `RuntimeOptions.approve`/`approvalTimeoutMs`, `ApprovalRequest`, `BrowserRuntime.approvalEnabled`, `APPROVAL_DENIED`/`APPROVAL_TIMEOUT` progress codes, client `createApprovalPrompt`, `EngineOptions.allowConsequential` and the PHP `allowConsequential` constructor argument, the Laravel `allow_consequential` config, and WordPress `Abilities`. All are opt-in; protocol `0.1` is unchanged.

Phase 2 adds the `tools` response mode, `ProviderDiagnostic`/`onDiagnostic` and `toolNames` in Node, optional `capabilities`/`config` arguments to `completionRequest`/`decodeCompletion` and `CompletionCodec::request`/`decode`, `CompletionCodec::usage`/`toolNames`, `ProviderHttpException` from the native cURL client, an optional `onDiagnostic` argument on the native PHP provider, and the Laravel `ProviderCalled` event. Defaults and protocol `0.1` are unchanged.

Phase 1 stabilization adds optional `PageObserver` `observeUrl`/`redactUrl` options and `observableUrl()`, `BrowserRuntime.resetSession()` (called by `AssistantClient.reset()`; hand-built runtime doubles must add it), an optional `attemptsPerHour` handler/endpoint limit with an optional stored-session `budget` field, and Laravel `ChatRequest::payload()`. Protocol `0.1` fields are unchanged. Behavior changes: conversation history no longer stores result `observation` snapshots, oversized contexts are not charged, sessions default to 60 provider attempts per hour, and more sensitive query keys are rejected.

D1 adds optional core presentation/control/reading helpers, `ExecutionContext.present`, `PageObserver.readContent`, and client tour/speech helpers. Real runtime contexts receive `present` automatically; hand-built typed contexts/mocks must add it. These additions and the new optional WordPress built-ins require deliberate baseline review. Protocol `0.1` fields, storage envelopes, action permissions and provider retry policy are unchanged. See [assistant driving](assistant-driving.md).

Use package entrypoints and the corresponding integration guides, not private build paths. Current exported types are the authoritative signatures; the table describes the intended review boundary rather than promising every class or option is stable.

| Surface                                                     | Intended integration contract                                                                                                                                                                                                           |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@pagesquire/protocol` and `@pagesquire/protocol/schemas/*` | Protocol `0.1` requests/replies/actions/snapshots, capability/provider schemas, validators, emotion types/normalization. Package release version and wire schema version are separate.                                                  |
| `@pagesquire/core`                                          | Registry/bindings, browser observation/runtime, execution and verification, navigation adapters and explicit control helpers. Host permissions and actual postconditions remain mandatory.                                              |
| `@pagesquire/client` and `@pagesquire/client/widget.css`    | `AssistantClient`, same-origin HTTP transport, widget mounting/options, navigation continuation and emotion callbacks. Stylesheet entrypoint is public; private DOM selectors/internal CSS details are not a styling stability promise. |
| `@pagesquire/react`, `/inertia`, `/next`                    | `PageSquireWidget`, `createInertiaNavigation`, `createNextNavigation` and their declared props/options. Host router/session/auth integration remains host-owned.                                                                        |
| `@pagesquire/cli` and `pagesquire` binary                   | Documented onboarding commands, config/mapping validation and exported workflow helpers. No universal discovery, automatic permissions, code training or coding-agent compliance guarantee.                                             |
| `@pagesquire/server`                                        | Engine/provider/configuration interfaces, handler authorization, serialized store transactions and trusted `forgetConversation`. Public export visibility does not promise a stable on-disk conversation format.                        |
| `pagesquire/server` / `PageSquire\Server\`                  | Composer platform/namespace boundaries and documented native PHP engine, provider, endpoint/store/privacy interfaces. Only trusted host integrations may supply identity, storage and provider settings.                                |
| `pagesquire/laravel` / `PageSquire\Laravel\`                | Service-provider registration, published configuration, catalog/provider binding and documented named route/gates. The adapter's cache envelope is not interchangeable with the native endpoint.                                        |
| WordPress ZIP                                               | Documented administrator setup, data-only mappings, selected public-page capabilities and server-side provider configuration. Prefixed vendor classes, option keys, locks and internal plugin methods are not a stable extension API.   |

Provider presets/configuration and canonical environment/legacy aliases are documented in [providers](providers.md). Every model remains owner-configurable; API drift checks do not certify model accuracy or provider availability. Required host versions are in [compatibility](compatibility.md), not inferred from an API hash.

## What the automated guard measures

```sh
npm run build
npm run api:check
```

`docs/api-baseline.json` records the package version and normalized SHA-256 fingerprints of:

- Selected npm manifests: names/module type, export maps/binary, host engines, dependencies and peer requirements.
- All emitted `.d.ts` files in the six packages, including conservatively included internal declarations, and all exported protocol JSON schemas.
- Composer names/type, platform/dependency requirements, autoload/discovery and suggestions.
- PHP source trees and the WordPress entry file as **whole-source review fingerprints**, not parsed semantic method signatures. An implementation/comment-only PHP change may therefore require review.

CRLF/LF and JSON key ordering are normalized. Missing/changed/added declarations, schema changes, host/entrypoint changes, package-version drift and PHP source changes block the check. Linked inputs/baselines are rejected. The tool reads fixed public checkout paths; it does not import JavaScript/PHP, boot a host, read production environment files, send telemetry or call a model. Run it in a trusted quiescent checkout; it is not protection against a hostile concurrent filesystem.

The guard is part of `npm test` and Windows/Ubuntu CI after build. Candidate preparation also refuses drift even if a fresh build fingerprint exists. New candidate manifests record `apiReview` as `review-baseline-not-frozen`. A matching baseline is neither reviewer approval nor proof of behavioral compatibility/security. It does not compare runtime JavaScript behavior, infer a SemVer category, certify CSS layout or freeze arbitrary PHP public methods. Behavioral/browser/security tests and independent reviews remain required.

## Reviewing intentional changes

1. Add a failing consumer/schema/behavior regression. Compare old and new declarations/schemas, real package entrypoints and required host versions. Classify additive, behavioral, wire, persistence and security effects explicitly; a hash alone cannot decide.
2. Update integration examples, changelog, version/deprecation notes and [upgrade guidance](upgrading.md). For wire changes, review closed schemas and mixed browser/server behavior. Do not quietly broaden fields or permissions to keep an old client running.
3. Print the proposed baseline with `node scripts/check-api.mjs capture`. This is read-only JSON output; there is no automatic `--update`, approval or promotion command. Review the diff and deliberately replace the committed baseline in the same reviewed change. Never rebaseline solely to make CI green.
4. Run build, API/type/contract/runtime checks and clean consumers. Any included source or guide change invalidates the candidate build fingerprint. Require exact-commit remote CI before eventual publication.

Current `ConversationState`, native/Laravel/WordPress storage envelopes, provider transcripts, lock/fence/option keys, replay-cache internals, private runtime fields, demo routes/assets and generated binding internals are **not a version-independent interchange or backup format**. Do not manually edit or round-trip them through a browser/model. The current same-format synthetic reopen tests are described in [upgrading](upgrading.md); a durable format/version negotiation and old-release matrix must be designed before promising broader state migration compatibility.
