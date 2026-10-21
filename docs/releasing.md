# GitHub-first releases

The owner authorized the public development repository [naufaldenta/pagesquire](https://github.com/naufaldenta/pagesquire). Account access, repository creation and enabled private vulnerability reporting were verified on 2026-10-20. npm, Packagist and WordPress.org are explicitly deferred. The local release tooling does not create credentials, repositories, tags or releases; repository setup was a separate owner-authorized action.

The current version is **0.1.0-alpha.0**, not 1.0. Package namespaces are provisional. Never remove `private: true` merely to share GitHub downloads; [npm documents this as a publication guard](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#private).

## Local candidate workflow

Use the contributor prerequisites, then run from the repository root:

```sh
npm run release:check
npm test
npm run test:next-build
npm run format:check
npm run build
npm run release:prepare
npm run release:verify -- <candidate-directory>
```

`release:check` checks metadata, lockfile versions, compatibility evidence, local guide links and fenced JSON examples. It succeeds for a valid **local preview** even when it reports `publicationReady: false`. `release:check -- --publication` fails until all public-release gates are satisfied. Neither mode contacts a registry or proves remote settings.

`npm run release:check -- --beta` additionally requires a beta version/channel and the independent-onboarding, support-scope and security/operations review records in `release.config.json`, with existing sanitized evidence references. Missing beta approvals do not prevent a valid local preview, but do prevent beta publication readiness. [B5 instructions](beta.md) explain evidence, tester feedback and the staged owner-approved promotion. These records are human attestations, not automatic proof of remote CI or independent acceptance.

`release:prepare` requires the build input/output fingerprint from `npm run build`, built packages and a WordPress ZIP whose embedded corresponding source exactly matches current distributable sources. Changed sources or compiled outputs invalidate that fingerprint. It performs local `npm pack --offline --ignore-scripts`, creates PHP/source ZIPs and copies the plugin ZIP. It creates a fresh directory under `dist/releases/` without overwriting candidates. Source manifests are not modified. It does not run tests or attest that they passed: keep their logs separately. Rebuild after changing any included source or guide. Failed candidate directories are incomplete and must not be distributed.

R1 also enforces the [API review baseline](api-contract.md) before candidate creation, even if the build stamp is fresh. `npm test`/CI run `api:check` after build. An intentional contract/host/package-version change requires explicit compatibility review and a reviewed baseline update, not an automatic overwrite. New candidate manifests record `apiReview` as `review-baseline-not-frozen`; this is drift evidence, not API freeze, semantic compatibility or stable-readiness approval. Review [upgrade/recovery](upgrading.md) and [maintenance](maintenance.md) before changing a host.

Every complete candidate includes a manifest and checksums. Verification rejects changed/missing/extra files, unsafe filenames, duplicate inventory entries and linked artifacts. Verify before extracting. Do not treat an archive or checksum from an untrusted channel as authenticated. Packaging runs in a trusted owner-controlled checkout; exclusion patterns are not a secret scanner or protection against hostile concurrent filesystem changes. Review source and artifact inventories manually for secrets and rights.

New manifests record `channel` and beta readiness alongside source/gates. The verifier requires a matching explicit channel for beta; legacy alpha manifests without that field remain readable. Verification checks inventory integrity, not publication permission, CI results, package runtime compatibility or review authenticity. A beta archive may be a blocked local preview; inspect the manifest and trusted release context rather than inferring readiness from its filename.

## Using the local or GitHub artifacts

### WordPress

Upload only `pagesquire-0.1.0-alpha.0.zip` in **Plugins → Add New → Upload Plugin**. No user-side build is required. Follow the [WordPress guide](../packages/wordpress/README.md). Keep bundled GPL/MIT/Apache notices and `corresponding-source.zip`; do not replace it with an unrelated GitHub auto-generated archive. [WordPress's guidelines](https://developer.wordpress.org/plugins/wordpress-org/detailed-plugin-guidelines/) require compatible licensing and access to readable sources/build tools. Directory submission is a separate future workflow, not a side effect of a GitHub release.

### JavaScript/TypeScript

Download the candidate's tarballs into a directory, then install required PageSquire dependencies together using local file paths. For example, a browser client needs these three tarballs:

```sh
npm install ./pagesquire-protocol-0.1.0-alpha.0.tgz ./pagesquire-core-0.1.0-alpha.0.tgz ./pagesquire-client-0.1.0-alpha.0.tgz
```

React additionally needs the React tarball and a compatible React peer. The CLI needs its tarball plus core/protocol; Node server needs its tarball plus protocol. Install all six together when following the complete demo. These are file installs, not `npm install @pagesquire/...` registry availability claims. Normal third-party dependencies may require internet/cache. Follow the [runtime](runtime.md), [onboarding](onboarding.md) and [Node/Next.js](node-next.md) guides.

### Standalone PHP and Laravel

Extract `pagesquire-server-0.1.0-alpha.0.zip` and, for Laravel, `pagesquire-laravel-0.1.0-alpha.0.zip` outside the web root. They contain directories `pagesquire-server` and `pagesquire-laravel`. Merge the supplied `composer-repositories.json` fragment into the **host application's root** `composer.json`; adjust the relative paths to these extracted directories. For standalone PHP use only the server repository/require entry. Preserve your application's existing entries; do not replace its entire file.

The fragment supplies explicit path-package versions and disables symlinks. Source manifests retain the local alpha's `@dev` internal constraint; do not mistake this for a tagged Packagist release. Run the host's normal Composer update/install and follow [standalone PHP](standalone-php.md) or [Laravel](laravel-react.md). [Composer documents root-only repositories and versioned path packages](https://getcomposer.org/doc/05-repositories.md#path). The monorepo root is a development workspace, not the server/adapter package; do not submit it as one package to Packagist.

## Owner-controlled GitHub publication

Before publishing, review and truthfully update the gates in `release.config.json`:

1. Confirm account access and permission to create the intended public repository. Review all source/assets for redistribution and sensitive data. Establish private conduct reporting.
2. Create/configure the repository only with owner authorization. Enable [private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository); verify it actually works, then update SECURITY.md with the real channel. A JSON flag cannot enable a GitHub setting.
3. Review the source inventory, create the initial commit and configure `origin` for the selected repository. Ignore generated candidates, dependencies, local planning logs and fixture caches. Never commit credentials.
4. Push the reviewed source only with authorization. Observe both Windows/Ubuntu checks and clean-consumer tests on the **exact commit**. Resolve failures before marking `remoteCiPassed`. Any new commit needs fresh evidence; `release:check` is a local consistency gate, not a GitHub attestation.
5. Update the [changelog](../CHANGELOG.md), release notes, evidence and version if needed. Obtain owner release approval. Commit any such changes, rerun CI/build/package checks, and produce the final candidate from a clean checkout with matching `origin`. Confirm `release:check -- --publication` succeeds.
6. Create a **draft prerelease**, never a stable/latest release. Use the exact approved alpha or beta version tag on the verified commit. Attach the full tested candidate inventory, inspect it, then publish as prerelease and note all limitations. [GitHub releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) support manually attached artifacts alongside source archives. A beta additionally requires `release:check -- --beta` and the [B5 reviews](beta.md).
7. Re-download and verify the published artifacts. Record URLs/commit/digests per file. If interrupted, inspect the existing draft/tag/assets first; resume missing uploads only. Never silently replace different bytes under an already public version or recreate a conflicting tag. Changed public bytes require a new prerelease version and checks.

No automatic publisher or write-enabled release workflow is installed. The CI workflow only tests and verifies local candidates. External release approval remains a human decision even if every local flag is true.

## Versioning and 1.0

Keep all six npm packages, root/lockfile, WordPress header/readme, compatibility record, release notes and internal dependencies synchronized. PHP packages take a release version through path metadata today; eventual split repositories must use matching reviewed tags and bounded dependency constraints. Protocol `schemaVersion` is separate; incompatible wire changes require an explicit contract/migration review.

Use a new prerelease number for changed public bytes. The reviewed development formats are `0.x.y-alpha.n` / `github-alpha` and `0.x.y-beta.n` / `github-beta`, with canonical numeric identifiers and matching channel/version across metadata. The current checkout remains alpha until deliberately promoted with evidence and approval. Stable promotion requires the [1.0 criteria](compatibility.md#known-limits-and-the-10-gate), not just changing a version field. Stable, RC and build-metadata aliases are intentionally refused; R1 needs a separate policy review. A future npm/Packagist/WordPress.org workflow needs separately authorized accounts, namespace ownership and channel-specific checks.
