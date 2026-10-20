# PageSquire 0.1.0-alpha.0 — local release candidate

This is a GitHub-first alpha candidate, not a published release or stable 1.0. The owner-authorized development repository is [naufaldenta/pagesquire](https://github.com/naufaldenta/pagesquire). Private vulnerability reporting is enabled there. Source publication is distinct from a tagged release or registry publication.

## Included

Registered and verified browser capabilities, a conversation widget, six-state emotion hooks, bounded PHP/Node engines, Laravel/React/Inertia/Next.js integrations, hybrid onboarding and an installation-ready WordPress plugin. The neutral fixtures use deterministic providers and synthetic content. Full details: [changelog](../CHANGELOG.md), [compatibility](compatibility.md) and [security](../SECURITY.md).

Each complete candidate directory contains six npm tarballs, two PHP source ZIPs, a WordPress installation ZIP, the full editable source ZIP, a Composer path-repository example, these notes, `release-manifest.json` and `SHA256SUMS`. npm, Packagist and WordPress.org accounts are not needed for local files. Third-party dependencies still need normal installation; this is not a complete offline dependency mirror.

## Before using a download

Verify every checksum with `npm run release:verify -- <candidate-directory>` from a trusted source checkout. Checksums detect corruption; they are not signatures or proof of publisher identity. Confirm the candidate/version with the owner through a trusted channel. The built WordPress ZIP is the installable plugin; neither GitHub's automatic source ZIP nor `pagesquire-source-*.zip` is a ready-to-upload plugin.

Follow [GitHub-only installation](releasing.md#using-the-local-or-github-artifacts) and the framework-specific guides. The assistant requires explicitly reviewed capabilities and host authorization. Keep provider secrets server-only, disclose external data transfer and costs, and configure retention and quotas before enabling inference. WordPress stays disabled until setup and verification are complete.

## Not yet certified

Live-model accuracy, production hosting, broad browser/assistive-technology coverage, WordPress MySQL/cache/multi-worker/multisite deployments, Elementor and WooCommerce. No Rive renderer/artwork or speech is included. Remote CI/public security reporting and owner approval are release gates, not claims made by the local build.

See the bundled source archive's `docs/releasing.md` for the complete process. Relative source-document links in these standalone notes are intended for that extracted checkout, not as promises about files beside the notes.
