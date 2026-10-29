# Security and operations runbook

Guidance for people running PageSquire on their own sites. It is not a penetration test, a legal retention policy or a guarantee against prompt injection. Nothing here contacts providers, changes production configuration or wipes a database for you.

## Trust and failure policy

Page text, chat messages, model output and browser results are all untrusted. The boundary is enforced by host authorization, the server-side catalog, closed schemas and postcondition checks. Prompt instructions cannot guarantee what the user meant; see [OWASP's prompt injection guidance](https://genai.owasp.org/llmrisk/llm01-prompt-injection/). Keep consequential actions off, and never take permissions, identity or provider URLs from what the model or browser says.

| Failure                               | Safe response                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Provider timeout/error/invalid output | Keep the charged attempt; return a sanitized error; no automatic paid retry, fallback or success |
| Storage/checkpoint unavailable        | Fail before calling the model if the checkpoint or budget cannot be saved; no in-memory fallback |
| Lock collision                        | Return busy; let the original request finish; never break a live lock or run in parallel         |
| Lost lease                            | Reject stale writes and keep the newer owner's fence                                             |
| Failed browser verification           | Stop further actions; report unverified, whatever the model says                                 |
| Permission/identity changes           | Reject the old continuation; conversation IDs and checkpoints are not authorization              |

Conversation and session limits are not spending caps. Keep shared provider, IP and site budgets and the vendor's own spend limits. Never reset counters to recover from an error.

## Incident recovery

1. Turn off the affected assistant route at the host or edge. Stop new model calls and revoke compromised host or provider credentials through their real controls. Clearing a cookie does not revoke anything on the server, and cancelling in the browser does not stop a model call already sent.
2. Keep minimal event metadata: time, commit, code, HTTP status and the lock identifiers you need. Never log raw transcripts, cookies, keys, access codes, database URLs or provider error bodies. See [OWASP's logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html#data-to-exclude). PageSquire sends no telemetry.
3. Diagnose connectivity, permissions, disk space, corrupt state, failed checkpoints and budgets with synthetic data and no live model calls. Never replay an action automatically when its outcome is unknown.
4. **Node orphan file lock:** stop **every** writer for that store directory and confirm the owner cannot write again. Only then remove the exact empty `<sha256>.lock` directory, after checking its resolved path is inside the store. Lock age or a missing local PID is not enough across containers or hosts. Never recursively delete a parent directory or remove state files while workers run.
5. **PHP OS locks** release when the owner exits; do not unlink a lock file another worker may hold. **WordPress** uses token-owned database locks: stop the relevant workers and check the exact owner. Do not flush the options table or use file-lock steps on WordPress.
6. **OFFBEAT PostgreSQL** uses expiring fenced leases. A new owner can take over after expiry; never clear an active newer owner. Cleanup picks a bounded batch with `FOR UPDATE SKIP LOCKED` and rechecks expiry and lease before deleting, so concurrent renewals survive. See [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html). The cleanup fix needs no schema migration.
7. Test the fixed build's authorization, quotas, failure recovery and real postconditions before reopening gradually. CI must pass on the release commit. A local fix does not update a deployed service.

File stores need one persistent host and directories outside the web root that only the service account can read. Custom or shared stores must serialize access per key and durably commit every checkpoint. Power loss, network filesystems, multi-region setups and third-party outages are untested.

## Erasing a transcript without resetting quotas

The host verifies privacy requests and gets the exact session key and principal from its trusted session service. Finish or cancel any browser work in progress and suspend access if needed. These helpers are for trusted server jobs only, **not public endpoints or model tools**. Never accept an identity or store path from a visitor.

```ts
import { forgetConversation } from '@pagesquire/server';
const changed = await forgetConversation(store, sessionKey, principal);
```

```php
use PageSquire\Server\Http\ConversationPrivacy;
$changed = ConversationPrivacy::forget($store, $sessionKey, $principal);
```

They work with the Node `createChatHandler` and native PHP `ChatEndpoint` record (`principal`, `state`, `rate`). Each helper takes the existing exclusive lock, requires a matching principal and durably replaces only `state` with `null`. That removes the transcript, pending action and cached reply but keeps request counters and other host metadata. Separate provider, IP and global budgets are untouched. The result is `true` if content was cleared and `false` if the state was already empty or missing. A wrong identity, an active lock, corrupt rate data or a failed save throws an error. Old conversation IDs cannot resume. PHP may keep its normal empty lock file for a missing record.

This does not revoke cookies, undo browser changes, clear messages or checkpoints in the browser, securely overwrite disk blocks, erase backups or delete data held by the provider. Clear the client separately and follow your host and provider retention procedures. The remaining record still holds quota metadata, so `state: null` is not full deletion of personal data.

Per integration:

- **OFFBEAT:** use its PostgreSQL store and the exact trusted session identity. Keep the lease and fence fields and the budget tables. Expired rows are cleaned up opportunistically, at most 100 rows per table per batch, so there is no deadline. Schedule maintenance if you need one. Logout only clears the cookie; it does not call this helper or revoke signed tokens on the server.
- **File stores:** keep the quota record and lock conventions. There is no sweep or physical deletion job; review retention once the counters have expired and writers have stopped.
- **Laravel:** the adapter stores a different `principal`/`engine` cache record with middleware lock and rate keys, so do not use these helpers on it. A host job must take the existing session lock, remove only that conversation entry and keep request and provider counters. PageSquire ships no Laravel deletion route or job.
- **WordPress:** native chat has the PHP helper with `OptionsStore`; only a trusted operator integration with the exact identity should call it. There is no public or admin deletion route, privacy-exporter hook or uninstall wipe. Do not delete all `pagesquire_*` options: they hold configuration, security settings and budgets. Scheduled retention is up to the host.

## What the tests cover

Deterministic Node and PHP tests cover invented, consequential and revoked tools, injected parameters, failed-attempt accounting, erasure identity, locking and idempotence, corrupt counters, failed saves and storage outages, all without model calls. They test the application boundary, not how well a live model resists prompt injection.

Throwaway PostgreSQL tests reproduce the old cleanup and renewal race and check that sessions and budgets now survive, along with bounded batches, fenced leases and transcript-only erasure. `npm run test:demo-db` needs `PAGESQUIRE_TEST_DATABASE_URL` set explicitly: an explicit user, a loopback host only, a database named `pagesquire_test` or `pagesquire_test_<suffix>`, and no query or fragment. Connection options are built from the validated fields instead of handing the URL to the driver. The test creates its own schema with synthetic rows, so never point it at an application database. It does not load production environment files. Local PostgreSQL results do not cover hosted Supabase.

There has been no independent penetration test, production rollout, legal compliance review or assistive-technology review yet.
