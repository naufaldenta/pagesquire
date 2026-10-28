# Detailed status

PageSquire **0.1.0-beta.0** is in beta testing, not a production-ready autonomous assistant. This repository implements the F0/F1 foundation, F2 Laravel/React integration, F3 hybrid onboarding, F4 standalone PHP/Node/Next.js integration, and F5 WordPress plugin.

Implemented:

- Truthful local [action progress and recovery guidance](action-progress.md): checking/executing/verifying, verified/unverified outcomes, cancellation/timeouts, explicit cache replay and pending destination verification. The shared widget includes a bounded timeline; custom UIs can use the client state/helper without changing providers or backend schemas.
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

Optional local-first speech is available; a bundled Rive renderer/artwork and hosted speech service are not included. Connect your own licensed avatar using the emotion callback. No live-provider accuracy or production security certification is claimed.

The development repository is [naufaldenta/pagesquire](https://github.com/naufaldenta/pagesquire). F6 adds GitHub-first release preparation; no tagged release or registry package has been published. Package names remain provisional, private and unreserved on npm/Packagist. See [tested compatibility](compatibility.md), [release/download instructions](releasing.md), [changelog](../CHANGELOG.md) and [contributing](../CONTRIBUTING.md).

B5 adds [guarded public-beta preparation](beta.md), prerelease-aware candidate tooling and an [independent tester feedback template](../.github/ISSUE_TEMPLATE/beta_feedback.md). The owner-approved development version is now **0.1.0-beta.0**, a **beta candidate for testing**, not a published/tagged beta release. The owner reports successful AI-assisted Kabarin integration; independent-user acceptance remains pending. Run `npm run release:check -- --beta` to inspect the remaining gates: it must still fail until actual reviews and final-candidate evidence are complete. No API freeze, stable support or registry availability is implied.

R1 local foundations add an [API inventory and drift baseline](api-contract.md), [upgrade/recovery guidance](upgrading.md) and [maintenance policy](maintenance.md). `npm run api:check` requires a build and flags changes for review; it does not freeze the API, prove historical-release upgrades or enable RC/stable publication.

## Feature notes

Optional assistant driving now includes an animated cursor/target outline, nested scrolling, private-aware scoped reading, desired-state control bindings, guided tours and opt-in local-first speech. See [assistant driving and feature parity](assistant-driving.md) and the `/driving.html` offline example. No reference-site content, third-party accessibility UI or licensed Rive/TTS assets are bundled.

For integration debugging, the opt-in [capability inspector](capability-inspector.md) compares expected features to the registered catalog, diagnoses host-selected targets, and exposes schemas plus metadata-only diagnostics without running actions or AI requests. Try **Open capability inspector** in `/driving.html`. Keep it on a host-protected developer/admin surface; target readiness is not server authorization or a verified action. See the [competitor source review and next priorities](competitor-review.md) for C2/C3/C4 scope.

Optional [public app context and contextual availability](app-context.md) lets hosts share explicitly selected typed public state on each round and suppress actions that are not currently applicable. The browser rechecks before executing; server permissions, pending-result handling and verification remain authoritative. Deploy matching browser/server schemas before enabling it; no whole-store upload, model training or extra provider call is required.

For the independent art playground, see [OFFBEAT](../examples/brutalist-demo/README.md). Run `npm run demo:build` then `npm run demo:serve` for a static local preview with guided actions. Root `vercel.json` deploys its static frontend **and** the dedicated `/api/session` and `/api/chat` Node function; other local example servers are not deployed.
