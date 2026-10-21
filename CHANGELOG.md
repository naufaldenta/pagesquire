# Changelog

All canonical release notes are English. PageSquire uses SemVer for packages and separately versioned protocol contracts. Nothing listed here implies that an artifact has been published.

## Unreleased — 0.1.0-alpha.0 candidate

### Added

- Sixteen server-side provider profiles (fifteen named service/gateway profiles plus Custom), shared Node/PHP configuration, canonical environment settings, Laravel wiring and an administrator-only WordPress provider selector. English support matrix and per-integration tutorials distinguish synthetic transport support from live-model certification.
- Explicit JSON/prompt, output-token field, instruction-role and supported thinking switches; bounded whole-fence/text-part normalization and refusal/truncation rejection without automatic provider fallback or paid retries. Existing explicit-endpoint configuration remains compatible.

- OFFBEAT now offers thirteen verified tools, including independent heading highlighting/body color, reading fonts/spacing, gallery search/sort, edge-aware scrolling and resets. Separate-message, confirmation, recovery and expired-auth browser regressions extend the original single-message smoke coverage.
- Legacy Node/PHP history normalization and safe typed HTTP failure feedback, with conversation continuity after known provider-format failures and no automatic paid retries or quota resets.

- OFFBEAT, an independent brutalist art/culture landing demo with original characters, a filterable gallery, accessible dialogs, verified guided actions and six expressions. Its optional private AI chat deploys alongside the frontend on Vercel, with environment-owned model/provider configuration, signed sessions, Supabase PostgreSQL checkpoints, fenced leases and shared usage limits. Guided actions need no credentials.

- Independent capability registry, versioned schemas and CSP-safe compiled validators.
- Browser observation, verified actions, ambiguity/staleness checks, cancellation and navigation continuation.
- Conversation widget with six emotion callbacks, including thinking during loading.
- Bounded PHP and Node engines, server-only provider transports and PHP/Node conformance fixtures.
- Laravel 13, React 19, Inertia v3 and Next.js App Router adapters.
- Script-based onboarding, bounded source/DOM discovery and optional English Codex/Claude Code setup skills.
- Self-contained WordPress ZIP, guided dashboard setup, filtered context export and configuration-only import.
- GitHub-first release checks, local source/npm/PHP/plugin artifacts, checksums, compatibility evidence and community templates.

### Fixed

- Browser cancellation is rechecked immediately before queued handlers and verifiers start, including resumed navigation. Cancelling an action before its callback starts no longer invokes that callback; a fresh action can still run afterward.
- The real WordPress browser fixture waits for WordPress's deferred login autofocus before filling credentials and verifies both fields before submitting. A delayed-autofocus regression covers the credential-focus race found in Windows CI without altering plugin authentication or relaxing test assertions.
- B1 regressions cover five independent PHP/Node chat messages, continuing after cancellation, ignoring late transport/provider replies after cancellation or timeout, and shared PHP/Node recovery without action replay or attempt-budget resets. These use deterministic providers, not live-model accuracy certification.

### Security and distribution

- Node/PHP assistant history now preserves the provider response schema for both action and final turns, without internal call/snapshot identifiers. This avoids teaching live models an incompatible internal action format; strict response and parameter validation remains unchanged.

- Explicit host authorization, CSRF/origin controls, schema validation, durable checkpoints and bounded inference attempts.
- WordPress lock ownership and quota controls; disabled-by-default activation.
- MIT shared packages; GPL-3.0-or-later combined WordPress plugin with prefixed dependencies, notices and corresponding sources.
- npm packages remain private. npm, Packagist and WordPress.org publishing is deferred.

### Known limitations

This is not stable 1.0 or a production security certification. See [compatibility](docs/compatibility.md) and [security](SECURITY.md). Live-model accuracy, remote CI results, production topology, broad theme/plugin support and assistive-technology review remain unverified. No Rive artwork is redistributed.
