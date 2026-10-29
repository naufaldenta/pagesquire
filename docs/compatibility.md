# Compatibility

PageSquire **0.1.0-beta.0** is a beta, not 1.0. A dependency range does not mean every version in it has been tested. The [machine-readable matrix](compatibility.json) is checked against the lockfiles by `npm run release:check`.

## Tested targets

Tests ran on Windows with Node.js 24.14.1, PHP 8.3.30 and Chromium through Playwright 1.64.1. Providers are deterministic test doubles, so no paid AI service is needed. At the F5 milestone 209 component tests passed; run the current suite for up-to-date results.

The [OFFBEAT demo](../examples/brutalist-demo/README.md) adds a Vercel Node API and a Supabase PostgreSQL store. Its opt-in database tests also passed against the hosted demo database over verified TLS, covering checkpoints, concurrent budgets, lease fencing, expiry and row-level security. A small live smoke request through Sumopod also succeeded. The default browser tests are synthetic and spend no provider credits.

| Target             | Tested version                              | What is covered                                                                                                                   |
| ------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Plain HTML/browser | ES2022 bundle, Chromium                     | Registered capabilities, CSP without unsafe-eval, heading-only color, links, font weight, ambiguity, cancellation and navigation  |
| Standalone PHP     | PHP 8.3.30, Opis 2.6.0                      | Native endpoint, provider failure paths, PHP/Node protocol conformance and a clean offline package install                        |
| Laravel            | 13.37.0, PHP 8.3.30                         | Testbench endpoint, auth, CSRF, session and configuration tests; no public deployment                                             |
| React/Inertia      | React 19.3.1, Inertia React 3.9.1           | Real browser lifecycle and navigation fixtures; not a full deployed Laravel/Inertia app                                           |
| Node/Next.js       | Node 24.14.1, Next.js 16.4.2                | App Router conversation and navigation in development, plus a production build; serverless and shared storage untested            |
| WordPress          | 7.1.3, PHP 8.3.30, SQLite Integration 3.1.0 | Installed ZIP, setup, export and import, role, CSRF and origin checks, budgets, lock collisions, block and classic themes, mobile |

The packages declare Node >=24, PHP ^8.3, Laravel ^13.0, React ^19.0.0 and WordPress >=7.1. These are minimum requirements, not a wider test matrix. The WordPress `Tested up to: 7.1` field names the tested major and minor version.

Windows and Ubuntu jobs run on [GitHub Actions](https://github.com/naufaldenta/pagesquire/actions/workflows/ci.yml). Check the run for the exact commit you care about; an earlier green run or a badge says nothing about a different commit. Any newly claimed host or version needs a fixture and passing tests.

## Known limits and the 1.0 gate

- One [live Sumopod smoke test](model-evaluation.md) passed five scenarios in twelve calls with one model. There is no multi-provider accuracy baseline, repeated evaluation or production-host audit yet. The synthetic matrix does not test model understanding.
- Firefox, Safari, screen readers and other assistive technology are untested. There is no licensed Rive renderer. The six emotion callbacks include `thinking` while loading.
- One conversation per session, with no general transcript restore or cross-tab coordination. Full-page continuation is an opt-in, one-time checkpoint, not saved history.
- File storage works on a single host. Multi-instance or serverless setups need a shared atomic durable store, plus authentication, quotas, cleanup, retention and failure recovery from the host.
- WordPress on MySQL/MariaDB, with persistent object caches, multiple workers, multisite, Elementor or WooCommerce is untested. Only the four built-in adapters are covered.
- No dangerous business actions are enabled by default. There is no universal website discovery and no model fine-tuning. Source and DOM reports are incomplete; site owners review them.

Before 1.0: declare the supported matrix and pass it in CI, measure live models with a set budget, review deployment, security and accessibility gaps, and fix or clearly exclude what remains. See [releasing](releasing.md).
