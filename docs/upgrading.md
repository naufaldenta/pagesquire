# Upgrading and recovery

`0.1.0-beta.0` is the first published version, so there are no tested upgrade paths between versions yet. The current version is `0.1.0-beta.0`. This page covers what to check before changing a host and how to recover safely. Nothing here changes databases, restores backups, revokes tokens or resets usage counters for you. Read [API boundaries](api-contract.md), [operations](operations.md) and the [beta guide](beta.md) first.

## Changes that need attention

**Action progress (C4).** [Action progress](action-progress.md) changes no protocol or storage format. Rebuild the core, client and widget assets together. Hand-written `ChatState` fixtures now need `actionProgress: []`. Widget busy checks use `data-busy`; `aria-busy` is now only on messages so live status can update. Custom UIs have to render progress themselves. Navigation checkpoints still hold no timeline or history.

**App context (C3).** [App context](app-context.md) is an opt-in request extension. Deploy matching protocol, core, client and Node/PHP/Laravel/WordPress builds before setting `RuntimeOptions.appContext`, and leave it unset for older servers. Updated servers still accept old requests. If you hit a schema error, fix the mismatch; do not strip the context and retry. App context changes no stored format, permission, accounting or pending-result handling. Availability is checked before new handlers run, not for work already done.

**Capability inspector (C2).** The [capability inspector](capability-inspector.md) is opt-in and changes no constructors, wire or storage formats or authorization. Only mount it on a protected developer or admin page. Content inside a closed `details` element is now treated as hidden, apart from its summary, so handlers must open hidden controls explicitly. Rebuild browser packages together.

**Assistant driving (D1).** The [driving, reading, control, tour and speech APIs](assistant-driving.md) are optional. Real runtime contexts already provide `present`; hand-built typed contexts and mocks must add it. The three new WordPress content capabilities are opt-in and need a fresh page inspection. Rebuild browser assets together with the PHP and WordPress catalog. No protocol fields or stored state changed.

## Before changing a host

1. Identify the exact old and new commits and verify the artifact checksums. Note the integration, runtime, browser and model versions you run, and any open bugs. Never replace files under an existing version or tag.
2. Read the changelog, the API baseline diff, configuration aliases, capability IDs and schemas, host requirements and the store lifecycle. Wire protocol `0.1` on both sides does not mean the engines' private state is interchangeable. Unknown schemas or new required options should fail closed until supported.
3. Use a throwaway or staging copy with synthetic data. Keep environment files, certificates, private keys and customer exports out of the repository, archives and issues. Review provider transcripts and browser traces before sharing them.
4. Set a provider spending limit for testing, or use the deterministic providers. PageSquire makes no automatic paid retries and never falls back to another model or provider.
5. Set up backups, a maintenance window, retention and control over which processes write. A backup only counts once you have restored it successfully in a safe place. Keep request, IP and provider budget accounting separate from any transcript restore.

## Per-integration notes

- **JavaScript/Node/React:** update all PageSquire packages together from the same verified set, keeping your host's lockfile and peers. Rebuild browser and server bundles and test SSR and import boundaries. Do not mix a single new package into an old dependency set, and do not serve an old cached client against a new server.
- **PHP/Laravel:** keep your Composer entries and configuration, and merge changes rather than overwriting config. Keep protocol validators and dependencies aligned. Rebuild route and config caches the way you normally do. Native PHP stores `principal/state/rate` and Laravel stores `principal/engine`; there is no automatic migration between them.
- **WordPress:** back up the site configuration through its admin tools, verify the installation ZIP and its corresponding source, and try the update on staging before replacing plugin files. Re-inspect pages, mappings and themes and check the actual controls before turning the assistant back on. Do not delete all `pagesquire_*` options: they hold security settings, configuration and budgets, not just transcripts. Multisite, MySQL and persistent object caches are untested.
- **OFFBEAT/PostgreSQL:** the B4 cleanup fix needs no schema migration. Never point the test database connector at a hosted or application database, and never restore old budget or session tables to undo charged usage. Older builds may not work with newer schemas or fences.

## Testing on staging

Run the source checks and the integration tests for the candidate. On the real host, check separate chat turns, heading versus body changes, confirmation and ambiguity, unavailable capabilities, navigation, cancellation, timeouts and recovery, permission changes, private-content exclusion, quotas and what actually changed on the page. Test restarts and simultaneous writers with your real shared store before relying on that setup. A success message in the browser does not prove the change happened.

From a source checkout:

```sh
npm run build
npm run api:check
npm run typecheck
node --test tests/unit/upgrade-recovery.test.mjs
npm run test:php
npm run test:package
```

These are a subset. Run the browser, security and release suites too, and check CI for the exact commit. See [releasing](releasing.md).

## What the recovery tests cover

`tests/unit/upgrade-recovery.test.mjs` uses private temporary directories, a deterministic provider, the current Node endpoint and real file-store bytes. It stops the old instance, copies a completed checkpoint to a fresh directory and recreates the handler, engine and store. It checks:

- Pending and cached call IDs, one result continuation and exact replay without a second model call.
- Revoked capabilities and changed principals after reopening.
- Failed provider attempts and request counts that persist, with no extra call after the limit.
- Older-shaped assistant history being normalized without resetting or replaying tools.
- An erased transcript staying erased after reopening, with quotas kept and no pending actions brought back.

All of this is the same build and the same storage format. It does not cover upgrades between released versions, real browser actions, power loss, failover, corrupted state, PHP or WordPress stores, or restoring hosted backups.

## Recovering or downgrading

Turn off the assistant route and stop **every** writer before restoring anything. Find actions whose outcome is unknown; do not replay them automatically or claim to undo them. Keep charged request and provider budgets and audit records. Never break a live file, OS or database lock, or replace state under a newer lease.

Only go back to an earlier build and configuration if its schema, current permissions, locks and storage are known to be compatible. An old checkpoint can bring back erased data, replay state or lower usage counts, so restoring one as-is is not a safe rollback. Reconcile privacy and accounting by hand, and do not reset counters to make recovery easier. If you are not sure it is compatible, keep the assistant off and get someone to review it.

Before a stable release, the project still needs upgrade and downgrade tests between real released versions, checks that usage and privacy survive them, feedback from outside testers, a frozen API and a maintenance policy. The release tooling refuses release-candidate and stable versions until then.
