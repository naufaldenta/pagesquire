# Changelog

All canonical release notes are English. PageSquire uses SemVer for packages and separately versioned protocol contracts. Nothing listed here implies that an artifact has been published.

## Unreleased — 0.1.0-beta.0 candidate

### Changed

- Owner-approved beta-candidate version after a successful owner-run Kabarin integration report. Package, lockfile, CLI and WordPress versions are synchronized without changing protocol or storage formats, dependencies, permissions or publication guards. The separate quota-protected Kabarin demo is linked. Independent onboarding, candidate-specific reviews and final-commit checks remain gates; no beta tag/download, stable API or registry publication is claimed.

### Added

- Redacted screenshots (Phase 4D-5), off by default for owner, server and visitor:
  - Optional `ActionResult.screenshot` and `Screenshot` (JPEG, at most 100,000 base64 characters).
  - Opt-in `ui.screenshot` (`createScreenshotCapabilities`, embed `data-screenshots`) through `InputDriver.screenshot`, with `Verification.screenshot`.
  - Engine `screenshots` (Node and PHP) and Laravel `PAGESQUIRE_SCREENSHOTS` forward the image as an OpenAI-compatible `image_url` part to the next provider call only; it is never stored.
  - `siteDeclaration({ screenshots })` and `ActionSigner::declaration(..., true)`.
  - In the extension: a visitor switch per site. Before the image leaves, form fields, private regions and frames are painted black, measured in an isolated world. Hidden panel elements stay hidden.
- Session tabs (Phase 4D-4):
  - Optional `PageSnapshot.tabs` and `TabSnapshot`, observer `remoteTabs`, and the generic `ui.switch_tab` tool through `InputDriver.switchTab`.
  - Tab targets (`tab2-target-3`) use the frame driver path. Companion driver `tabs()` and `switchTab`.
  - In the extension: same-origin tabs the page opens (confirmed by the new page) or the visitor shares from the side panel join a labelled tab group. They are read and acted in through their own debugger session, signed per target. They leave on close, origin change or unshare. Stop or Esc in any tab stops the whole session.
  - The page side also gained:
    - a relay `hello-wait` notice, so a slow service worker is not mistaken for a missing extension;
    - generic tools that no longer wait for animation frames in hidden pages;
    - extension codes in companion error messages.
  - The frame script is now the remote script (`dist/remote.js`), and extension tests run one browser at a time.
- Cross-origin frames (Phase 4D-3):
  - Optional `PageSnapshot.frames` and `FrameSnapshot`, observer `remoteFrames`.
  - Generic `ui.click`/`ui.check`/`ui.type`/`ui.press_key` on frame targets (`frame1-target-3`) through `InputDriver.frameTarget`/`frameAct`.
  - Companion driver `frames()` and frame calls.
  - In the extension: a bundled frame script (`scripts/build-extension.mjs`) reads and prepares input only in frames the site declares and the visitor allows, with a deny list for payment and identity providers. Input goes through the frame's own CDP session with a hit test across frame owners. Signatures bind the frame target ID. Stop hides frames.
- Signed action calls (Phase 4D-2): optional `ActionCall.signature` (Ed25519 over server-written `claims` text with origin, call, parameters and a 60-second expiry); Node engine `signing` with `createSigningKey`, `signingPublicKey`, `signActionCall`, `verifyActionCall` and `siteDeclaration`; PHP `ActionSigner` and engine `signer`; Laravel `PAGESQUIRE_SIGNING_KEY`/`PAGESQUIRE_SITE_ORIGIN` with an automatic `/.well-known/pagesquire.json`; `pagesquire signing-key`. The companion extension now requires a declared `publicKey` and runs only signed calls whose input matches, once each; unsigned calls keep synthetic events. Update browser bundles before enabling signing.
- Companion extension development build (Phase 4D-1, `packages/extension`, local and `.test` sites only): Manifest V3, a visitor grant per origin in the side panel after checking the site's `/.well-known/pagesquire.json`, trusted main-frame click, text and keys through `chrome.debugger` with its own nonce lookup, hit test and reserved-target refusals, Esc/Stop/Resume, idle and out-of-origin detach, per-tab rate limit and a local audit log without typed text. Core `InputDriver` (`GenericOptions.driver`) and `createCompanionDriver`, and the embed's `data-companion`, fall back to synthetic events without it. See [companion extension](docs/companion-extension.md).
- Phase 4D-0 spike checks in `tests/spike` with results in the companion extension design.
- Visitor prompts: generic `ui.ask` (choose one of 2–5 options) and `ui.hand_off` ("Your turn" for sign-in, CAPTCHA, one-time codes or payment), runtime `visitor`/`visitorTimeoutMs`, `ExecutionContext.askVisitor`, client `createVisitorPrompt`, `VISITOR_*` codes, English/Indonesian copy, and embed wiring. See [generic actions](docs/generic-actions.md).
- Opt-in visible plan (`plan` on Node/PHP engines, `limits.plan` in Laravel): one planner call per visitor message, a bounded optional `plan` on the first action reply, shown by the widget and fed back to later steps.
- Opt-in action check (`checkActions`, `limits.check_actions`): a fail-closed reviewer call before each model-chosen action that is not read-only.
- Observer `outline` and read-only same-origin `frames` text options, with `data-outline`/`data-frames` embed attributes.
- Laravel streams fixed progress stages as NDJSON when asked.
- Streamed server progress: opt-in NDJSON responses (`Accept: application/x-ndjson`) with fixed stages (`accepted`, `thinking`, `reviewing`, `replaying`) and a final validated reply or error line, in the Node handler and native PHP endpoint; engine `onProgress` callbacks; client transport streaming with plain-JSON fallback, `state.serverStage`, widget status and `server` trace events. Model text is never streamed. See [streaming](docs/streaming.md).

- Built-in English and Indonesian copy for the widget, action progress, approval prompt, guided tour, transport/client errors and engine fixed replies; `locale`/`messages` options (auto-detected from `<html lang>`), embed `data-locale`, engine `locale` (Node/PHP), Laravel `PAGESQUIRE_LOCALE`, WordPress site-language support. Default transport errors no longer mention the OFFBEAT demo. See [languages](docs/i18n.md).

- Phase 4C: native dialog capture during generic actions; verification of re-rendered elements by role and name; server typed-data screening for `ui.type` (Node/PHP); opt-in completion validator (`validateCompletion`, Laravel `limits.validate_completion`); trajectory cache (`TrajectoryCache`, `MemoryTrajectoryCache`, Laravel `trajectory_cache`) that replays verified turns without provider calls; evaluation `--validate`, `--cache`, `--repeat` and a stricter oracle self-check. See [generic actions](docs/generic-actions.md).

- Phase 4B: client `onTrace` events, `TraceRecorder` (bounded, redacted by default, JSON export) and `mountTraceViewer`; embed `data-trace`; a 36-task generic browser evaluation (`npm run test:eval-generic` oracle self-check in CI, `npm run eval:generic:live -- --max-calls N` for budgeted live models) graded from the final page state. Snapshots keep on-screen targets first when truncating, so overlays stay visible. See [traces and evaluation](docs/trace-and-eval.md).

- Phase 4A browser robustness: observation v2 (stable target IDs, element state flags, open shadow DOM, `new`/`removedTargets` diffs, `observer.find`); opt-in guarded generic `ui.*` tools with Playwright-style actionability checks, realistic events, DOM/network settling, built-in risk tiers and in-action approval; server-led recovery (`maxRecoveries` on Node/PHP engines, Laravel `max_recoveries`, client `allowRecovery`) with repeat detection; embed `data-generic`. See [generic actions](docs/generic-actions.md).

- Phase 3: `exposeToWebMcp` registers capabilities as WebMCP tools through the verified runtime; opt-in approval for consequential capabilities (`allowConsequential` on Node/PHP engines and `PAGESQUIRE_ALLOW_CONSEQUENTIAL` in Laravel, a runtime `approve` hook and `createApprovalPrompt`); WordPress `wordpress.run_ability` adapter for administrator-selected read-only WordPress Abilities, run server-side with the visitor's own permissions. See [WebMCP, approvals and WordPress Abilities](docs/webmcp-and-approval.md).

- Phase 2 reliability: opt-in `tools` response mode (Node, native PHP, Laravel, WordPress) that offers approved capabilities as native function definitions and reads the first tool call as the single proposed action; provider diagnostics with outcome, HTTP status, latency and token usage but no content (`onDiagnostic` in Node/PHP, `ProviderCalled` event in Laravel).

- Phase 1 stabilization: per-session hourly provider budgets (`attemptsPerHour`, default 60) in the Node and native PHP endpoints that survive new conversations and principal changes; `PageObserver` `observeUrl` (observation scope separate from navigation) and `redactUrl` (snapshot URL redaction); `BrowserRuntime.resetSession()`, called by `AssistantClient.reset()`, so the action budget and replay cache start fresh per conversation.

- C4 metadata-only runtime progress, bounded immutable client action timelines and fixed recovery copy. The shared widget shows actual handler/verifier boundaries, distinguishes cached results and unverified navigation, ignores late/cancelled work, and scopes busy semantics to the message log. No chain of thought, automatic retry/rollback, permission expansion or wire/storage change is introduced.

- C3 optional public `AppContext`, flat typed state, fixed availability statuses and bounded/unique protocol envelope. Clients refresh per round; Node/PHP providers receive ephemeral untrusted state and filter future proposals, runtime handlers recheck availability and Laravel preserves validated context. Pending results, permissions, replay/accounting and default-off behavior remain intact. Coordinated browser/server rollout is required; no training, whole-store upload or inference retry is added.

- C2 optional `CapabilityInspector` and client `mountInspector`, with expected-versus-registered coverage, read-only host target probes, searchable/filterable schema disclosures, explicit refresh and metadata-only diagnostics. The neutral offline example and English guides distinguish target readiness from actual action verification/server permission. No competitor source, provider call, implicit execution or production debug mount is included.

- D1 framework-neutral `BrowserDriver`, runtime presentation context, desired-state control bindings, public reading/scroll/highlight capabilities with bounded truncation/offset evidence, guided tours and opt-in local-first speech. English parity/onboarding guidance and a neutral offline fixture preserve host permissions and licensed-asset boundaries. Node/PHP instructions retain compound goals after verified navigation; synthetic checks do not certify live-model accuracy. WordPress offers optional inspected public-content reading/scroll/highlight without changing default permissions.

- R1 local API inventory and conservative normalized declaration/schema/manifest/PHP-source baseline, a read-only `api:check` enforced in CI and candidate preparation, and synthetic serialized Node checkpoint recovery regressions. English compatibility/deprecation, upgrade/recovery and maintenance guidance explicitly excludes API freeze, historical-release upgrade certification and RC/stable promotion.

- B5 alpha/beta prerelease policy, explicit independent-onboarding/support/security review records, a read-only `release:check -- --beta` readiness gate, channel-bound candidate manifests and beta inventory regressions. English beta testing/feedback/promotion guidance preserves clean-checkout, CI, approval and deferred-registry boundaries; no version promotion or public beta is implied.

- B4 trusted server-only Node/PHP conversation-erasure helpers preserve request buckets, host metadata and separate provider budgets. English operations guidance covers incident containment, lock/lease recovery, retention and integration-specific deletion boundaries; no public deletion endpoint is enabled.

- B2 opt-in Sumopod evaluator with an exclusive durable attempt ledger, bounded transport, no automatic paid retries, and real isolated OFFBEAT browser verification. A dated sanitized twelve-call/five-scenario live result is separate from the 246 EN/ID synthetic contract variants and fifteen named providers' official-documentation reviews. CI runs only the deterministic offline browser smoke; model/provider settings remain environment-owned.

- Sixteen server-side provider profiles (fifteen named service/gateway profiles plus Custom), shared Node/PHP configuration, canonical environment settings, Laravel wiring and an administrator-only WordPress provider selector. English support matrix and per-integration tutorials distinguish synthetic transport support from live-model certification.
- Explicit JSON/prompt, output-token field, instruction-role and supported thinking switches; bounded whole-fence/text-part normalization and refusal/truncation rejection without automatic provider fallback or paid retries. Existing explicit-endpoint configuration remains compatible.

- OFFBEAT now offers thirteen verified tools, including independent heading highlighting/body color, reading fonts/spacing, gallery search/sort, edge-aware scrolling and resets. Separate-message, confirmation, recovery and expired-auth browser regressions extend the original single-message smoke coverage.
- Legacy Node/PHP history normalization and safe typed HTTP failure feedback, with conversation continuity after known provider-format failures and no automatic paid retries or quota resets.

- OFFBEAT, an independent brutalist art/culture landing demo with original characters, a filterable gallery, accessible dialogs, verified guided actions and six expressions. Its optional private AI chat deploys alongside the frontend on Vercel, with environment-owned model/provider configuration, signed sessions, Supabase PostgreSQL checkpoints, fenced leases and shared usage limits. Guided actions need no credentials.

- Independent capability registry, versioned schemas and CSP-safe compiled validators.
- Browser observation, verified actions, ambiguity/staleness checks, cancellation and navigation continuation.
- Conversation widget with six emotion callbacks, including thinking during loading.
- Bounded PHP and Node engines, server-only provider transports and PHP/Node conformance fixtures.
- Laravel 13, React 19, Inertia v3 and Next.js App Router adapters.
- Script-based onboarding, bounded source/DOM discovery and optional English Codex/Claude Code setup skills.
- Self-contained WordPress ZIP, guided dashboard setup, filtered context export and configuration-only import.
- GitHub-first release checks, local source/npm/PHP/plugin artifacts, checksums, compatibility evidence and community templates.

### Fixed

- WordPress per-minute site/IP limits and the daily provider budget use lock-free atomic counters instead of one shared non-blocking option lock, so simultaneous visitors no longer get spurious 409 `BUSY` responses. An exhausted daily provider budget now returns 429 `PROVIDER_BUDGET` before any conversation work instead of a 502 after the attempt was recorded.

- Laravel passes the contract-validated raw JSON body to the engine. Global `TrimStrings`/`ConvertEmptyStringsToNull` middleware previously turned empty titles or unlabeled targets into `null`, so ordinary pages were rejected with 422 `INVALID_PAYLOAD`, and trimmed visitor messages.
- Node/PHP conversation history keeps browser results without their `observation` snapshot (the current page is already sent each turn), so multi-step tasks no longer exhaust the context limit after a few large pages. An oversized context now finishes without charging an attempt.
- After a timeout or cancellation, the browser runtime refuses new actions until the abandoned handler or verifier settles (bounded by one more timeout window), so a late mutation cannot be credited to the next verifier.
- Fragment-only document navigation is verified in place instead of leaving a navigation checkpoint for a page load that never happens.
- More sensitive query/fragment keys (signatures, nonces, credentials, JWTs, session IDs, `sig`/`sid`/`otp`) block navigation and observation.

- Closed native `details` content is no longer considered visible solely because it retains layout rectangles; its first summary remains available. Registered handlers must explicitly prepare hidden controls.

- OFFBEAT PostgreSQL expiry cleanup locks bounded candidates and rechecks target expiry/lease conditions. Concurrent session lease and cost-bucket renewals no longer get deleted using stale candidate IDs; disposable real-database regressions cover both races and batch limits. Production rollout remains a separate owner-authorized step.

- Browser cancellation is rechecked immediately before queued handlers and verifiers start, including resumed navigation. Cancelling an action before its callback starts no longer invokes that callback; a fresh action can still run afterward.
- The real WordPress browser fixture waits for WordPress's deferred login autofocus before filling credentials and verifies both fields before submitting. A delayed-autofocus regression covers the credential-focus race found in Windows CI without altering plugin authentication or relaxing test assertions.
- B1 regressions cover five independent PHP/Node chat messages, continuing after cancellation, ignoring late transport/provider replies after cancellation or timeout, and shared PHP/Node recovery without action replay or attempt-budget resets. These use deterministic providers, not live-model accuracy certification.

### Security and distribution

- Node/PHP assistant history now preserves the provider response schema for both action and final turns, without internal call/snapshot identifiers. This avoids teaching live models an incompatible internal action format; strict response and parameter validation remains unchanged.

- Explicit host authorization, CSRF/origin controls, schema validation, durable checkpoints and bounded inference attempts.
- WordPress lock ownership and quota controls; disabled-by-default activation.
- MIT shared packages; GPL-3.0-or-later combined WordPress plugin with prefixed dependencies, notices and corresponding sources.
- npm packages remain private. npm, Packagist and WordPress.org publishing is deferred.

### Known limitations

This is not stable 1.0 or a production security certification. See [compatibility](docs/compatibility.md) and [security](SECURITY.md). Live-model accuracy, remote CI results, production topology, broad theme/plugin support and assistive-technology review remain unverified. No Rive artwork is redistributed.
