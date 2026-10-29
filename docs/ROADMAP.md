# Roadmap

This page lists what is built and what comes next. Milestone labels (F0, B1, C2 and so on) are short names used in commits and the changelog.

## Where things stand

PageSquire is at `0.1.0-beta.0`. Everything below works end to end and is covered by a large automated test suite, but it has not yet been tried on many real sites, models or browsers. Nothing is published to npm, Packagist or WordPress.org, and there is no GitHub release yet. The source is on [GitHub](https://github.com/naufaldenta/pagesquire).

Two public demos run on PageSquire: the [Kabarin demo](https://pagesquire-kabarin-demo.vercel.app/) and [OFFBEAT](../examples/brutalist-demo/README.md). The Kabarin demo has a shared daily AI quota.

## Foundation (F0–F6)

| Stage | Scope                                                                         | Status                                                    |
| ----- | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| F0    | Project setup, MIT licensing, workspace, contract fixtures                    | Done                                                      |
| F1    | Observer, registry, executor, verification, cancellation, navigation          | Done                                                      |
| F2    | Chat widget, PHP backend, Laravel, React and Inertia                          | Done                                                      |
| F3    | `init`/`scan`/`report`/`prepare-ai`/`validate` onboarding and the setup skill | Done                                                      |
| F4    | Standalone PHP and Node/Next.js, with shared conformance tests                | Done                                                      |
| F5    | WordPress plugin, dashboard setup, context export and import, basic adapters  | Done                                                      |
| F6    | Compatibility records, community files, release tooling                       | Release tooling done; first GitHub prerelease not yet cut |

**F2** connects the chat widget to a server-side PHP conversation loop and adds a Laravel 13 endpoint plus React 19 and Inertia v3 adapters.

**F3** adds the onboarding commands. Source scans export metadata only, and DOM scans stay within the pages you choose. The setup step installs an `assistant-setup` skill for Codex or Claude Code. See [onboarding](onboarding.md).

**F4** adds [standalone PHP](standalone-php.md) and [Node/Next.js](node-next.md) endpoints with native provider transports, session-bound endpoints and pluggable storage. PHP and Node share one set of conformance tests. The Next.js adapter waits for the destination page to be ready before verifying an action.

**F5** adds the [WordPress plugin](../packages/wordpress/README.md): a self-contained ZIP, page inspection, mapping import, optional setup skills, basic accessibility adapters and full-page navigation. The assistant stays off until the site owner finishes setup and turns it on.

**F6** adds the [compatibility record](compatibility.md), issue and PR templates, adapter authoring docs, the changelog and the [release tooling](releasing.md). Private vulnerability reporting is enabled on the GitHub repository.

## Beta work (B1–B5)

**B1 – Stabilization.** Fixed a WordPress login autofocus race on Windows and cancellation before queued browser handlers start. Added regression tests for separate chat turns, timeouts, late replies and navigation continuation.

**B2 – Model evaluation.** Built the evaluator, a 246-case English/Indonesian contract matrix and a five-scenario real-browser smoke test. A live run against Sumopod passed all five scenarios in twelve calls. Other provider presets are checked against their official documentation and with synthetic tests. See [model evaluation](model-evaluation.md).

**B3 – Outside testers.** Next up: website owners installing PageSquire on their own sites without help from the maintainer. See the [beta guide](beta.md).

**B4 – Security and operations.** Added adversarial Node and PHP tests for authorization, schemas and cost limits, transcript erasure that keeps budgets intact, and a fix for PostgreSQL cleanup racing with session renewal. See the [operations runbook](operations.md).

**B5 – Public beta.** The release tooling understands `alpha` and `beta` versions and checks the beta review records. What remains is the outside-tester round, CI on the final commit, and publishing the first GitHub prerelease. See the [beta guide](beta.md).

## Integration reliability (C2–C4)

These came out of a [review of similar open-source projects](competitor-review.md).

- **C2 – [Capability inspector](capability-inspector.md).** An opt-in developer panel that compares expected capabilities with registered ones, checks targets and shows schemas.
- **C3 – [App context](app-context.md).** Hosts can share typed public state each turn and hide actions that do not apply right now. Works across Node, PHP and Laravel. Server permissions still decide.
- **C4 – [Action progress](action-progress.md).** A factual timeline of each action (checking, executing, verifying) with clear outcomes and recovery hints.

All three are done. The next step is feedback from outside testers rather than more features.

## Assistant driving (D1)

[Assistant driving](assistant-driving.md) adds an optional on-screen cursor and target outline, nested scrolling, menu and control preparation, scoped content reading that skips private areas, guided tours and opt-in local speech. WordPress gets three optional public-content capabilities, off by default. Tests cover Node, PHP, the framework fixtures, WordPress, OFFBEAT and production builds. This has not been measured with live models or assistive technology.

## PageSquire Link (L1)

[PageSquire Link](link.md) lets two PageSquire sites with different owners and stacks pair with a one-time invitation and owner-approved scopes. One site's assistant can then hand a visitor to the partner site in a new tab, carrying only the goal and fields the visitor gave and approved. The partner continues with its own capabilities after one click. Messages between servers are Ed25519-signed, short-lived and single use. The skill catalog uses A2A's skill shape.

- **6A – Pairing.** Invitations, signed envelopes, approval, revocation and link stores for Node, native PHP, Laravel and WordPress, tested across stacks over real HTTP.
- **6B – Handoffs.** The visitor approves on one site, the partner opens in a new tab and its assistant continues after one click.
- **6C – Returns.** The partner can send the visitor back once with a one-line outcome.
- **6D – Partner choice.** When several partners offer the same skill, the visitor chooses. Owners get an overview with local counts.
- **6E – A2A interface.** An optional signed Agent Card lets any A2A agent send a request into the skills an owner opens. The agent receives only a single-use link where the person continues.

All of this is covered by tests but has not yet been tried between two real HTTPS sites with a live model, or with a third-party A2A client.

## Toward 1.0 (R1)

The groundwork is in place: an [API inventory and drift check](api-contract.md), [upgrade and recovery guidance](upgrading.md) and a [maintenance policy](maintenance.md). The API check runs after every build in CI. Synthetic tests cover recovering a Node file store from a checkpoint.

Still to do before a release candidate:

- freeze the public API
- test upgrades and rollbacks between real released versions
- act on feedback from outside testers
- decide the support and maintenance commitments for stable releases

## Next

- Outside-tester round (B3) and the first GitHub prerelease (B5).
- Broader live-model testing across providers, with a set call budget.
- Try Link between two real HTTPS sites and with a third-party A2A client.
- Based on tester feedback: reusable capability packs, turning recorded sessions into test fixtures, source cards for read results, and curated site knowledge with citations.
- Approvals, undo, persistent threads and MCP/AG-UI bridges each need their own protocol and security design first.

## Test coverage notes

**WordPress (F5).** WordPress 7.1.3, PHP 8.3 and the SQLite Database Integration 3.1.0 plugin, in Chromium. All 14 WordPress scenarios pass against the installed ZIP. They cover dashboard setup, administrator, reader and guest access, nonce, Origin and CSRF checks, private-content exclusion, setup-skill export, mapping import, classic and block themes, style verification, the mobile composer, full-page continuation, request and provider budgets, and lock collisions. The 75 PHP tests pass with 269 assertions. Tests use synthetic content and a deterministic provider. MySQL/MariaDB, persistent object caches, multisite, Elementor and WooCommerce are not tested.

**Frameworks (F4).** Windows and Chromium with Node.js 24, PHP 8.3, React 19, Laravel 13, Inertia v3 and Next.js 16.4.2 App Router. At that point 173 tests passed: 75 Node unit tests, 59 PHPUnit tests (239 assertions), 37 browser scenarios and two clean offline package installs. The Next.js production build also passed. Current results are on the [CI page](https://github.com/naufaldenta/pagesquire/actions/workflows/ci.yml).

**Known limits.** One conversation per session, no cross-tab transcript restore, and no bundled Rive renderer. File stores work on a single host only; multi-instance or serverless setups need a shared atomic store. Hosts are responsible for authentication, global quotas, retention and deployment hardening. See the [Laravel guide](laravel-react.md) and [security notes](../SECURITY.md).

## Licensing

The packages are MIT-licensed. The WordPress plugin bundles them under GPL-3.0-or-later, with the Apache-2.0 dependency notices and corresponding source included.
