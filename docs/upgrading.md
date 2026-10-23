# Upgrade and recovery guidance

C4 adds [runtime/client action progress](action-progress.md) without changing protocol/storage envelopes. Rebuild matching core/client/widget assets. Manually authored `ChatState` fixtures now need `actionProgress: []`; widget busy checks use `data-busy`, with `aria-busy` limited to messages so live status can update. Custom UIs must opt into rendering progress. Navigation checkpoints still contain no timeline/history; no backfilled execution stages or implicit retry/rollback is introduced.

C3 is an opt-in [public-context request extension](app-context.md), not automatic mixed-version migration. Rebuild/deploy matching protocol/core/client and Node/PHP/Laravel/WordPress artifacts before setting `RuntimeOptions.appContext`; leave it unset for older servers. Updated servers accept old requests. Never silently strip context/retry inference on a schema error. Context changes no stored format, principal permission, accounting or pending-result authorization. Availability is checked for fresh handlers, not retroactively for completed work.

C2 adds opt-in [capability inspection](capability-inspector.md) in core/client without changing existing constructor requirements, wire/storage formats or authorization. Mount it only on a host-protected developer/admin surface. Browser visibility now correctly rejects content inside closed native `details` while allowing the first summary: handlers must explicitly prepare hidden controls rather than relying on their layout rectangles. Rebuild browser packages/assets together; no automatic plugin mount or permission expansion is introduced.

D1 adds optional [driving/read/control/tour/speech APIs](assistant-driving.md). Existing real runtime contexts provide `present`; typed hand-built contexts/mocks must add it. WordPress's three new content capabilities are opt-in and require fresh inspection, not automatic permission expansion. Rebuild browser assets and the corresponding PHP/WordPress catalog together. No protocol field or stored-state format changes are introduced; no live-model accuracy or version-pair migration is certified by these additions.

This is R1 **local preparation**, not a certified version-to-version migration or production rollback procedure. No public beta/RC/stable release is recorded yet; the current version is `0.1.0-beta.0`. No command here automatically changes databases, restores backups, revokes tokens or resets usage counters. Review [API boundaries](api-contract.md), [operations](operations.md) and [beta gates](beta.md) first.

## Before changing a host

1. Obtain owner approval, identify the exact old/new commits and verify trusted artifact checksums/source inventories. Record the integration/runtime/browser/model versions actually in use and open blockers. Do not replace public bytes under an existing version/tag.
2. Review the changelog, API-baseline diff, config/legacy aliases, capability IDs/schemas, host requirements and store lifecycle. A matching wire `0.1` does not promise interchangeable private engine state. Unknown/new schemas or required options must fail closed until explicitly supported.
3. Use a disposable or authorized staging clone with synthetic data. Keep local environment files/CA/private keys and customer exports out of the repository, archive and issue tracker. Do not upload raw provider transcripts or browser traces without reviewing them.
4. Arrange bounded owner-approved provider spend separately, or use deterministic providers. Source builds, API checks, synthetic tests and candidate preparation grant no paid-call allowance. No automatic billable retries or model/provider fallback.
5. Establish host-specific backup, maintenance window, data-retention and writer control. A backup is not recovery evidence until its format and restoration are tested safely. Keep shared request/IP/provider budget accounting current and independent of any transcript restore.

## Integration-specific deployment review

- **JavaScript/Node/React:** update matching PageSquire dependencies together from the verified artifact set; keep host locks and declared peers. Rebuild the host's browser and server bundles, and test SSR/import boundaries. Do not copy a single new package into a mixed old dependency graph or serve an old cached client against an unreviewed server contract.
- **PHP/Laravel:** preserve host Composer entries and configuration; merge reviewed changes rather than overwriting config. Keep protocol validators and dependencies aligned. Rebuild the host's normal route/config assets through its own reviewed workflow. Native `principal/state/rate` and Laravel `principal/engine` cache entries are different; no cross-store automatic migration is supplied.
- **WordPress:** back up the authorized site's configuration through its real administrative process, verify the installation ZIP and corresponding source, and stage the update before replacing plugin files. Re-inspect selected pages/mappings/themes and verify actual controls before enabling assistance. Do not delete all `pagesquire_*` options or assume an uninstall clears only transcripts; they include security/configuration/budget data. No multisite/MySQL/persistent-cache upgrade certification is claimed.
- **OFFBEAT/PostgreSQL:** deployment and migrations require separate production authorization. The B4 cleanup correction needs no schema migration. Do not use the disposable test connector on a hosted/application database or restore old budget/session tables to bypass charged usage. Older binaries are not guaranteed compatible with future schemas or fences.

## Staging acceptance

Run source checks and the documented integration tests for the candidate. In the actual host, verify independent chat turns, heading versus body actions, confirmation/ambiguity, unavailable capabilities, navigation, cancellation/timeout/recovery, authorization changes, private-content exclusion, quotas and real postconditions. Explicitly test deployment restarts and simultaneous writers using the host's genuine shared atomic store before claiming that topology. Browser success messages are not postcondition evidence.

For a source checkout:

```sh
npm run build
npm run api:check
npm run typecheck
node --test tests/unit/upgrade-recovery.test.mjs
npm run test:php
npm run test:package
```

These do not replace the full relevant browser/security/release suite or exact-candidate CI. See [releasing](releasing.md) for complete gates.

## Current synthetic recovery evidence

`tests/unit/upgrade-recovery.test.mjs` uses private temporary directories, a deterministic provider, the current Node native endpoint and actual serialized file-store bytes. It quiesces the old fixture before copying a single completed same-format checkpoint to a fresh directory and recreating the handler/engine/store. It covers:

- Pending/cached call IDs, one result continuation and exact replay without duplicate inference.
- Revoked capabilities and changed principals after reopening.
- Persisted failed-provider attempts/request counts without an extra call after exhaustion.
- Legacy-shaped server-owned assistant-history normalization without reset/replayed tools.
- A transcript-erasure quota shell reopening without resurrecting erased messages or pending actions.

This is **same-build/same-format synthetic recovery**, not a historical-release pair, real browser action execution, power-loss/fsync durability proof, distributed failover, arbitrary corrupted-state support, PHP/WordPress store migration or hosted backup restoration. Existing protocol/conformance/browser tests provide separate evidence. No stale backup with newer usage is restored by these tests. The fixtures are not a general database/file-backup product.

## Recovery or downgrade decision

Disable the assistant route and stop/drain **all** writers before a controlled host restore. Identify unknown/in-flight actions; do not automatically replay or claim to undo them. Preserve charged request/provider budgets and audit metadata. Never break a live file/OS/database lock or replace state underneath a successor lease.

Only return to a prior verified binary/config if its schema, current permissions, locks/fences and storage are demonstrably compatible. A stale checkpoint can resurrect erased data, replay state or reduce usage counts: restoring it verbatim is not a safe universal rollback. Follow host-reviewed privacy and accounting reconciliation; do not erase/reset counters to make recovery work. If safe compatibility is unknown, keep assistance disabled and seek operator review rather than guessing a migration.

R1 completion still requires explicit old/new released-candidate upgrade/downgrade fixtures, retained-usage/privacy verification, real pilot feedback, frozen API/support decisions and owner-approved release/maintenance policy. RC/stable version formats remain disabled in tooling until that separate review. No restore/deployment is performed by reading this guide.
