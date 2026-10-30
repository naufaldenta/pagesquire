# PageSquire 0.1.0-beta.0 — development beta

This is the first beta version of PageSquire. It works end to end and has a large automated test suite, but it has not yet been tried on many real sites, models or browsers. The JavaScript packages are on npm and the PHP packages on Packagist ([install](../README.md#install-the-packages)). There is no tagged GitHub release yet, and the WordPress plugin is not on WordPress.org. The source is at [naufaldenta/pagesquire](https://github.com/naufaldenta/pagesquire), where private vulnerability reporting is enabled. See the [beta guide](beta.md) for testing.

## Included

Registered, verified browser capabilities, a chat widget, six-state emotion hooks, PHP and Node conversation engines, Laravel, React, Inertia and Next.js integrations, hybrid onboarding and an installable WordPress plugin. The test fixtures use deterministic providers and synthetic content. Full details are in the [changelog](../CHANGELOG.md), [compatibility](compatibility.md) and [security](../SECURITY.md).

[PageSquire Link](link.md) pairs two PageSquire sites so one assistant can hand a visitor to the other, with an optional A2A interface.

[Action progress](action-progress.md) shows each action's stages in the widget, with recovery hints. Cached results and pending navigation are shown as such, and a cancel or timeout does not undo work already done. Rebuild matching assets and update hand-written `ChatState` fixtures and busy selectors. The protocol, storage, permissions and provider budgets are unchanged.

[App context](app-context.md) lets hosts send typed public state each turn and hide actions that do not apply. It is opt-in, so deploy matching browser and server versions together. It does not grant permissions and is not stored in transcripts.

The [capability inspector](capability-inspector.md) is an optional developer panel for checking coverage, targets and schemas. It never runs actions or model calls. Controls inside closed `details` elements now need explicit preparation.

Transcript erasure keeps quota counters intact, and a PostgreSQL cleanup race is fixed. The release tooling now supports beta versions and checks the beta review records.

An [API inventory and drift check](api-contract.md) runs in CI and before preparing a release, along with synthetic Node checkpoint recovery tests. See [upgrading](upgrading.md) and [maintenance](maintenance.md).

Each release directory contains six npm tarballs, two PHP source ZIPs, a WordPress installation ZIP, the full source ZIP, a Composer path-repository example, these notes, `release-manifest.json` and `SHA256SUMS`. You do not need npm, Packagist or WordPress.org accounts to use these files. Third-party dependencies still install the normal way.

## Before using a download

Check every file with `npm run release:verify -- <candidate-directory>` from a trusted source checkout. Checksums catch corruption but are not signatures, so confirm the version with the maintainer through a channel you trust. Upload the built WordPress ZIP to install the plugin. GitHub's automatic source ZIP and `pagesquire-source-*.zip` are not installable plugins.

Follow the [installation steps](releasing.md#using-the-local-or-github-artifacts) and the guide for your framework. Review each capability and set up host authorization. Keep provider secrets on the server, tell visitors that chat goes to an external provider, and set retention and quotas before turning on the model. The WordPress assistant stays off until setup and verification are done.

## Known gaps

Not yet tested: live-model accuracy at scale, production hosting, browsers other than Chromium, assistive technology, WordPress on MySQL, with object caches, multiple workers or multisite, Elementor and WooCommerce. There is no Rive renderer or artwork and no hosted speech service; optional local browser speech is available.

The links in these notes point to files in the source archive. For the full release process, see `docs/releasing.md` in that archive.
