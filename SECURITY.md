# Security

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/naufaldenta/pagesquire/security/advisories/new). Include the affected version or commit, a minimal reproduction with synthetic data, the impact, and a suggested fix if you have one. Never post exploit details, live credentials or visitor data in a public issue.

If GitHub reporting is unavailable, open a public issue that only asks for a private contact, with no details. There is no separate security email.

## Supported versions

The only version is `0.1.0-beta.0`, published on npm and Packagist. There is no GitHub release yet. Older commits and production deployments are not supported. There is no guaranteed response time or backport policy. Security fixes will be listed in the release notes with the affected and fixed versions. See the [compatibility matrix](docs/compatibility.md) for what is tested.

## Security model

PageSquire is not ready to run arbitrary actions on production sites unsupervised. Automated tests use synthetic content and credentials, not live accounts.

Manifests, installed handlers, verifiers and permission callbacks are trusted host configuration. Model output and page text are untrusted input. Browser-side checks do not replace server authorization, CSRF protection, endpoint abuse controls or model budgets.

Do not put passwords, tokens, form values or other sensitive data in observations or evidence. The runtime redacts unknown handler errors, but adapters are responsible for the evidence and error messages they return on purpose.

Model requests send conversation text, approved capability metadata and filtered page content to the configured provider. Get consent where needed and pick a suitable provider data policy. Visitors can type sensitive information into the chat even when page observation excludes it. PageSquire sends no telemetry.

Keep provider endpoints, models and keys in server configuration. Enable the Laravel route on purpose, define both gates, and use server-side sessions, a durable cache, atomic locks, CSRF, rate limits, request body limits and provider spending limits. Budget attempts are saved before each model call. Aborting in the browser does not guarantee the remote call stops. The cache holds transcripts, so restrict access and set expiry and secure transport.

The opt-in generic `ui.*` tools act on ordinary page controls inside the host's `canInteract` region. Built-in risk tiers block credential and payment forms and ask for approval before submissions and destructive-sounding controls. Review each site's region and tiers before turning them on ([details](docs/generic-actions.md)). Browser results are untrusted: they grant no business permissions and do not prove a server-side change. Consequential actions stay off unless the server engine opts in, the host authorizes the action ID and the browser runtime has an approval prompt. Even then every call needs a person's approval, which is a confirmation step, not server authorization. See [WebMCP, approvals and WordPress Abilities](docs/webmcp-and-approval.md). Installed handlers can still be unsafe or mislabel their impact, so review every capability. Prompt instructions cannot guarantee correct answers or stop all prompt injection.

For incident handling, lock and lease recovery, and transcript erasure that keeps quotas, see the [operations runbook](docs/operations.md). The Node and PHP erasure helpers are for trusted server code only, not public endpoints or assistant capabilities.

## Known limits

One conversation per session, no cross-tab coordination, no general transcript restore, no production security audit and no assistive-technology review yet. A small Sumopod smoke test is recorded in [model evaluation](docs/model-evaluation.md); it is not an accuracy or prompt-injection benchmark. Full-page navigation continuation is opt-in, same-tab and short-lived, uses its IDs and URL once and does not rerun the action. The local PHP, Node and Next.js demos are for localhost only and must not be deployed publicly.

## Node and PHP endpoints

The Node and native PHP endpoints require an explicitly configured public Origin, POST JSON, session-bound CSRF and host authorization. Internal or proxy request URLs never decide the trusted origin. File stores need a private, persistent local directory on a single host with service-account-only permissions. Multi-host or serverless deployments need a shared atomic durable store. The host is responsible for session creation, global, per-user and IP quotas, storage quotas, retention cleanup, safe lock recovery and edge connection limits. Per-session budgets are not spending caps. Node lock directories can be left behind after a crash; never remove a lock until you have confirmed its owner has stopped. Custom transport, storage and auth code is trusted host code and must limit its own I/O.

Conversation files hold plaintext transcripts and results. Keep them outside the web root, out of source control and public backups, and apply your retention and encryption-at-rest policy. Browser checkpoint IDs are not credentials, but same-origin scripts can read them, so only deploy trusted scripts and use a suitable CSP.

## WordPress plugin

The plugin is off by default. Administration requires `manage_options` and a valid REST nonce. Chat requires the exact Origin, explicit access and consent, current page inspections, signed HttpOnly sessions and session-bound CSRF. A public WordPress nonce is not authorization and does not stop abuse. Public mode exposes a paid service to anyone, so set up host or WAF protection and provider spending limits first. Browser inspection reports are reviewed by the administrator and grant no permissions.

Global database limits count requests across cookies and provider attempts across sessions, including failures. Per-minute site and IP limits and the daily provider budget use lock-free conditional `UPDATE` counters, so concurrent visitors do not block each other; only session creation is serialized, with short bounded retries. These are not spending caps. IP hashes are salted and use the direct peer address, not forwarded headers. Conversation state and encrypted keys are stored as non-autoloaded options; this is not database encryption. Rotating the salt invalidates keys and sessions. Expired sessions are cleaned up on traffic, two minutes after expiry, so idle sites keep them longer. Deactivating or uninstalling keeps the data for recovery; deleting it and its backups is up to the administrator.

Option locks fail closed if a worker dies. To clear one, disable the plugin, stop every assistant worker and back up, then remove only the confirmed stranded lock option. Never take over locks or erase budget records automatically. The plugin needs a coherent options cache and a single writable database; distributed failover and multisite are untested. Exclude the selected pages and the assistant REST endpoints from shared caches. See the [WordPress guide](packages/wordpress/README.md).

Configuration import accepts only built-in root and adapter IDs for the current origin. It never accepts code, custom selectors or business permissions. Export leaves out raw content, HTML, block attributes, protected and private posts, users, values, keys and source code, but public titles and URLs still need a review. During chat, selected public metadata, visitor messages and filtered visible text go to the configured HTTPS provider, so do not enable the assistant on sensitive pages. The WordPress HTTP transport rejects unsafe targets and redirects and limits response size; other plugins' HTTP hooks run as trusted code. No provider is selected automatically. Test fixtures and their fake login endpoints must never be deployed.

## Onboarding CLI

Static discovery and validation do not run website modules, hooks or route commands. They skip known secret, private, config and build paths and export metadata only. Metadata, IDs, paths and source digests can still be sensitive, so review reports and generated skills before giving them to a coding agent. Scan results never grant action permissions.

DOM observation renders the staging pages you approve in an isolated browser, so page JavaScript runs. It blocks requests to other origins, fetch and XHR, mutating methods, service workers, WebSockets, downloads and unapproved navigation. Allowed same-origin GET and HEAD requests still happen, and they are not always side-effect free. Do not scan pages with mutating GET routes, or sites you are not allowed to scan. No login state is imported, so hidden, logged-in or dynamic states may be missed.

The CLI refuses symlinks, junctions and file conflicts. It cannot protect against another process changing files at the same time, so use a trusted checkout. `validate --compile` writes development files without running adapters, but the generated bindings import those modules when the host uses them, so review what they actually do. A static pass always reports `runtimeVerified=false`. Coding-agent instructions are guidance, not enforcement; review before deploying or connecting a provider.
