# Public API review baseline

R1 starts with an inventory and a drift guard, **not an API freeze or a stable release**. PageSquire remains `0.1.0-alpha.0`; all current contracts may still change with a documented prerelease. Independent beta acceptance, an approved frozen support/API scope and release-candidate/stable policy are outstanding. See [beta gates](beta.md) and [maintenance policy](maintenance.md).

## Integration surfaces

Use package entrypoints and the corresponding integration guides, not private build paths. Current exported types are the authoritative signatures; the table describes the intended review boundary rather than promising every class or option is stable.

| Surface                                                     | Intended integration contract                                                                                                                                                                                                           |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@pagesquire/protocol` and `@pagesquire/protocol/schemas/*` | Protocol `0.1` requests/replies/actions/snapshots, capability/provider schemas, validators, emotion types/normalization. Package release version and wire schema version are separate.                                                  |
| `@pagesquire/core`                                          | Registry/bindings, browser observation/runtime, execution and verification, navigation adapters and explicit control helpers. Host permissions and actual postconditions remain mandatory.                                              |
| `@pagesquire/client` and `@pagesquire/client/widget.css`    | `AssistantClient`, same-origin HTTP transport, widget mounting/options, navigation continuation and emotion callbacks. Stylesheet entrypoint is public; private DOM selectors/internal CSS details are not a styling stability promise. |
| `@pagesquire/react`, `/inertia`, `/next`                    | `PageSquireWidget`, `createInertiaNavigation`, `createNextNavigation` and their declared props/options. Host router/session/auth integration remains host-owned.                                                                        |
| `@pagesquire/cli` and `pagesquire` binary                   | Documented onboarding commands, config/mapping validation and exported workflow helpers. No universal discovery, automatic permissions, code training or coding-agent compliance guarantee.                                             |
| `@pagesquire/server`                                        | Engine/provider/configuration interfaces, handler authorization, serialized store transactions and trusted `forgetConversation`. Public export visibility does not promise a stable on-disk conversation format.                        |
| `pagesquire/server` / `PageSquire\Server\`                  | Composer platform/namespace boundaries and documented native PHP engine, provider, endpoint/store/privacy interfaces. Only trusted host integrations may supply identity, storage and provider settings.                                |
| `pagesquire/laravel` / `PageSquire\Laravel\`                | Service-provider registration, published configuration, catalog/provider binding and documented named route/gates. The adapter's cache envelope is not interchangeable with the native endpoint.                                        |
| WordPress ZIP                                               | Documented administrator setup, data-only mappings, selected public-page capabilities and server-side provider configuration. Prefixed vendor classes, option keys, locks and internal plugin methods are not a stable extension API.   |

Provider presets/configuration and canonical environment/legacy aliases are documented in [providers](providers.md). Every model remains owner-configurable; API drift checks do not certify model accuracy or provider availability. Required host versions are in [compatibility](compatibility.md), not inferred from an API hash.

## What the automated guard measures

```sh
npm run build
npm run api:check
```

`docs/api-baseline.json` records the package version and normalized SHA-256 fingerprints of:

- Selected npm manifests: names/module type, export maps/binary, host engines, dependencies and peer requirements.
- All emitted `.d.ts` files in the six packages, including conservatively included internal declarations, and all exported protocol JSON schemas.
- Composer names/type, platform/dependency requirements, autoload/discovery and suggestions.
- PHP source trees and the WordPress entry file as **whole-source review fingerprints**, not parsed semantic method signatures. An implementation/comment-only PHP change may therefore require review.

CRLF/LF and JSON key ordering are normalized. Missing/changed/added declarations, schema changes, host/entrypoint changes, package-version drift and PHP source changes block the check. Linked inputs/baselines are rejected. The tool reads fixed public checkout paths; it does not import JavaScript/PHP, boot a host, read production environment files, send telemetry or call a model. Run it in a trusted quiescent checkout; it is not protection against a hostile concurrent filesystem.

The guard is part of `npm test` and Windows/Ubuntu CI after build. Candidate preparation also refuses drift even if a fresh build fingerprint exists. New candidate manifests record `apiReview` as `review-baseline-not-frozen`. A matching baseline is neither reviewer approval nor proof of behavioral compatibility/security. It does not compare runtime JavaScript behavior, infer a SemVer category, certify CSS layout or freeze arbitrary PHP public methods. Behavioral/browser/security tests and independent reviews remain required.

## Reviewing intentional changes

1. Add a failing consumer/schema/behavior regression. Compare old and new declarations/schemas, real package entrypoints and required host versions. Classify additive, behavioral, wire, persistence and security effects explicitly; a hash alone cannot decide.
2. Update integration examples, changelog, version/deprecation notes and [upgrade guidance](upgrading.md). For wire changes, review closed schemas and mixed browser/server behavior. Do not quietly broaden fields or permissions to keep an old client running.
3. Print the proposed baseline with `node scripts/check-api.mjs capture`. This is read-only JSON output; there is no automatic `--update`, approval or promotion command. Review the diff and deliberately replace the committed baseline in the same reviewed change. Never rebaseline solely to make CI green.
4. Run build, API/type/contract/runtime checks and clean consumers. Any included source or guide change invalidates the candidate build fingerprint. Require exact-commit remote CI before eventual publication.

Current `ConversationState`, native/Laravel/WordPress storage envelopes, provider transcripts, lock/fence/option keys, replay-cache internals, private runtime fields, demo routes/assets and generated binding internals are **not a version-independent interchange or backup format**. Do not manually edit or round-trip them through a browser/model. The current same-format synthetic reopen tests are described in [upgrading](upgrading.md); a durable format/version negotiation and old-release matrix must be designed before promising broader state migration compatibility.
