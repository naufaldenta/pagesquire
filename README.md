# PageSquire

**Turn conversations into guided actions.**

PageSquire is an open-source foundation for website assistants that act only through capabilities the site owner registered, and that prove each action with a verifier before claiming success.

- **Registered, not guessed.** The model can propose only capabilities you defined, with JSON Schema parameters. Page text and model output never grant permissions.
- **Verified, one step at a time.** The browser runs one action, checks its postcondition, and reports the evidence before the model continues.
- **Your backend, your keys.** Node, PHP, Laravel and WordPress engines own history, budgets and authorization. Provider keys never reach the browser.

**Version `0.1.0-beta.0`: beta testing.** This is not a production-certified autonomous assistant. See [status](docs/status.md).

## Quickstart

### Try it locally

Requirements: Node.js 24+, npm, PHP 8.3 and Composer.

```sh
npm ci
composer install
npm run build
npm run demo
```

Open the printed address. The demo runs registered, verified actions without any API key. `npm run demo:chat` adds a PHP conversation loop with a deterministic provider.

### Add it to your site with one tag

```html
<meta name="csrf-token" content="SESSION_BOUND_TOKEN" />
<script
  src="/assets/pagesquire.min.js"
  data-endpoint="/pagesquire/chat"
  data-content-root="main"
  data-pages="/,/about"
  defer
></script>
```

`npm run build` writes the bundle, stylesheet and catalog to `packages/embed/dist/`. Host them yourself; no public CDN release exists yet. Then point `data-endpoint` at a PageSquire backend that loads the same `manifest.json`. See the [one-tag embed guide](packages/embed/README.md).

### Connect a model

Set `PAGESQUIRE_PROVIDER`, `PAGESQUIRE_API_KEY` and `PAGESQUIRE_MODEL` on the server. There are presets for OpenAI, OpenRouter, Groq, DeepSeek, Gemini, Mistral, Qwen, GLM, Sumopod, Together, Fireworks, Cerebras, xAI, 9Router and any OpenAI-compatible endpoint. See [providers](docs/providers.md), which also covers native tool calling and metadata-only diagnostics.

## Integrations

| Stack                   | Guide                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| Any website, no build   | [One-tag embed](packages/embed/README.md)                                                      |
| Node.js / Next.js       | [Node and Next.js](docs/node-next.md)                                                          |
| Laravel + React/Inertia | [Laravel and React](docs/laravel-react.md)                                                     |
| Plain PHP               | [Standalone PHP](docs/standalone-php.md)                                                       |
| WordPress 7.1+          | [WordPress plugin](packages/wordpress/README.md): upload the built ZIP, no Node.js on the host |
| Existing project        | [Hybrid onboarding CLI](docs/onboarding.md) with `/assistant-setup` for Claude Code and Codex  |

## Live demos

- **[Kabarin](https://pagesquire-kabarin-demo.vercel.app/)**: an Indonesian news portal with navigation, article reading and summaries, search, bookmarks and guided tours. Up to 5 public AI messages per network per day, enforced server-side. This is an owner-assisted integration ([source](https://github.com/naufaldenta/pagesquire-kabarin-demo)).
- **[OFFBEAT](https://pagesquire-offbeat-demo.vercel.app/)**: an art and culture playground with thirteen verified actions. Guided buttons work for everyone; live AI chat requires the owner's private demo access code. Sessions and usage budgets live in private Supabase PostgreSQL ([setup](examples/brutalist-demo/README.md)).

## Features

- **Verified actions.** Cancellation, timeouts, replay protection and a bounded [action progress](docs/action-progress.md) timeline.
- **Assistant driving.** Animated cursor, scoped reading, scrolling, highlights, guided tours and opt-in local speech ([details](docs/assistant-driving.md)).
- **Integration tools.** [Capability inspector](docs/capability-inspector.md) for debugging, and typed public [app context](docs/app-context.md).
- **Generic tools in guarded mode.** Stable element refs, state and diffs, actionability checks, waiting for the page to settle, risk-tiered approvals and server-led recovery ([details](docs/generic-actions.md)).
- **Companion extension (development build).** On local and `.test` sites, a Chromium extension the visitor allows per site gives generic tools real clicks and typing, with its own target checks and an Esc/Stop kill switch ([design and status](docs/companion-extension.md)).
- **Visitor in the loop.** The assistant can ask the visitor to choose, hand them sign-in, CAPTCHA or payment steps ("Your turn"), show a short plan first, and review each action against the request ([details](docs/generic-actions.md)).
- **PageSquire Link.** Two PageSquire sites of different owners and stacks pair with an invitation code and owner-approved scopes (Node, native PHP, Laravel and WordPress today). One site's assistant can then hand a visitor to the partner site, after the visitor approves what is shared, and the partner continues from the goal after one click ([design and setup](docs/link.md)).
- **Streamed server progress.** Visitors see fixed server stages while the model works; replies still arrive only after validation ([details](docs/streaming.md)).
- **English and Indonesian built in.** Widget, approvals, progress, errors and engine replies follow the page language, with per-key overrides ([details](docs/i18n.md)).
- **Reliability and cost controls.** An opt-in completion validator, a privacy-safe trajectory cache that replays verified turns without the model, and screening of typed contact data ([details](docs/generic-actions.md)).
- **Traces and evaluation.** A local trace recorder and viewer, plus a 36-task browser evaluation graded from the final page state ([details](docs/trace-and-eval.md)).
- **[WebMCP](docs/webmcp-and-approval.md) bridge.** Browser-integrated agents can call the same verified capabilities.
- **Opt-in approval** for consequential actions. The server, the host's authorization and a person's per-call approval must all agree ([details](docs/webmcp-and-approval.md)).
- **WordPress.** Read-only WordPress Abilities, guided dashboard setup and lock-free site budgets.
- **Shared contracts.** Versioned JSON Schema contracts with validators compiled at build time (no `eval`), plus shared Node/PHP conformance fixtures.

## Security boundaries

Capabilities, handlers, verifiers and permission callbacks are trusted host code; review every one. Model output, page text and browser results are untrusted data. A browser result is client telemetry, never authorization for a server mutation. Consequential capabilities stay blocked unless the server, the host and a person's approval all opt in. Read [SECURITY.md](SECURITY.md) and the [operations runbook](docs/operations.md) before exposing inference publicly.

## Verify

```sh
npm exec -- playwright install chromium
npm test
npm run format:check
```

`npm test` builds everything, including the WordPress ZIP and the embed bundle. It then runs Node/PHP conformance and unit tests, browser workflows (Chromium, PHP, Node, React, Inertia, Next.js), an isolated real WordPress, and installs from packed artifacts. Synthetic tests do not establish live-model accuracy. On Linux CI, use `playwright install --with-deps chromium`.

## Workspace

| Path                 | Purpose                                                                    |
| -------------------- | -------------------------------------------------------------------------- |
| `packages/protocol`  | Contracts, schemas, emotion metadata and standalone validators             |
| `packages/core`      | Browser observation, verified execution, WebMCP bridge                     |
| `packages/client`    | Conversation loop, HTTP transport, widget, approval prompt                 |
| `packages/react`     | React wrapper and Inertia/Next.js navigation adapters                      |
| `packages/embed`     | One-tag prebuilt bundle with a fixed verified catalog                      |
| `packages/server`    | Node engine, providers, Web Request endpoint and storage                   |
| `packages/php`       | PHP engine, native endpoint, providers and storage                         |
| `packages/laravel`   | Laravel route, gates, session-bound state, provider                        |
| `packages/wordpress` | Self-contained plugin with guided setup                                    |
| `packages/cli`       | Local discovery, setup, validation and AI handoff                          |
| `examples/*`         | Localhost-only demos and fixtures; never deploy them publicly              |
| `docs`               | Guides, contracts, [roadmap](docs/ROADMAP.md) and [status](docs/status.md) |

## Contributing and license

The development repository is [naufaldenta/pagesquire](https://github.com/naufaldenta/pagesquire). See [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md) and [SECURITY.md](SECURITY.md); report vulnerabilities privately. Canonical documentation is English; runtime conversations are localizable.

Shared packages are [MIT](LICENSE). The combined WordPress plugin is [GPL-3.0-or-later](packages/wordpress/LICENSE), with [dependency notices](packages/wordpress/THIRD-PARTY.md). No source, credentials, documents or branding from the JDIH pilot are distributed here. Registry publication awaits owner authorization.
