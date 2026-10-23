# PageSquire 0.1.0-beta.0 — development beta candidate

This is an owner-approved GitHub-first beta source candidate, not a tagged/published beta release or stable 1.0. The owner-assisted Kabarin trial succeeded, but independent onboarding and final-candidate reviews remain pending; see [beta evidence and gates](beta.md). The owner-authorized development repository is [naufaldenta/pagesquire](https://github.com/naufaldenta/pagesquire). Private vulnerability reporting is enabled there. Source publication is distinct from a tagged release or registry publication.

## Included

C4 adds [truthful action progress](action-progress.md): runtime lifecycle hooks, a bounded in-memory client timeline, fixed recovery copy and shared-widget rendering. Cached work and pending navigation are not fresh verification; cancellation/timeouts do not promise rollback. Rebuild matching assets and update hand-authored ChatState/busy selectors. No protocol/storage/permission or provider-budget change is introduced.

C3 adds [public app context and contextual availability](app-context.md), with strict JS/PHP limits, per-round state, pre-handler checks and Laravel validated-input support. It is opt-in and requires coordinated browser/server rollout. It neither grants permission nor rejects authorized pending results after state changes. Structured context is not automatically stored in transcripts; model answers/custom logging retain their own privacy boundaries.

C2 adds the optional [capability inspector](capability-inspector.md) for protected developer/admin surfaces: coverage, sampled target readiness, schema disclosures and metadata-only diagnostics. It runs no actions or inference; server permission and real verification remain separate. Closed native `details` controls now require explicit preparation. No live-model certification or beta promotion is implied.

Registered and verified browser capabilities, a conversation widget, six-state emotion hooks, bounded PHP/Node engines, Laravel/React/Inertia/Next.js integrations, hybrid onboarding and an installation-ready WordPress plugin. The neutral fixtures use deterministic providers and synthetic content. Full details: [changelog](../CHANGELOG.md), [compatibility](compatibility.md) and [security](../SECURITY.md).

Each complete candidate directory contains six npm tarballs, two PHP source ZIPs, a WordPress installation ZIP, the full editable source ZIP, a Composer path-repository example, these notes, `release-manifest.json` and `SHA256SUMS`. npm, Packagist and WordPress.org accounts are not needed for local files. Third-party dependencies still need normal installation; this is not a complete offline dependency mirror.

B4 adds budget-preserving host-only transcript erasure and a PostgreSQL cleanup concurrency correction. B5 adds beta-aware release checks, explicit review gates and [independent tester guidance](beta.md); this candidate itself remains alpha and no beta release is published. These changes are not automatically deployed by creating a local archive.

R1 adds a reviewed [API inventory/drift baseline](api-contract.md), CI/candidate enforcement and same-format synthetic Node checkpoint recovery checks, with [upgrade](upgrading.md) and [maintenance](maintenance.md) guidance. No API freeze, historical-release upgrade certification, RC/stable version or production restore is implied.

## Before using a download

Verify every checksum with `npm run release:verify -- <candidate-directory>` from a trusted source checkout. Checksums detect corruption; they are not signatures or proof of publisher identity. Confirm the candidate/version with the owner through a trusted channel. The built WordPress ZIP is the installable plugin; neither GitHub's automatic source ZIP nor `pagesquire-source-*.zip` is a ready-to-upload plugin.

Follow [GitHub-only installation](releasing.md#using-the-local-or-github-artifacts) and the framework-specific guides. The assistant requires explicitly reviewed capabilities and host authorization. Keep provider secrets server-only, disclose external data transfer and costs, and configure retention and quotas before enabling inference. WordPress stays disabled until setup and verification are complete.

## Not yet certified

Live-model accuracy, production hosting, broad browser/assistive-technology coverage, WordPress MySQL/cache/multi-worker/multisite deployments, Elementor and WooCommerce. No Rive renderer/artwork or hosted speech service is included; optional local-first browser speech is available. Remote CI/public security reporting and owner approval are release gates, not claims made by the local build.

See the bundled source archive's `docs/releasing.md` for the complete process. Relative source-document links in these standalone notes are intended for that extracted checkout, not as promises about files beside the notes.
