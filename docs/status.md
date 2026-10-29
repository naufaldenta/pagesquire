# Detailed status

PageSquire **0.1.0-beta.0** is in beta. It works end to end and has a large automated test suite, but it has not yet been tried on many real sites, models or browsers. Nothing is published to npm, Packagist or WordPress.org, and there is no GitHub release yet. See the [roadmap](ROADMAP.md) for what is next.

## What is implemented

- Versioned JSON Schema contracts and TypeScript types.
- Validation compiled at build time, so the browser needs no schema compiler and no `unsafe-eval`.
- A capability registry where every action has an execution and a verification binding.
- Page observation that skips private areas and respects target permissions.
- Verified actions with cancellation, timeouts, replay protection and action limits.
- Same-origin navigation adapters and full-page navigation checkpoints.
- [Action progress](action-progress.md): checking, executing and verifying stages, verified or unverified outcomes, cancellation, timeouts and recovery hints. The shared widget shows a timeline; custom UIs can use the client state directly.
- A chat widget, a same-origin CSRF-aware transport and a conversation client that runs one action at a time.
- A PHP conversation engine with server-side history, authorization, schema checks, expiry and budgets.
- A Laravel 13 adapter and a server-side OpenAI-compatible provider transport.
- A React 19 wrapper, an Inertia v3 navigation adapter and six-state emotion callbacks.
- Onboarding commands (`init`, `scan`, `report`, `prepare-ai`, `validate`), DOM discovery, and setup skills for Codex and Claude Code.
- Standalone PHP and Node endpoints with native HTTPS provider transports and pluggable atomic storage.
- Shared PHP/Node conformance tests, a Next.js App Router adapter and opt-in full-page conversation continuation.
- A self-contained WordPress plugin with guided setup, context export, mapping import and basic adapters.
- [PageSquire Link](link.md) for handing visitors between partner sites, with an optional A2A interface.

Optional local speech is available. There is no bundled Rive renderer or artwork and no hosted speech service; connect your own avatar through the emotion callbacks.

## Feature notes

**Assistant driving.** An animated cursor and target outline, nested scrolling, scoped reading that skips private areas, control bindings, guided tours and opt-in local speech. See [assistant driving](assistant-driving.md) and the `/driving.html` example.

**Capability inspector.** An opt-in [developer panel](capability-inspector.md) that compares expected features with the registered catalog, checks targets and shows schemas, without running actions or AI requests. Try **Open capability inspector** in `/driving.html`. Only put it on a protected developer or admin page. A target being ready is not the same as the server allowing the action.

**App context.** With [app context](app-context.md), hosts share selected public state each turn and hide actions that do not apply right now. The browser checks again before running an action, and server permissions still decide. Deploy matching browser and server versions before turning it on.

**Release tooling.** See [compatibility](compatibility.md), [releasing](releasing.md), the [beta guide](beta.md) and the [beta feedback template](../.github/ISSUE_TEMPLATE/beta_feedback.md). `npm run release:check -- --beta` lists what is still open before a beta release; it is expected to fail until those items are done.

**API and upgrades.** There is an [API inventory and drift check](api-contract.md), [upgrade and recovery guidance](upgrading.md) and a [maintenance policy](maintenance.md). `npm run api:check` needs a build and flags API changes for review. It does not freeze the API.

## Demos

[OFFBEAT](../examples/brutalist-demo/README.md) is a small art site with guided actions. Run `npm run demo:build`, then `npm run demo:serve` for a local preview. The root `vercel.json` deploys its static frontend and the `/api/session` and `/api/chat` Node functions. The other example servers are local only.

The [Kabarin demo](https://pagesquire-kabarin-demo.vercel.app/) is a second live demo ([source](https://github.com/naufaldenta/pagesquire-kabarin-demo)).

The development repository is [naufaldenta/pagesquire](https://github.com/naufaldenta/pagesquire). See also the [changelog](../CHANGELOG.md) and [contributing](../CONTRIBUTING.md).
