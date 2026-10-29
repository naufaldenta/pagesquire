# Beta testing

The current development version is **0.1.0-beta.0**. It works end to end and has a large automated test suite, but it has not yet been tried on many real sites, models or browsers. There is no tagged beta release yet: installing from the development branch means installing source, not a published package.

## Live demo

The [Kabarin demo](https://pagesquire-kabarin-demo.vercel.app/) ([source](https://github.com/naufaldenta/pagesquire-kabarin-demo), upstream commit `2e91675605156c73c0a5f553086fec5996573d82`) uses five PageSquire packages and thirteen registered capabilities. It shows cursor driving, scoped reading, action progress and public app context on a Node, Vercel and PostgreSQL backend, and it also keeps a local PHP path.

The demo limits each network to five new messages a day and has separate site and provider caps. The demo stays on its recorded commit until someone upgrades and retests it.

## What beta means

A beta is an unstable prerelease for people who want to test it. It is not a stable API and not a promise that the assistant is ready to act on production sites unsupervised. Beta versions use the `github-beta` release channel. Version numbers follow [SemVer](https://semver.org/spec/v2.0.0.html) with no leading zeroes. The release tooling does not support stable versions, release candidates or build-metadata aliases yet. See the [release policy](releasing.md#versioning-and-10).

What is tested is listed in [compatibility](compatibility.md). The [Sumopod evaluation](model-evaluation.md) is a five-scenario smoke test with one model in twelve calls. It is not an accuracy benchmark, and other providers and models have not been measured live. Screen readers, browsers other than Chromium, shared-store deployments, and WordPress on MySQL, multisite or third-party page builders are untested.

## Readiness check

```sh
npm run release:check
npm run release:check -- --beta
```

The first command validates metadata and prints both regular and beta readiness. It succeeds for a valid local preview even when `publicationReady` and `beta.ready` are false. The second exits with status 1 until every beta and publication item is done. Neither command changes versions, edits approvals, reads production environment files, spends model credits, contacts GitHub or publishes anything.

`release.config.json` has three beta review records. Each has a boolean `approved` and up to eight `docs/*.md` evidence files:

| Review                       | What it needs                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `externalOnboarding`         | Website owners who are not the maintainer install PageSquire from the candidate, note their manual or AI-assisted steps, and get real verified actions without editing core.    |
| `supportScopeReviewed`       | The tested host and browser versions, measured models, excluded targets, installation steps and open bugs are reviewed together. More model testing needs its own budget.       |
| `securityOperationsReviewed` | Authorization, injection boundaries, privacy, cost, failure and concurrency behavior, and the recovery and retention steps are reviewed. Blocking issues are fixed or excluded. |

A record with `approved: false` is context only. The config is rejected if a record is missing or unknown, uses a string instead of a boolean, points at a missing or unsafe file, or says `approved: true` with no evidence. Keep evidence in reviewed docs. Never copy private repositories, raw transcripts, customer exports or credentials into the source or issue attachments.

These flags are set by hand, so a reviewer still has to check the evidence behind them. Revisit a review when the source or support scope changes, and check CI on the exact final commit, not an earlier green one. The repository, security, redistribution, CI, release approval, origin and clean-checkout checks still apply on top of the three beta reviews.

## For testers

1. Get the exact candidate from the maintainer and check its files and checksums with [the release instructions](releasing.md). Until a beta release exists, use a clearly labelled development build.
2. Use a throwaway or staging site with synthetic content and server-side credentials. Do not test consequential actions or real user data. Read [operations](operations.md).
3. Follow [onboarding](onboarding.md) and the guide for your stack: [PHP](standalone-php.md), [Laravel/React](laravel-react.md), [Node/Next.js](node-next.md) or [WordPress](../packages/wordpress/README.md). Review the mappings yourself, or run the generated `$assistant-setup` / `/assistant-setup` skill in your coding agent and check what it did.
4. Test at least: five separate follow-up messages, heading versus body changes, confirmation, unavailable and ambiguous requests, failed verification, cancellation and recovery, navigation continuation, and private-content exclusion. Check what actually changed on the page, not just what the assistant said. Note exactly what you tested.
5. Agree a call and spend budget before using a paid model. PageSquire makes no automatic retries and never falls back to another provider.
6. Send sanitized results with the [beta feedback template](../.github/ISSUE_TEMPLATE/beta_feedback.md). Report security problems [privately](../SECURITY.md), not in public issues. There is no telemetry; a person reviews every report.

## Promoting and publishing a beta

1. Collect outside-tester results and review the support and security scope. Leave untested targets out of scope. Fix blockers and record the reviews honestly.
2. Bump the version everywhere at once: the root and six npm manifests, their internal dependencies, the lockfile, the WordPress header and readme, the compatibility record and the release-notes heading. Set the channel to `github-beta`. Update the [API baseline](api-contract.md) deliberately, including its package version, then rebuild and run the check. Also bump the exact `pagesquire/server` version in the Laravel manifest and the root `composer.json` path repositories. Keep the licenses and public `publishConfig`. Document any breaking change or configuration migration.
3. Follow [publishing a GitHub prerelease](releasing.md#publishing-a-github-prerelease). The Windows, Ubuntu and database CI jobs must pass on the exact final commit. Build from a clean checkout and test every consumer. If anything changes, start again on the new commit.
4. Run `release:check -- --beta` and `release:check -- --publication`, then `release:prepare` and `release:verify` on the clean build. The manifest records the channel, source digest, dirty state and open items. Prepared directories are always labelled `local-preview`.
5. Create a GitHub **draft prerelease** on the reviewed tag, attach all 12 artifacts plus `release-manifest.json` and `SHA256SUMS`, check the list, and publish it as a prerelease, not as latest. Download the files again and verify them. See [GitHub's release docs](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository). Nothing publishes automatically.
6. Record the release URL, commit and file list. Pushing the tag also publishes to npm and Packagist ([publishing](releasing.md#publishing-to-npm-and-packagist)). WordPress.org is a separate, later step.

## Feedback and recovery

Useful reports include the version and commit, integration versions, installation route, whether a coding agent helped, capability IDs, what actually changed on the page, a synthetic reproduction and any core edits you needed. Keep offline checks separate from real model calls, and give the call count rather than keys or private prompts. Review website exports and trace files for secrets before attaching them. There is no guaranteed response time.

If a candidate turns out unsafe, turn off the assistant route and follow [operations](operations.md). Go back to an earlier build only after checking that its configuration and storage are compatible. There is no automatic downgrade, database rollback or quota reset. Do not delete user data or loosen permissions to recover. Mark the bad prerelease as unsuitable and ship a **new version**; never replace assets or move a published tag. See also [API review](api-contract.md), [upgrading](upgrading.md) and [maintenance](maintenance.md).
