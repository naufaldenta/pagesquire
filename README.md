# PageSquire

**Turn conversations into guided actions.**

PageSquire is an open-source foundation for assistants that help people navigate and use websites through registered, verified capabilities.

## Live demo

[Try OFFBEAT — the PageSquire playground](https://pagesquire-offbeat-demo.vercel.app/)

Explore an independent art/culture website with thirteen verified actions: color headings or body text separately, highlight headings or links, change reading typography, filter/search/sort art, jump to sections, and reset page changes. Guided buttons work without a key. **Live AI chat requires the owner's private demo access code** to protect the shared usage budget. Visitors never enter a provider API key.

The frontend and Node API deploy together on Vercel, with private Supabase PostgreSQL session/budget storage. The provider endpoint and model are environment-configurable. See the [demo setup guide](examples/brutalist-demo/README.md) for setup, TLS, migrations, privacy and limits.

## AI providers

Choose a server-side preset: **Sumopod, OpenAI, OpenRouter, Groq, DeepSeek, Qwen/Alibaba Cloud, GLM via Z.AI or Zhipu China, 9Router, Google Gemini, Mistral, Together AI, Fireworks AI, Cerebras, xAI**, or a custom OpenAI-compatible endpoint. Hosted presets need `PAGESQUIRE_PROVIDER`, `PAGESQUIRE_API_KEY`, and `PAGESQUIRE_MODEL`; custom/regional gateways also need `PAGESQUIRE_PROVIDER_URL`. Model IDs are always owner-configured, never hardcoded. WordPress includes a provider dropdown.

See the [support matrix and per-integration setup tutorials](docs/providers.md) for endpoints, compatibility options, required fields, and honest support limits. These are tested transport presets, not a claim that every model is live-certified. Validation, verified actions and usage budgets remain enforced.

## Current status

This repository implements the F0/F1 foundation, F2 Laravel/React alpha, F3 hybrid onboarding, F4 standalone PHP/Node/Next.js integration, and F5 WordPress plugin. It is an early development preview, not a production-ready autonomous assistant.

Implemented:

- Versioned JSON Schema contracts and TypeScript types.
- Build-time compiled validation without browser-side schema compilation or unsafe-eval.
- A shared capability registry with explicit execution and verification bindings.
- Page observation with private-area exclusions and explicit target permissions.
- Verified actions, cancellation, timeouts, replay protection, and action limits.
- Same-origin navigation adapters and minimal full-document navigation checkpoints.
- A neutral accessibility demo and automated contract/browser/package tests.
- A chat widget, same-origin CSRF-aware transport, and one-action-at-a-time conversation client.
- A PHP conversation engine with server-owned history, authorization, schema checks, expiry, and budgets.
- A Laravel 13 adapter and a server-only OpenAI-compatible JSON provider transport.
- A React 19 wrapper, Inertia v3 navigation adapter, and six-state emotion callbacks.
- Local init/scan/report/prepare-ai/validate commands, explicit DOM discovery, and English project-local integration skills for Codex/Claude Code.
- Standalone PHP and Node endpoints, native HTTPS provider transports and injectable atomic storage.
- Shared PHP/Node conformance fixtures, a Next.js App Router adapter and opt-in full-document conversation continuation without persisting transcripts.

- A self-contained WordPress plugin with guided setup, filtered context exports, configuration-only mapping import and verified basic adapters.

Not implemented yet: speech and a bundled Rive renderer. Connect your own licensed avatar using the emotion callback. No live-provider accuracy or production security certification is claimed.

The development repository is [naufaldenta/pagesquire](https://github.com/naufaldenta/pagesquire). F6 adds GitHub-first release preparation; no tagged release or registry package has been published. Package names remain provisional, private and unreserved on npm/Packagist. See [tested compatibility](docs/compatibility.md), [release/download instructions](docs/releasing.md), [changelog](CHANGELOG.md) and [contributing](CONTRIBUTING.md).

## Run the foundation demo

For the independent art playground, see [OFFBEAT](examples/brutalist-demo/README.md). Run `npm run demo:build` then `npm run demo:serve` for a static local preview with guided actions. Root `vercel.json` deploys its static frontend **and** the dedicated `/api/session` and `/api/chat` Node function; other local example servers are not deployed.

Requirements: Node.js 24 or later, npm, PHP 8.3, and Composer. PHP dependencies and browser binaries are required for the full test suite. The tested local host is Windows.

```sh
npm ci
composer install
npm run build
npm run demo
```

Open the local address printed by the server. The demonstration runs without API keys or external AI requests. Its buttons invoke registered capabilities directly so that execution and verification can be inspected independently of model behavior.

## Run the conversation demo

```sh
npm run demo:chat
```

After installing and building as above, open the local address printed by PHP. Try **Make headings red** or **Highlight links and use bold text**. The browser sends requests to the real PHP engine, executes one registered action, then returns the verified result before the next action. The demo uses a deterministic test provider, not an AI model, and needs no key. Never deploy the PHP development router publicly.

For a real model, choose the [Laravel/React integration](docs/laravel-react.md), [standalone PHP integration](docs/standalone-php.md), or [Node/Next.js integration](docs/node-next.md). Supply your own provider endpoint, model, and key on the server; there is no default paid provider. Local Node and Next.js demos use deterministic providers, not live inference.

## Onboard another website

From this checkout, run the local CLI against an existing project:

```sh
npm run pagesquire -- init --root ../my-website --url http://127.0.0.1:8000/
npm run pagesquire -- scan --root ../my-website
npm run pagesquire -- report --root ../my-website
npm run pagesquire -- prepare-ai --root ../my-website --host both
```

Review the installed guidance and invoke `$assistant-setup` in Codex or `/assistant-setup` in Claude Code. Alternatively, map capabilities manually. Finish with `validate --compile` and real browser tests; static validation never claims runtime verification. The CLI does not contact an AI or modify the target application's dependencies. See [hybrid onboarding](docs/onboarding.md) for the full sequence, optional DOM scan and security/coverage boundaries.

## Verification commands

```sh
npm exec -- playwright install chromium
npm test
npm run test:php
npm run test:wordpress
npm run test:next-build
npm run typecheck
npm run format:check
```

On Linux CI, install Chromium's operating-system dependencies with `npm exec -- playwright install --with-deps chromium`.

`npm test` builds the project and installable WordPress ZIP, runs Node/PHP conformance and adapter tests, executes Chromium/PHP/Node/React/Inertia/Next.js and isolated real WordPress workflows, and installs packed npm/Composer artifacts into clean consumers. `npm run test:php` includes native PHP, Laravel and scoped WordPress mapping tests with synthetic credentials. A successful synthetic test does not establish live-model accuracy.

npm consumer locks combine exact locked third-party entries with manifests and integrity hashes read from the actual PageSquire tarballs; no workspace links or registry PageSquire packages are used. Offline consumers require the third-party content cached by the contributor installation; release downloads are not an offline dependency mirror.

WordPress tooling downloads are cached under ignored `.cache/`. Its development server disables regex JIT on Windows, not opcode caching; native optimized PHP hosting is not certified by that fixture. A fixture-only quota clock tests the real budget and minute rollover without depending on request throughput. Neither the clock nor fixture controls are installed in the distributed plugin.

## Workspace

| Path                  | Purpose                                                                  |
| --------------------- | ------------------------------------------------------------------------ |
| `packages/protocol`   | Contracts, schemas, emotion metadata, and standalone validators          |
| `packages/core`       | Framework-independent browser observation and verified execution         |
| `packages/client`     | Conversation loop, HTTP transport, accessible widget, external CSS       |
| `packages/react`      | React lifecycle wrapper and injected Inertia/Next.js navigation adapters |
| `packages/php`        | Conversation engine, native PHP endpoint/provider/store and schemas      |
| `packages/server`     | Node engine, HTTPS provider, Web Request endpoint and storage            |
| `packages/laravel`    | Named endpoint, gates, session-bound state, server provider              |
| `packages/cli`        | Local discovery, safe setup, static compilation and AI handoff           |
| `packages/wordpress`  | Self-contained plugin, guided setup, safe context export/mapping import  |
| `examples/plain-html` | Synthetic website and explicit accessibility handlers                    |
| `examples/php-chat`   | Local-only deterministic PHP conversation demonstration                  |
| `examples/node-chat`  | Local-only Node Web Request/HTTP demonstration                           |
| `examples/nextjs`     | Real Next.js App Router streamed-navigation fixture                      |
| `examples/wordpress`  | Local-only WordPress/SQLite/theme fixtures with a simulated provider     |
| `scripts`             | Build tooling and the localhost-only demonstration server                |
| `tests`               | Unit, browser, and packed-consumer checks                                |
| `docs`                | Runtime contracts and roadmap                                            |

Start with [the runtime guide](docs/runtime.md), [the protocol guide](docs/protocol.md), and [the implementation roadmap](docs/ROADMAP.md).

## Design boundaries

Capabilities are a contract supplied by the website owner. Page text, HTML data attributes, and model output do not grant action permissions. UI elements are observed without becoming actionable automatically. Registered handlers must cooperate with cancellation and verify application state after mutations.

Provider keys belong on a backend. A browser result is untrusted client telemetry, never authorization for a server mutation. Consequential capabilities remain blocked. Reading a website does not require retraining a model, and a scanner cannot infer every hidden business workflow.

Conversation history lives in widget memory and server storage with a fixed expiry; browser transcripts are not persisted. F4 provides opt-in same-tab full-document continuation using short-lived ID/URL checkpoints. It verifies the destination without replaying navigation. The destination must mount the same catalog/client and call client.resumeNavigation() once. Inertia and Next.js SPA navigation use explicit adapters and persistent layouts. File storage is single-host only; serverless/multi-host deployments require shared atomic durable storage and host-wide quotas.

## Language

Canonical documentation, setup guidance, source comments, examples, and generated integration reports are written in English. Future runtime interfaces and assistant conversations remain localizable.

## WordPress alpha

Build with `npm run build` after installing workspace dependencies, then upload `packages/wordpress/dist/pagesquire-0.1.0-alpha.0.zip`. Hosting users need only WordPress 7.1+, PHP 8.3+ and production HTTPS, not Node.js or Composer. The disabled-by-default dashboard guides provider configuration, selected public pages, actual frontend adapter checks, optional `$assistant-setup` / `/assistant-setup` handoff and explicit access/consent approval. Imports accept only closed built-in adapter configuration. Read the [WordPress guide](packages/wordpress/README.md) before enabling; no universal theme/plugin compatibility is claimed.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Shared foundation packages are [MIT](LICENSE); the combined WordPress plugin is [GPL-3.0-or-later](packages/wordpress/LICENSE), with [dependency notices](packages/wordpress/THIRD-PARTY.md) and a corresponding-source archive. No source code, credentials, government documents, mascot files, or branding assets from the JDIH pilot are distributed here. Registry publication remains pending owner authorization.
