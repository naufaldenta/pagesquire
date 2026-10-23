# Public beta preparation

The owner approved **0.1.0-beta.0 as a development beta candidate** on 2026-10-24 after reporting a successful Kabarin integration. This is a source/testing status, not a published beta tag, download, independent acceptance or stable-support certification. Independent B3 acceptance and final-candidate CI/reviews remain pending. Installing the development branch is not installing a published beta release.

## Owner-assisted acceptance record (2026-10-24)

The owner explicitly confirmed that the successful trial was performed by the owner, not an independent website owner. The separate [Kabarin source](https://github.com/naufaldenta/pagesquire-kabarin-demo) records upstream commit `2e91675605156c73c0a5f553086fec5996573d82`, five selected packages and thirteen registered capabilities. The host integrates cursor driving, scoped reading, action progress, public context and a Node/Vercel/PostgreSQL adapter; it also retains a local PHP path. This is one owner-assisted integration report, not acceptance of all framework/model combinations or a no-core-edit independent trial. No private project exports, keys or raw transcripts are included here.

The [public demo](https://pagesquire-kabarin-demo.vercel.app/) applies a host-owned network quota of five new messages/day and separate site/provider caps. This does not turn an anonymous IP into a verified user or certify production security. The demo provenance remains at its recorded upstream revision until explicitly upgraded/tested. `beta.externalOnboarding.approved` intentionally remains false. Support/security/publication approvals are not inferred from the owner's successful trial, a running demo or this version change. No tag/release/assets/registries are published by updating these files.

## What beta will mean

A beta is a deliberately scoped, unstable prerelease for consenting testers, not a stable API or production-autonomy promise. The first candidate may use `0.1.0-beta.0` **only after approval**, with `github-beta` as its release channel. Canonical numeric identifiers have no leading zeroes. Stable versions, RCs, build aliases and registry publishing remain unsupported by this release workflow. See [SemVer](https://semver.org/spec/v2.0.0.html) and [release policy](releasing.md#versioning-and-10).

The intended scope is the exact versions/fixtures in [compatibility](compatibility.md). The [Sumopod evaluation](model-evaluation.md) is a twelve-attempt, five-scenario smoke on one configured model; it is not a 95% benchmark, repeated accuracy study or certification of every supported provider preset. All other combinations remain experimental until measured. No provider/model is silently promoted by a beta label. Screen readers, other browsers, general production/shared-store topologies and WordPress MySQL/multisite/third-party builders remain unverified unless new evidence explicitly adds them.

## Readiness check

```sh
npm run release:check
npm run release:check -- --beta
```

The first command validates metadata and prints regular **and beta** readiness. A valid alpha preview can succeed while `publicationReady` and `beta.ready` are false. The second exits with status 1 until the version is beta and all beta/publication/clean-checkout gates are satisfied. Neither command changes versions, edits approvals, reads production environment files, spends model credits, contacts GitHub or publishes anything.

`release.config.json` records three beta reviews, each with an explicit boolean `approved` and up to eight distinct repository-relative `docs/*.md` evidence references:

| Review                       | Evidence the maintainer must actually obtain                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `externalOnboarding`         | Consenting independent owners install the intended integrations from the candidate, record manual/AI-assisted steps and real verified actions without modifying core. Maintainer-generated local labs do not satisfy independence. |
| `supportScopeReviewed`       | Exact host/browser versions and measured model combinations, experimental/unsupported exclusions, installation instructions and open defects are reviewed together. Broader model testing needs its own explicit budget.           |
| `securityOperationsReviewed` | Candidate-specific authorization, injection boundaries, privacy/cost/failure/concurrency evidence and the recovery/retention procedure are reviewed; blocking findings are resolved or excluded from the actual support scope.     |

Existing document references with `approved: false` are context, not acceptance. Missing/unknown records, string approvals, unsafe/missing references or `approved: true` with no evidence invalidate configuration. Keep sanitized evidence in reviewed English guides; never copy private lab repositories, raw transcripts, customer exports or credentials into source/issue attachments.

These records are **operator attestations**, not independently authenticated proof. A file's existence or a boolean cannot prove an independent trial, CI success or permission to publish. Reviewers must verify the underlying evidence. Reassess affected reviews on source/support changes; verify remote CI for the exact eventual commit, not an earlier green revision. The existing repository/security/redistribution/CI/owner-approval/origin/clean-checkout gates still apply. Passing only the three beta reviews is insufficient.

## Independent tester path

1. Obtain the exact candidate from the maintainer and verify its inventory/checksums with [the release instructions](releasing.md). Before a public beta exists, use a clearly identified alpha/development candidate, not an invented beta download URL.
2. Use a disposable or authorized staging website, synthetic content and server-only credentials. Do not trial consequential actions or sensitive production data. Read [operations and privacy](operations.md).
3. Follow [onboarding](onboarding.md) and the relevant [PHP](standalone-php.md), [Laravel/React](laravel-react.md), [Node/Next.js](node-next.md) or [WordPress](../packages/wordpress/README.md) guide. Review manual mappings, or optionally invoke the generated `$assistant-setup` / `/assistant-setup` skill in your coding agent. A generated skill is not evidence that the agent followed it.
4. Test at least: five separate follow-ups, heading/body separation, confirmation, unavailable and ambiguous actions, failed verification, cancellation/recovery, navigation continuation, and private-content exclusion. Inspect actual postconditions, not just assistant text. Record the exact tested scope; this checklist is not a statistical model-accuracy benchmark.
5. Keep paid inference opt-in with an agreed call/spend budget, no billable automatic retries or provider fallback. Existing maintainer B2 allowance is exhausted; installing or checking beta readiness grants no new allowance.
6. Report sanitized results through the [beta feedback template](../.github/ISSUE_TEMPLATE/beta_feedback.md). Security defects go through [private reporting](../SECURITY.md), not public issues. Independent acceptance records need human review; no auto-approval or external telemetry is installed.

## Maintainer promotion and delivery

1. Collect independent acceptance and review the narrowed support/security scope. Keep unknown/unverified targets excluded. Resolve blockers and record truthful review evidence/approvals; do not mark pending work complete to make a command green.
2. After the owner approves promotion, synchronize the root/six npm manifests, their internal dependency versions, root/workspace lock entries, WordPress header/readme, compatibility release and release-notes heading. Change the release channel to `github-beta`. Review and deliberately update the [API baseline](api-contract.md), including its package version, then rebuild/check it. Preserve `private: true`, licenses and deferred registries. Document any breaking change/configuration migration; beta does not freeze the public API.
3. Follow [owner-controlled publication](releasing.md#owner-controlled-github-publication): commit/push only with authorization, pass required Windows/Ubuntu/database jobs on the **exact final commit**, then build from a clean checkout and test all consumers. If metadata/source changes, use the new commit and fresh checks; previous evidence is not transferred automatically. Approval flags are local bookkeeping, not a substitute for these checks.
4. Run both `release:check -- --beta` and `release:check -- --publication`. Run `release:prepare` and `release:verify` on the matching clean build. The manifest includes channel, source digest, dirty state and pending gates. Every prepared directory is still labelled `local-preview`; neither packaging nor checksum verification authorizes publication.
5. Only with authorization, create a GitHub **draft prerelease** on the exact reviewed tag/commit, attach all 12 artifacts plus `release-manifest.json` and `SHA256SUMS`, inspect the full inventory, and publish as prerelease, not latest/stable. Re-download and verify identical bytes. See [GitHub's release procedure](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository). No automatic publisher or write-enabled CI is added.
6. Record the public URL, exact commit and verified inventory. This closes B5; local tooling/preparation alone does not. npm, Packagist and WordPress.org remain separate, deferred workflows.

## Feedback, recovery and maintenance

Include version/commit, integration versions, installation route, manual versus coding-agent assistance, capability IDs, verified postconditions, synthetic reproduction and any core edits required. Separate offline checks from real-model calls and report call count, not keys/prompts containing private data. Do not attach raw website exports or trace archives without reviewing them for secrets. There is no guaranteed response time or telemetry upload.

If a candidate is unsafe, disable the assistant route, contain the incident using [operations](operations.md), and return to an independently verified prior build only after checking host configuration/storage compatibility. No universal downgrade migration, database rollback or quota reset is provided. Do not delete user data or loosen permissions to recover. Mark the affected prerelease unsuitable and issue a **new version** for changed public bytes; never silently replace assets or retarget a published tag. R1 now supplies [local API review](api-contract.md), [synthetic recovery evidence](upgrading.md) and [maintenance guidance](maintenance.md); actual API freeze, historical-release upgrade/rollback certification and stable support commitments remain gated.
