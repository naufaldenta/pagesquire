# Contributing to PageSquire

Thanks for helping. Keep pull requests focused: one capability, one behavior fix or one compatibility gap at a time. Please read the [code of conduct](CODE_OF_CONDUCT.md), the [compatibility notes](docs/compatibility.md) and the [security policy](SECURITY.md) first.

## Getting set up

You need Node.js 24 or later and PHP 8.3.

```sh
npm ci
composer install
npm exec -- playwright install chromium
npm test
npm run format:check
```

`npm test` builds everything, then runs the API check, type checks, the Node and PHP tests (including Laravel), browser, extension and WordPress tests, an offline package install and the release checks. Format changed sources and docs with Prettier (`npm run format`) and changed PHP files with Pint (`vendor/bin/pint`).

## Writing tests

- Add tests for any contract or behavior you change.
- Browser changes need a real DOM test that checks what actually changed on the page, not only a mocked success response.
- PHP tests use PHPUnit classes and fake providers. Never add a test that needs a live API key.
- If you change the public API, `npm run api:check` will flag it. Update the baseline on purpose and explain why; see [API review](docs/api-contract.md), [upgrading](docs/upgrading.md) and [maintenance](docs/maintenance.md).

## Project conventions

- Write docs, setup instructions, code comments and public technical messages in English. Runtime translations are welcome separately.
- Keep protocol changes versioned and in line with the exported schemas.
- Keep the core independent of frameworks and model providers.
- Register execution and verification together. Prefer idempotent "set to this state" operations over blind toggles.
- Do not add credentials, real user data, government documents, third-party branding, or assets you do not have the right to redistribute.
- Do not claim framework or browser support without a fixture and a test for it.

## Issues and pull requests

The repository and issue tracker are at [naufaldenta/pagesquire](https://github.com/naufaldenta/pagesquire). Use the bug, feature and beta feedback templates. Include exact PageSquire and host versions, a minimal reproduction with synthetic data, expected and actual behavior, and relevant test output. Remove transcripts, private URLs, credentials and website exports. Report security problems through [private vulnerability reporting](SECURITY.md), never in a public issue.

For a bigger change, describe the integration boundary and what compatibility you are claiming before you start. Then add a fixture and a failing test, make the smallest safe change, and run the affected tests plus type, format and release checks. The PR template asks for the commands you ran, their results and anything you did not test. CI runs on Windows and Ubuntu; check the [results for your commit](https://github.com/naufaldenta/pagesquire/actions/workflows/ci.yml). A maintainer reviews every PR before merge.

Contributions must be your own work or come with compatible licensing. The packages are MIT-licensed. The WordPress plugin bundles them under GPL-3.0-or-later and keeps the dependency notices and corresponding source. Ask before changing licenses or adding dependencies.

See [adapter authoring](docs/adapter-authoring.md) for capability contracts and [releasing](docs/releasing.md) for versions and release steps.

To try PageSquire on your own site as a beta tester, follow the [beta guide](docs/beta.md) and report back with the [beta feedback template](.github/ISSUE_TEMPLATE/beta_feedback.md). Say whether you set it up yourself or with help, and report what actually changed on the page rather than what the assistant said.
