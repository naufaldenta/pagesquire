# Changelog

PageSquire follows semantic versioning for its packages. The protocol contracts have their own version numbers.

## 0.1.0-beta.0 (2026-10-29)

The first beta. Package, CLI and WordPress versions are now `0.1.0-beta.0`; protocol and storage formats did not change. The six JavaScript packages are published on npm under the `beta` tag, and `pagesquire/server` and `pagesquire/laravel` on Packagist. The WordPress plugin is not on WordPress.org yet.

### Added

#### PageSquire Link

Lets two PageSquire sites work together, even when they have different owners and run on different stacks. Off by default. See [PageSquire Link](docs/link.md).

- **Pairing.** One owner creates a single-use invitation (`psq1.…`, valid 24 hours by default) and the other accepts it. Each owner then approves which partner skills their assistant may offer, with which fields, and which of their own skills the partner may use. Either owner can revoke at any time.
- **Signed messages.** Servers talk to each other with Ed25519-signed envelopes that are bound to the sender, recipient and link, expire after five minutes and are accepted once. Each site reads its partner's key from the partner's own `/.well-known/pagesquire.json`.
- **Handoffs.** The assistant can offer a partner's service with the new `link.handoff` tool. The visitor sees the partner, the goal and every field before anything is sent. The partner opens in a new tab and continues after one click. Only the goal and the fields the visitor gave travel, and the engine drops anything outside the approved scope.
- **Returns.** With `link.return`, the partner can send the visitor back once, within 24 hours, to the page they started from, with a one-line outcome.
- **Several partners.** When more than one partner offers the same skill, the visitor chooses where to continue.
- **Owner overview.** `LinkManager.overview()`, `pagesquire:link-overview` and the WordPress Partners panel show who offers what and how many visitors went each way, per skill.
- **A2A interface.** Optional. A site can publish a signed A2A 1.0 Agent Card at `/.well-known/agent-card.json` and accept requests from any A2A agent into the skills its owner opens. The agent only gets a single-use link; the person continues on the site.
- **Everywhere.** Node (`LinkManager`, `createLinkHandler`, `createA2AHandler`), native PHP (`Link\LinkManager`, `LinkEndpoint`, `A2AEndpoint`), Laravel (`PAGESQUIRE_LINK`, `PAGESQUIRE_A2A`, the `pagesquire:link-*` commands), WordPress (dashboard step 6) and the one-tag embed (`data-link`).
- **Tests.** Node and PHP pass the same test vectors, and cross-stack tests pair a Node site with a PHP site and with WordPress over real HTTP.

#### Companion browser extension (development build)

A Chromium extension that gives generic tools real clicks and typing on local and `.test` sites. See [companion extension](docs/companion-extension.md).

- The visitor allows it per site in the side panel, after the extension checks the site's `/.well-known/pagesquire.json`. Esc or Stop ends the session at once.
- **Signed action calls.** The server signs each call with a site key (Ed25519, 60-second expiry), and the extension runs only signed calls, once each. Use `createSigningKey`, `signActionCall` and `siteDeclaration` in Node, `ActionSigner` in PHP, `PAGESQUIRE_SIGNING_KEY` in Laravel, or `pagesquire signing-key`. Update browser bundles before you turn signing on.
- **Frames.** Generic tools can act inside cross-origin frames that the site declares and the visitor allows. Payment and identity providers are always blocked.
- **Tabs.** Same-origin tabs that the page opens, or that the visitor shares, join the session with the new `ui.switch_tab` tool.
- **Screenshots.** Optional and off by default for the owner, the server and the visitor. `ui.screenshot` sends one redacted image to the next model call only: form fields, private areas and frames are painted black first, and the image is never stored.
- Without the extension, everything falls back to synthetic events.

#### Generic tools and visitor prompts

See [generic actions](docs/generic-actions.md).

- **Generic `ui.*` tools.** Optional tools for page controls you have not mapped yourself. They use stable element references, page diffs and Playwright-style actionability checks, and they wait for the page to settle. Actions are sorted into risk tiers, with approval in the middle of an action when needed.
- **Recovery.** With `maxRecoveries`, the server lets the model try another way after a failed step and detects repeated attempts.
- **Visitor prompts.** `ui.ask` lets the visitor pick from two to five options. `ui.hand_off` shows a "Your turn" panel for sign-in, CAPTCHA, one-time codes or payment.
- **Plan and checks.** An optional visible plan for each message (`plan`), an optional review before each action that changes something (`checkActions`), and an optional final completion check (`validateCompletion`).
- **Trajectory cache.** Replays verified turns without calling the model (`TrajectoryCache`).
- **Typed-data screening.** `ui.type` refuses to type contact details, links or long numbers the visitor never gave.
- Native dialogs are captured during generic actions, and re-rendered elements are verified by role and name.

#### Approvals, WebMCP and WordPress Abilities

See [WebMCP and approvals](docs/webmcp-and-approval.md).

- `exposeToWebMcp` lets browser agents call the same verified capabilities as WebMCP tools.
- Consequential capabilities can be allowed with approval. The server (`allowConsequential`), the host and the person (`createApprovalPrompt`) must all agree.
- WordPress can expose read-only WordPress Abilities chosen by the administrator. They run on the server with the visitor's own permissions.

#### Assistant driving

See [assistant driving](docs/assistant-driving.md).

- An animated cursor and outline, page reading with clear truncation, scrolling, highlights and guided tours.
- Optional speech that runs locally first.
- Node and PHP keep the rest of a multi-part request after a page navigation.
- WordPress can offer reading, scrolling and highlighting of public content.

#### Progress, streaming and languages

- **Action progress.** A step-by-step timeline of each action in the widget: checking, running, verifying and the outcome. It shows the real steps only, never model reasoning. See [action progress](docs/action-progress.md).
- **Streaming.** Optional NDJSON responses show fixed server stages (`accepted`, `thinking`, `reviewing`, `replaying`) while the model works. The model's text itself is never streamed. See [streaming](docs/streaming.md).
- **Languages.** English and Indonesian for the widget, progress, approvals, tours, errors and the engine's fixed replies. The language follows `<html lang>`, and any text can be overridden. See [languages](docs/i18n.md).

#### Developer tools

- **Capability inspector.** Compares the capabilities you expect with the ones registered, probes targets, and shows schemas. See [capability inspector](docs/capability-inspector.md).
- **App context.** An app can pass typed public state and say which actions are available right now. The model treats it as untrusted data. See [app context](docs/app-context.md).
- **Traces.** A local trace recorder and viewer (`onTrace`, `TraceRecorder`, `mountTraceViewer`). See [traces and evaluation](docs/trace-and-eval.md).
- **Evaluation.** A 36-task browser evaluation graded from the final page state, plus an optional live-model evaluator with a hard budget.
- **API check.** `npm run api:check` compares the public API with a saved baseline, in CI and before a release.

#### Model providers

- Fifteen named provider presets, including OpenAI, OpenRouter, Groq, DeepSeek, Gemini, Mistral, Qwen, GLM, Sumopod, Together, Fireworks, Cerebras, xAI and 9Router, plus a custom OpenAI-compatible endpoint. They work the same in Node, PHP, Laravel and WordPress. See [providers](docs/providers.md).
- Optional native tool calling (`tools` mode).
- Provider diagnostics with status, latency and token usage, never content.
- Settings for JSON mode, output-token fields, instruction roles and thinking switches.
- No automatic paid retries.

#### Operations

- Per-session hourly provider budgets in the Node and PHP endpoints (`attemptsPerHour`, default 60).
- Server-side helpers to erase a conversation. See [operations](docs/operations.md).
- `observeUrl` and `redactUrl` for the page observer, and `resetSession()` so each conversation starts with a fresh action budget.

#### Demos

- **OFFBEAT**, an art and culture demo site with thirteen verified actions, a gallery, guided buttons and six expressions. Its private AI chat runs on Vercel with Supabase PostgreSQL for sessions and usage limits. See the [OFFBEAT guide](examples/brutalist-demo/README.md).

#### Foundation

- Capability registry, versioned JSON Schema contracts, and validators compiled at build time that work under a strict CSP.
- Page observation and verified actions, with checks for ambiguous and stale targets, cancellation, and navigation that continues the conversation.
- A chat widget with six emotions.
- PHP and Node conversation engines that keep provider keys on the server, with shared conformance tests.
- Laravel 13, React 19, Inertia v3 and Next.js App Router integrations.
- An onboarding CLI with source and page discovery and an `assistant-setup` skill for Codex and Claude Code.
- A self-contained WordPress plugin ZIP with guided dashboard setup and context export and import.
- Release tooling: source, npm and PHP archives, checksums and compatibility records.

### Fixed

- **WordPress rate limits.** Rate limits and the daily provider budget now use atomic counters, so visitors arriving at the same time no longer get a `409 BUSY`. A used-up daily budget now returns `429 PROVIDER_BUDGET` before any work starts.
- **Laravel empty strings.** Laravel now passes the raw validated request body to the engine. Middleware such as `TrimStrings` used to turn empty page titles into `null` and reject ordinary pages.
- **History size.** Conversation history no longer stores page snapshots of earlier steps, so long tasks no longer run out of context. A request that is still too large ends without using up a model attempt.
- **Timeouts.** After a timeout or cancellation, the browser waits for the abandoned handler to finish before starting the next action, so a late change cannot count as the next action's result.
- **Fragment navigation.** Links that only change the `#fragment` are verified in place.
- **Sensitive URLs.** More sensitive URL parameters (signatures, nonces, tokens, session IDs, one-time codes) now block navigation and observation.
- **Closed `details`.** Content inside a closed `details` element no longer counts as visible.
- **Cancellation.** A cancel just before a handler or verifier starts now stops it from running.
- **OFFBEAT database cleanup.** Expiry cleanup in the OFFBEAT database no longer deletes sessions that were renewed at the same moment.
- **WordPress login test.** The WordPress login test waits for the login page's autofocus before typing.
- **History format.** Assistant history now uses the same response format the model is asked to produce, without internal IDs.

### Security

- Host authorization, CSRF and origin checks, schema validation, saved checkpoints and limits on model attempts.
- WordPress keeps the assistant off until the administrator enables it, with lock ownership and quotas.
- Shared packages are MIT-licensed. The WordPress plugin bundles them under GPL-3.0-or-later with prefixed dependencies and third-party notices.

### Known limitations

This is a beta, not a stable 1.0. It has not yet been tested with many live models, on production hosting, with a wide range of WordPress themes and plugins, or with assistive technology. See [compatibility](docs/compatibility.md) and [security](SECURITY.md).
