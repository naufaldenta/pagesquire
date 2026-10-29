# Maintenance policy

## Current policy

PageSquire is in beta and has no stable or long-term-support line yet. There is no guaranteed response time, security-fix deadline, uptime, commercial support or backport promise.

Docs, public technical messages and contribution instructions are in English. Integrations can add runtime translations separately. The [compatibility matrix](compatibility.md) lists what is tested; untested providers, models, themes, browsers and storage setups are experimental, whatever a dependency range allows.

Every change gets a focused review, a regression test that failed before the fix, a look at its API, wire, behavior and security impact, changelog and doc updates, and a check against real consumers. Follow [API review](api-contract.md) and [upgrading](upgrading.md). Never refresh the API baseline just to hide an incompatible change.

## Versions and deprecations

Package versions and protocol version `0.1` are separate. During `0.x` prereleases APIs and configuration may change, but every intentional break is called out in the notes with migration steps. Changed public files always get a new version; assets and tags are never replaced. The tooling currently accepts alpha and beta versions only, and registries are not used yet.

When an export, option, environment alias, capability schema or behavior is removed or renamed, the changelog and guide record why, what is affected, the replacement and how to upgrade. Where it is safe, a compatibility path stays for a while, with tests and a planned removal. Deprecated behavior is never kept alive through silent fallbacks, broader permissions or looser validation. A security fix may switch off an unsafe feature immediately, with a clear advisory.

There is no fixed deprecation period yet. Before 1.0 the project will define the public API, versioning and breaking-change rules, supported release lines, deprecation windows, the security response process and backport scope. [SemVer](https://semver.org/spec/v2.0.0.html) ties stable versions to a declared public API, so that has to be settled first.

## Issues, vulnerabilities and releases

See [contributing](../CONTRIBUTING.md) and use the bug and beta feedback templates with exact versions, a synthetic reproduction, what actually happened on the page, and what you did not test. Do not post raw transcripts, credentials, private URLs, user exports or unreviewed traces. Report vulnerabilities [privately](../SECURITY.md), not as public bugs.

Data exposure, authorization bypass, false "verified" claims, cost or serialization bugs and data loss are treated as release blockers, not as noise in model scores. Unknown outcomes never turn into automatic retries, budget resets or success messages. During an incident, follow [operations](operations.md) and keep the boundary intact, even if that means turning features off.

A beta release still needs outside testers, support, security and licensing reviews, and CI on the final commit. A release candidate or stable version additionally needs tester feedback addressed, a frozen API, tested upgrades and rollbacks, and the maintenance decisions above.
