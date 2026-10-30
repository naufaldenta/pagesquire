# Releasing

The repository is [naufaldenta/pagesquire](https://github.com/naufaldenta/pagesquire), with private vulnerability reporting enabled. The six JavaScript packages are on [npm](https://www.npmjs.com/org/pagesquire) and the two PHP packages on [Packagist](https://packagist.org/packages/pagesquire/), starting with `0.1.0-beta.0`. Later versions are published when you push a version tag (see [Publishing to npm and Packagist](#publishing-to-npm-and-packagist)). The WordPress plugin ZIP and the full candidate go into GitHub prereleases. WordPress.org comes later. The release tooling never creates credentials, repositories, tags or releases on its own.

The current version is **0.1.0-beta.0**. The six npm manifests are publishable: `release:check` requires `publishConfig` with public access, `repository` metadata that points at this repository, and a `LICENSE` file in each package. The root workspace stays `private`.

## Building a candidate locally

Set up the contributor prerequisites, then run from the repository root:

```sh
npm run release:check
npm test
npm run test:next-build
npm run format:check
npm run build
npm run release:prepare
npm run release:verify -- <candidate-directory>
```

`release:check` checks metadata, lockfile versions, the compatibility record, local doc links and fenced JSON examples. It passes for a valid local preview even when it reports `publicationReady: false`. `release:check -- --publication` fails until every public-release item is done. Neither mode contacts a registry or checks GitHub settings.

`release:check -- --beta` also requires a beta version and channel, plus the three beta review records in `release.config.json` (outside-tester onboarding, support scope, security and operations) with existing evidence files. Missing beta approvals do not block a local preview, only a beta release. See the [beta guide](beta.md).

`release:prepare` needs a fresh `npm run build`: it checks the build fingerprint, the built packages, and that the WordPress ZIP's bundled source matches the current sources. Any change to sources or compiled output invalidates the fingerprint, so rebuild after editing anything included. It runs `npm pack --offline --ignore-scripts`, builds the PHP and source ZIPs and copies the plugin ZIP into a new directory under `dist/releases/`. It never overwrites an earlier candidate or modifies source manifests. It does not run tests, so keep their logs yourself. Do not distribute a directory from a failed run.

`release:prepare` also runs the [API check](api-contract.md). `npm test` and CI run `api:check` after the build. An intentional change to the API, host requirements or package version needs a compatibility review and a deliberate baseline update. Manifests record `apiReview` as `review-baseline-not-frozen`: the check spots drift, but the API is not frozen yet. Read [upgrading](upgrading.md) and [maintenance](maintenance.md) before changing a host.

Every candidate includes a manifest and checksums. Verification rejects changed, missing or extra files, unsafe filenames, duplicate entries and linked files. Verify before extracting, and do not trust an archive or checksum that came through an untrusted channel. Build candidates only in a trusted checkout. The exclusion patterns are not a secret scanner, so review the source and artifact lists for secrets and licensing yourself.

Manifests record the `channel` and beta readiness. The verifier requires a matching channel for beta candidates; older alpha manifests without that field still verify. Verification checks file integrity only, not CI results, runtime compatibility or the reviews. A beta-named archive can still be a blocked local preview, so read its manifest.

## Using the local or GitHub artifacts

### WordPress

Upload `pagesquire-0.1.0-beta.0.zip` in **Plugins → Add New → Upload Plugin**. No build step is needed. Follow the [WordPress guide](../packages/wordpress/README.md). Keep the bundled GPL, MIT and Apache notices and `corresponding-source.zip`; do not swap it for GitHub's automatic source archive. [WordPress's guidelines](https://developer.wordpress.org/plugins/wordpress-org/detailed-plugin-guidelines/) require compatible licensing and readable sources. Submitting to the WordPress.org directory is a separate, later step.

### JavaScript/TypeScript

Most projects install from npm with the `beta` tag, as shown in the [README](../README.md#install-the-packages). The tarballs in a candidate are for offline installs and for checking a candidate before it is published. Download them into one directory and install the PageSquire packages you need together from local paths. A browser client needs these three:

```sh
npm install ./pagesquire-protocol-0.1.0-beta.0.tgz ./pagesquire-core-0.1.0-beta.0.tgz ./pagesquire-client-0.1.0-beta.0.tgz
```

React also needs the React tarball and a compatible React peer. The CLI needs its tarball plus core and protocol. The Node server needs its tarball plus protocol. Install all six for the full demo. Third-party dependencies still come from the internet or your cache. See the [runtime](runtime.md), [onboarding](onboarding.md) and [Node/Next.js](node-next.md) guides.

### Standalone PHP and Laravel

Most projects install from Packagist with `composer require pagesquire/server:^0.1@beta` (and `pagesquire/laravel:^0.1@beta` for Laravel). The ZIPs in a candidate are for offline installs. Extract `pagesquire-server-0.1.0-beta.0.zip` and, for Laravel, `pagesquire-laravel-0.1.0-beta.0.zip` outside the web root. They contain the directories `pagesquire-server` and `pagesquire-laravel`. Merge the supplied `composer-repositories.json` fragment into your application's root `composer.json` and adjust the relative paths. Standalone PHP needs only the server entry. Keep your existing entries; do not replace the whole file.

The fragment sets explicit path-package versions and disables symlinks. The Laravel manifest requires the exact `pagesquire/server` version, so a path repository for the server needs that version too. Run your normal Composer install or update, then follow [standalone PHP](standalone-php.md) or [Laravel](laravel-react.md). Composer documents [path repositories](https://getcomposer.org/doc/05-repositories.md#path). The monorepo root is a development workspace, not a package, so do not submit it to Packagist.

## Publishing a GitHub prerelease

Update the items in `release.config.json` as each one is actually done:

1. Make sure you can create and manage the repository. Review all source and assets for licensing and sensitive data. Set up a private conduct contact.
2. Enable [private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository), check that it works, and point SECURITY.md at it. A flag in the config file cannot turn on a GitHub setting.
3. Review the source list, commit, and set `origin` to the repository. Ignore generated candidates, dependencies, local notes and fixture caches. Never commit credentials.
4. Push and wait for the Windows and Ubuntu jobs and the clean-install tests to pass on the exact commit before setting `remoteCiPassed`. Any new commit needs a fresh run. `release:check` checks local consistency only.
5. Update the [changelog](../CHANGELOG.md), release notes and version if needed. Commit, rerun CI and the build and package checks, and build the final candidate from a clean checkout with the right `origin`. `release:check -- --publication` must pass.
6. Create a **draft prerelease**, never a stable or latest release, tagged with the exact alpha or beta version on the verified commit. Attach the full candidate, check the list, then publish it as a prerelease with its known limitations. [GitHub releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) can carry attached files next to the source archives. A beta also needs `release:check -- --beta` and the [beta reviews](beta.md). Creating the tag also starts the [npm and Packagist workflows](#publishing-to-npm-and-packagist).
7. Download the published files again and verify them. Record the URLs, commit and per-file digests. If a release was interrupted, look at the existing draft, tag and assets and upload only what is missing. Never replace files under a public version or recreate a tag; changed files need a new prerelease version.

CI only tests and verifies candidates. Publishing happens only when you push a version tag, which is always a manual decision, even when every check passes.

## Publishing to npm and Packagist

Two workflows run when a tag like `v0.1.0-beta.1` is pushed:

- **`publish-npm.yml`** builds, runs `release:check` and publishes the six packages in dependency order with npm [trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is stored in GitHub. It refuses a tag that differs from the package version. Versions already on npm are skipped, so a failed run can be retried. It runs in the `npm` environment, which can require your approval. Trusted publishing works only for packages that already exist, so the first version of each package is published once by hand with `npm publish -w packages/<name>`, and the trusted publisher is configured on npmjs.com afterwards.
- **`split-php.yml`** builds the PHP schemas and copies `packages/php` and `packages/laravel` to the read-only repositories `naufaldenta/pagesquire-php` and `naufaldenta/pagesquire-laravel`, with the same tag. Packagist reads those repositories, because it needs `composer.json` at the repository root. The copy needs a `SPLIT_TOKEN` secret: a fine-grained token with read and write access to the contents of those two repositories only.

Never move or recreate a pushed tag; a mistake needs a new version.

## Versioning and 1.0

Keep the six npm packages, the root manifest and lockfile, the WordPress header and readme, the compatibility record, the release notes and internal dependencies on the same version. Composer versions come from the tag in the split repositories. The Laravel manifest and the root `composer.json` path repositories carry the same exact version, and `release:check` compares them. The protocol `schemaVersion` is versioned separately, and incompatible wire changes need a contract and migration review.

Changed public files always get a new prerelease number. Supported formats are `0.x.y-alpha.n` on `github-alpha` and `0.x.y-beta.n` on `github-beta`, with no leading zeroes and the same version and channel everywhere. A stable release needs the [1.0 criteria](compatibility.md#known-limits-and-the-10-gate), not just a version change. The tooling refuses stable, release-candidate and build-metadata versions until the release-candidate policy (R1) is settled. WordPress.org will need its own account and review.
