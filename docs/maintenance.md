# Maintenance and compatibility policy

## Current development policy

PageSquire is an alpha with local R1 foundations, not a supported stable/LTS line. There is no guaranteed response time, security-fix deadline, uptime, commercial support or long-term backport promise. Public source availability, provider presets, passing fixtures or API fingerprints are not a production-support commitment.

Canonical guides, public technical messages and contribution instructions are English. Integrations may provide runtime translations separately. Use the [compatibility matrix](compatibility.md) for exact measured hosts; untested providers/models, themes, browsers and storage topologies remain experimental or unsupported as documented, not implicitly supported by a dependency range.

Changes go through focused review, meaningful failing regressions, API/wire/behavior/security analysis, changelog/guides and matching consumer verification. Follow [API review](api-contract.md) and [upgrade/recovery](upgrading.md). The API baseline is a conservative review aid; nobody should refresh it automatically to conceal an incompatible change.

## Version and deprecation decisions

Package release versions and protocol `0.1` are separate. During `0.x` prereleases, APIs/configuration may change, but intentional incompatibilities must be explicit in notes and migration guidance. Changed public artifact bytes need a new version, never a replaced asset/tag. Current tooling accepts only reviewed alpha/beta development formats and keeps registries deferred.

For any removed/renamed export, option/environment alias, capability schema or behavior, record the reason, affected integration/version, replacement and upgrade instructions in the changelog and guide. Where safe, retain a bounded compatibility path with regressions and an explicit removal decision. Do not add silent fallback, broad permissions or relaxed validation just to preserve a deprecated behavior. Security corrections may require immediately disabling an unsafe feature with a clear advisory; they are not a promise of indefinite compatibility.

No universal fixed deprecation period is promised during alpha. Before stable, the owner must approve a precise public API, breaking-change/version rules, supported release lines, deprecation/removal windows, security response process and backport scope. Do not advertise those future commitments as established. [SemVer](https://semver.org/spec/v2.0.0.html) ties stable versioning to a declared public API; R1 must first define and test that actual scope.

## Issues, vulnerabilities and releases

Use [contribution guidance](../CONTRIBUTING.md) and the sanitized bug/beta feedback templates for exact versions, synthetic reproduction, actual postconditions and explicitly untested targets. Do not post raw transcripts, credentials, private URLs, user exports or unreviewed traces. Security vulnerabilities belong in [private reporting](../SECURITY.md), not public bugs.

Maintainers triage data exposure, authorization bypass, unsafe verified-success claims, cost/serialization defects and data loss as potential release blockers rather than averaging them into model scores. Unknown outcomes must not become automatic retries, budget resets or success claims. Contain incidents using [operations](operations.md); continued feature access is secondary to preserving the boundary.

Beta delivery still requires independent onboarding, scoped support/security/redistribution reviews, exact-candidate CI and owner approval. RC/stable additionally require resolved pilot findings, explicit API freeze/upgrade/rollback evidence and maintenance decisions. Local preparation does not mark any of these gates complete. Publication, deployments, paid evaluations and registry submissions require their own authorization.
