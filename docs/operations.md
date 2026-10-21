# Security and operations runbook

Alpha guidance for authorized website operators, not a penetration-test certificate, legal retention policy or guarantee of prompt-injection prevention. No procedure automatically contacts providers, changes production configuration or wipes a database.

## Trust and failure policy

Page text, chat, model output and browser results remain untrusted. Actual host authorization, the server catalog, closed schemas and postcondition checks enforce the boundary. Prompt instructions cannot guarantee user intent; see [OWASP prompt injection guidance](https://genai.owasp.org/llmrisk/llm01-prompt-injection/). Keep consequential actions disabled and do not derive permissions, identity or provider URLs from model/browser claims.

| Failure                               | Safe response                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Provider timeout/error/invalid output | Preserve charged attempts; return sanitized failure; no automatic billable retry/fallback or success claim |
| Storage/checkpoint unavailable        | Fail closed before inference when the pre-call checkpoint/budget cannot be saved; no memory-store fallback |
| Lock collision                        | Return busy; resolve the original request; never break a live lock or replay in parallel                   |
| Lost lease                            | Reject stale writes and preserve the successor's fence                                                     |
| Failed browser verification           | Stop further actions; report unverified, not model-narrated success                                        |
| Permission/identity changes           | Reject old continuation; conversation IDs/checkpoints are not authorization                                |

Conversation/session limits are not currency caps. Keep shared provider/IP/site budgets and vendor-side spend controls. Do not erase counters to recover from an error.

## Incident recovery

1. Disable the affected assistant route at the host/edge. Stop new inference and revoke compromised host/provider credentials through their real controls. Clearing a cookie is not server-side revocation; browser cancellation does not guarantee remote inference stopped.
2. Preserve restricted event metadata: time, commit, code, HTTP status and necessary lock identifiers. Never log raw transcripts, cookies, keys, access codes, database URLs or provider errors. Follow [OWASP logging exclusions](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html#data-to-exclude). No new external telemetry is enabled.
3. Diagnose connectivity, ACLs, space, corrupt state, failed checkpoints, permissions and budgets using synthetic data without live inference. No automatic action replay after an unknown outcome.
4. Node orphan file lock: stop **all** writers for that private directory and positively verify the owner cannot write again. Only then remove the exact known empty `<sha256>.lock` directory, after verifying its resolved path stays inside the intended store. Age/missing local PID alone is insufficient across containers/hosts. Never recursively delete a computed parent or remove state files while workers run.
5. PHP OS locks release on owner exit; do not unlink a lock inode while another worker can hold it. WordPress uses token-owned database locks: stop relevant workers and review the exact owner. Do not flush the options table or apply file-lock commands to WordPress.
6. OFFBEAT PostgreSQL uses expiring fenced leases. Allow a fresh owner after expiry; do not clear an active successor. Cleanup uses bounded `FOR UPDATE SKIP LOCKED` candidates and target expiry/lease rechecks, preserving concurrent renewals. See [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html). The cleanup correction requires no schema migration.
7. Test the exact fixed build's authorization, quota, failure recovery and real postconditions before reopening gradually. Required CI must pass on the eventual release commit. Local success does not update a deployed service.

File stores require one persistent host and service-account-only directories outside the web root. Custom/shared stores must serialize each key and durably commit every checkpoint. Power-loss, arbitrary network filesystems, multi-region topology and third-party outages are not certified.

## Transcript erasure without quota reset

The host verifies privacy requests and obtains the exact key/principal from its trusted session service. Resolve/cancel affected browser work and suspend/revoke access when appropriate. These APIs are trusted server jobs, **not public endpoints or model tools**; never accept visitor-supplied identities/store paths.

```ts
import { forgetConversation } from '@pagesquire/server';
const changed = await forgetConversation(store, sessionKey, principal);
```

```php
use PageSquire\Server\Http\ConversationPrivacy;
$changed = ConversationPrivacy::forget($store, $sessionKey, $principal);
```

Use the Node `createChatHandler`/native PHP `ChatEndpoint` envelope (`principal`, `state`, `rate`). The helpers acquire the existing exclusive transaction, require a matching principal and durably replace only `state` with `null`. This removes its transcript, pending action and cached reply, retaining request buckets and other host metadata. Separate provider/IP/global budgets are untouched. Return `true` for cleared content, `false` for already-empty/missing state. Wrong identity, active lock, corrupt rate metadata or failed save throws instead of claiming success. Old conversation IDs cannot resume. PHP may retain its normal empty lock file for a missing record.

This does not revoke cookies, undo browser effects, clear client messages/checkpoints, securely overwrite blocks, erase backups or delete vendor-held data. Resolve client work and clear the client; follow separate host/provider retention procedures. A quota shell retains metadata: `state: null` is not complete personal-data deletion.

Integration boundaries:

- **OFFBEAT:** use its PostgreSQL store and exact trusted session identity. Keep lease/fence fields and budget tables. Expiry cleanup is opportunistic, at most 100 rows/table/batch, not a deadline guarantee. Schedule reviewed maintenance if required. Existing logout only clears the cookie; it does not call this helper or revoke signed tokens server-side.
- **File stores:** retain the quota shell/lock conventions. No universal sweep or physical deletion scheduler is supplied; review retention after all relevant counters expire and writers stop.
- **Laravel:** the adapter has a different `principal`/`engine` cache envelope and middleware lock/rate keys. Do not use these helpers on it. A host-authorized job must take its existing session lock, remove only the affected conversation entry and preserve request/provider counters. No new Laravel deletion route/job is supplied; verify host lifecycle first.
- **WordPress:** native chat has the prefixed PHP helper and `OptionsStore`; only a trusted operator integration with the exact identity may use it. No new public/admin deletion route, privacy-exporter hook or uninstall wipe is added. Do not delete all `pagesquire_*` options: they include configuration/security/budgets. Scheduled retention needs host review.

## B4 evidence and limits

Deterministic Node/PHP tests cover hostile invented/consequential/revoked tools, injected parameters, failed-attempt accounting, erasure identity/lock/idempotence, corrupt buckets, failed saves and storage outages without inference. These are application-boundary tests, not live-model prompt-injection accuracy measurements.

Disposable PostgreSQL tests reproduce prior cleanup/renewal deletion and verify corrected session/budget preservation, bounded batches, fenced leases and transcript-only erasure. `npm run test:demo-db` requires an explicitly supplied `PAGESQUIRE_TEST_DATABASE_URL`: explicit user, loopback only, database `pagesquire_test` or `pagesquire_test_<suffix>`, no query/fragment overrides. Connection options are built from validated fields rather than passing the URL to the driver's override parser. It creates the private schema and synthetic rows; never target an application database. Production demo environment files are not loaded. Local PostgreSQL is not hosted Supabase certification.

Remain alpha until independent B3 onboarding, compatibility/model scope, required exact-commit CI, redistribution/security review and owner-approved prerelease gates are met. No independent penetration test, production rollout, legal compliance or assistive-technology review is certified.
