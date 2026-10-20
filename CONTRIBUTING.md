# Contributing to PageSquire

This is a multi-framework/WordPress alpha with F6 GitHub-first release preparation. Keep pull requests focused on a documented capability, verified behavior, or a concrete compatibility gap. Read the [code of conduct](CODE_OF_CONDUCT.md), [compatibility evidence](docs/compatibility.md) and [security policy](SECURITY.md) first.

## Local workflow

```sh
npm ci
composer install
npm exec -- playwright install chromium
npm test
npm run format:check
```

Use Node.js 24 or later and PHP 8.3. `npm test` includes PHP engine/Laravel tests, browser conversations, type checks and offline package installation. Add meaningful tests for changed contracts or behavior. Browser changes need a real DOM/postcondition test rather than only a mocked successful tool response. PHP tests use PHPUnit classes and faked providers; never add a live-key requirement. Run Pint on changed PHP sources and Prettier on supported source/docs.

## Project conventions

- Write canonical documentation, setup instructions, comments, and public technical messages in English.
- Keep protocol changes versioned and consistent with their exported schemas.
- Keep the core independent of frameworks and model providers.
- Register execution and verification together. Prefer idempotent desired-state operations over blind toggles.
- Do not add credentials, real user data, government documents, third-party branding, or assets without redistribution rights.
- Do not claim framework or browser compatibility without a corresponding fixture and test.

Runtime translations may be contributed separately from the canonical English guides. The development repository and public issue tracker are at [naufaldenta/pagesquire](https://github.com/naufaldenta/pagesquire). Use private vulnerability reporting for security issues, never the public bug template.

## Issues and pull requests

Use the English bug/feature templates once the repository opens. Include the exact PageSquire/host versions, minimal synthetic reproduction, expected/actual behavior and relevant test output. Redact transcripts, URLs, credentials and website exports; do not report security exploits publicly.

Before a substantial change, describe the integration boundary and compatibility claim. Add a fixture and failing regression test, implement the smallest safe change, then run the affected tests plus type/format/release checks. The PR template requests actual commands/results and explicitly untested targets. Full CI covers Windows and Ubuntu; it is configured, not yet observed remotely. Maintainer review is required before merging; contributors must not self-approve security boundaries.

Contributions must be your own or carry compatible redistribution rights. Shared packages are MIT; the combined WordPress plugin is GPL-3.0-or-later and preserves dependency notices/corresponding source. Do not change licenses or add dependencies without maintainer review. No CLA, funding commitment or response-time guarantee is established.

See [adapter authoring](docs/adapter-authoring.md) for capability contracts and [releasing](docs/releasing.md) for package/version/approval gates. Local artifact preparation is not permission to publish, register namespaces or deploy examples.
