# Implementation roadmap

PageSquire is the selected project name. This repository begins the roadmap designed with the JDIH pilot as an architectural reference. All canonical guides are English; runtime localization remains configurable.

| Stage | Scope                                                                                  | Current status                                                                                                        |
| ----- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| F0    | Local identity, independent source, MIT foundation, workspace, contract fixtures       | Implemented locally; public namespaces and release registration remain pending                                        |
| F1    | Observer, registry, executor, verification, cancellation, navigation boundaries        | Implemented; verification results are recorded in progress.md                                                         |
| F2    | Chat widget, backend PHP, Laravel/React/Inertia integration                            | Implemented locally as an alpha; live-provider and production-host evaluation pending                                 |
| F3    | Hybrid init/scan/report/prepare-ai/validate workflow and English integration skill     | Implemented locally; static/DOM discovery, skill handoff and compiled fixture verification                            |
| F4    | Standalone PHP and Node/Next.js integration with protocol conformance                  | Implemented locally as an alpha; shared conformance, native endpoints and browser/package verification complete       |
| F5    | WordPress plugin, dashboard onboarding, context export/import, basic adapters          | Implemented locally as an alpha; real ZIP, guided setup and WordPress backend/browser verification complete           |
| F6    | Compatibility evidence, community materials, local release tooling and public releases | GitHub-first preparation in progress; stable 1.0/remote CI/public release not yet complete; other registries deferred |

## Next implementation milestone

### R1: Release candidate to stable — local foundations, promotion gated

The owner selected R1 preparation while independent beta acceptance is pending. The [API inventory/drift baseline](api-contract.md), [upgrade/recovery evidence](upgrading.md) and [maintenance policy](maintenance.md) establish local review boundaries. Baseline checks run after build in CI and candidate preparation; synthetic same-format Node file-store tests cover checkpoint/replay/authorization/accounting recovery. They do not certify historical-release migration, distributed restore or production rollback. API freeze, pilot findings, released-candidate upgrade matrices, stable maintenance commitments and RC/stable policy approval remain outstanding. Version stays alpha and the existing B3/B5/publication gates are not bypassed.

### B5: Public beta — preparation in progress, publication gated

The owner selected B5. Release tooling now accepts canonical `0.x.y-alpha.n` and `0.x.y-beta.n` previews with matching GitHub channels, explicit beta review records and a failing-until-ready beta check. See [beta testing, evidence and promotion](beta.md). B4 local fixes and beta tooling do not replace independent B3 acceptance, final-candidate CI, support/security/redistribution reviews or owner publication approval. Version remains alpha. B5 is complete only when exact verified clean-checkout artifacts are published as an authorized GitHub prerelease; no registry or stable release is included.

### B4: Security and operations

B4 can proceed while B3 independent-user acceptance is pending. Local implementation adds adversarial Node/PHP authorization/schema/cost regressions, budget-preserving server-only conversation erasure, and concurrent PostgreSQL cleanup/renewal coverage. Cleanup now locks expired candidates and rechecks deletion eligibility instead of deleting newly active sessions or renewed budget rows. See the [operations and data-erasure runbook](operations.md). This is local implementation evidence, not a production deployment, independent penetration test or beta promotion; exact-commit CI and release approval remain separate gates.

### B3: External onboarding — independent acceptance pending

Maintainer-assisted local pilots do not replace installation by genuinely independent website owners. That acceptance remains open and can run in parallel with B4. Private pilot fixtures/results are not bundled in this repository. No beta readiness is inferred from generated setup skills, static validation or the absence of an external bug report.

### B2: Scoped model evaluation

At the owner's request, B2 live access is limited to Sumopod; other presets receive current official-documentation review and synthetic checks. The reproducible evaluator, 246-case EN/ID contract matrix and five-case real-browser smoke are implemented. The owner-approved live Sumopod campaign used all twelve permitted attempts and passed its five scenarios. See [evaluation scope, commands and sanitized evidence](model-evaluation.md). This closes the requested bounded B2 implementation, not the broader multi-provider/large-sample beta accuracy gate. Version and publication channel remain alpha; outside-user onboarding trials and release/security gates remain separate work.

### B1: Stabilization before beta

The owner selected B1 as the next implementation step. Version and release channel remain alpha. B1 addresses the Windows WordPress login autofocus race, cancellation before queued browser handlers/verifiers start, and regression coverage for independent chat turns, timeout/cancellation recovery, late replies and navigation continuation. It does not expand the provider/platform support matrix or certify live-model accuracy.

Promotion requires all required remote jobs on the exact candidate commit, passing clean-consumer artifacts and no unresolved critical defects in the declared support scope. A local fix or passing component test is not remote CI evidence. Live-model evaluation and outside-user installation trials remain subsequent beta-readiness work; registry publication and version promotion need separate review and owner approval.

F2 now connects the chat widget to a bounded server-owned PHP loop, supplies a Laravel 13 endpoint/provider adapter, and includes React 19/Inertia v3 adapters. Neutral heading-color, link-highlight, and font-weight conversations are verified. The JDIH application is not modified; its routes, identity, and licensed assets belong in a separate site adapter. Live-model evaluation and deployment are not part of the completed local alpha.

F3 now provides local init/scan/report/prepare-ai/validate onboarding. Source scans export bounded metadata; opt-in DOM scans stay within an explicit page scope. The coding-agent step installs an English `assistant-setup` skill for Codex and/or Claude Code without contacting either host. Manual and handoff-artifact workflows are tested with compiled browser capabilities. Separate coding-agent adherence and production-site coverage are not certified. See [hybrid onboarding](onboarding.md).

F4 now supplies [standalone PHP](standalone-php.md) and [Node/Next.js](node-next.md) integrations: bounded native provider transports, session/principal-bound endpoints, injectable atomic storage and shared PHP/Node conformance cases. The Next.js adapter waits for actual destination readiness and then runs the registered verifier. Opt-in full-document conversations resume verified navigation without replaying the handler or persisting browser transcripts. English onboarding skills cover these framework boundaries.

F5 now provides the [WordPress plugin and English dashboard workflow](../packages/wordpress/README.md): a self-contained ZIP, selected public-page metadata/DOM inspection, configuration-only mappings, optional Codex/Claude setup skills, basic accessibility adapters and exact-page full-document navigation. Administrator authorization, separate chat CSRF, durable database locks and site-wide provider budgets are enforced. The assistant stays disabled until the owner completes verification and explicitly enables it.

F6 now prepares GitHub-first alpha releases: [compatibility evidence](compatibility.md), English community templates, adapter authoring, changelog, [release instructions](releasing.md), metadata/source-freshness gates and locally verified artifact/checksum preparation. The owner-authorized [public development repository](https://github.com/naufaldenta/pagesquire) exists with private vulnerability reporting enabled. Packages stay private. npm, Packagist and WordPress.org are deferred by the owner. No tagged release has been published; remote CI evidence, redistribution review and owner release approval remain release gates. This is not completion of the original stable-1.0/publication criteria.

## F5 verification scope

The WordPress fixture uses WordPress 7.1.3, PHP 8.3, the official SQLite Database Integration 3.1.0 compatibility layer and Chromium. All 14 WordPress scenarios passed against the installed ZIP. They exercise dashboard setup, administrator/reader/guest boundaries, nonce/Origin/CSRF checks, private-content exclusion, both setup-skill exports, closed mapping import, content/theme invalidation, classic/core block themes, computed style verification, mobile composer visibility, one-shot full-page continuation, request/provider budgets and lock collision/owner protection. All 75 PHP tests passed with 269 assertions. Node, framework-browser, distribution and optimized Next.js build checks supplement these feature checks; verification is performed as component runs, not a claim that an interrupted monolithic test run completed.

These are local tests with synthetic content/accounts and a deterministic provider, not live-model accuracy or universal WordPress compatibility. MySQL/MariaDB production topology, multi-worker load, persistent object caches, multisite, Elementor, WooCommerce, assistive technologies and live-host deployment are not certified. The combined WordPress package is GPL-3.0-or-later with isolated Apache-2.0 dependencies and corresponding sources; shared PageSquire packages remain MIT.

## F4 verification scope

The local target at the F4 checkpoint was Windows/Chromium with Node.js 24, PHP 8.3, React 19, Laravel 13/Inertia v3 and Next.js 16.4.2 App Router. Verification passed 173 tests: 75 Node unit tests, 59 PHPUnit tests (239 assertions), 37 real-browser scenarios and two clean offline distribution consumers. Production Next.js fixture build, package type checks and format checks also passed. The browser Next.js conversation runs on its development fixture; a build is not a production-host certification. Remote CI had not yet run at that historical checkpoint; F6 [current commit checks](https://github.com/naufaldenta/pagesquire/actions/workflows/ci.yml) are separate evidence.

Remaining alpha limitations include one conversation slot per session, no cross-tab/general transcript restoration, no bundled Rive renderer, and no live-provider/assistive-technology/production-host certification. File stores are single-host only; multi-instance/serverless deployments require host-supplied shared atomic durable storage. Host authentication, global quotas, retention and deployment hardening remain required. Callback-based six-state emotion integration is available. See [the Laravel guide](laravel-react.md) and [security scope](../SECURITY.md).

## Publication gates

- Select and control repository/package accounts and namespaces.
- Resolve source and asset redistribution rights for each added integration.
- Smoke-test release artifacts on clean consumers and tested hosts.
- Preserve package-specific WordPress licensing, corresponding sources and dependency notices in release artifacts.
- Review English public documentation and current implementation limitations.
- Publish only after the owner authorizes the external release.
