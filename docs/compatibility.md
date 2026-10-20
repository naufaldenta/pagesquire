# Compatibility and evidence

PageSquire **0.1.0-alpha.0** is a development preview, not stable 1.0. A dependency range is not a claim that every matching version has been tested. The [machine-readable matrix](compatibility.json) is checked against the lockfiles by `npm run release:check`.

## Locally verified targets

Evidence was recorded on Windows, Node.js 24.14.1, PHP 8.3.30 and Chromium through Playwright 1.64.1. Providers are deterministic test doubles; no paid AI service is required. The F5 baseline passed 209 component tests; this count is historical evidence, not a substitute for running the current checks.

The separate [OFFBEAT demo](../examples/brutalist-demo/README.md) now includes a same-project Vercel Node API and a Supabase PostgreSQL store. Its opt-in database tests also passed against the owner's hosted database with verified TLS, covering committed checkpoints, concurrent budgets, lease fencing, expiry and RLS. A bounded owner-authorized Sumopod smoke request succeeded using the environment-selected model. This is narrow integration evidence, not a model-accuracy benchmark or a general serverless security certification. Default automated browser tests remain synthetic and spend no provider credits.

| Target             | Tested version                              | Coverage and boundary                                                                                                            |
| ------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Plain HTML/browser | ES2022 bundle, Chromium                     | Registered capabilities, CSP without unsafe-eval, heading-only color, links, font weight, ambiguity, cancellation and navigation |
| Standalone PHP     | PHP 8.3.30, Opis 2.6.0                      | Native endpoint, provider failure paths, PHP/Node protocol conformance and clean offline package consumer                        |
| Laravel            | 13.37.0, PHP 8.3.30                         | Testbench endpoint/auth/CSRF/session/configuration tests; no public deployment                                                   |
| React/Inertia      | React 19.3.1, Inertia React 3.9.1           | Real browser lifecycle and navigation fixtures; not a full deployed Laravel/Inertia application                                  |
| Node/Next.js       | Node 24.14.1, Next.js 16.4.2                | App Router development conversation/navigation and optimized build; no serverless/shared-storage certification                   |
| WordPress          | 7.1.3, PHP 8.3.30, SQLite Integration 3.1.0 | Installed ZIP, setup/export/import, role/CSRF/origin controls, budgets/lock collisions, block/classic themes and mobile composer |

Package declarations currently require Node >=24 for Node tooling/runtime, PHP ^8.3, Laravel ^13.0, React ^19.0.0, and WordPress >=7.1. These are declared integration floors/ranges, not an expanded test matrix. The WordPress `Tested up to: 7.1` field identifies its tested major/minor, not every patch/environment.

Windows and Ubuntu jobs run through [GitHub Actions](https://github.com/naufaldenta/pagesquire/actions/workflows/ci.yml). Check the result and logs for the exact commit: a configured target, past green run or badge is not proof that a different revision passed. This matrix records local fixture evidence, not stable-support certification. Every newly claimed host/version needs a fixture and recorded passing checks.

## Known limits and the 1.0 gate

- No live-provider evaluation baseline, tool-selection accuracy target or production-host audit yet. Mocked tool calls do not prove model understanding.
- Firefox, Safari, screen readers, keyboard/assistive-technology certification and a licensed Rive renderer remain unverified or unimplemented. Six emotion callbacks include `thinking` while loading.
- One conversation slot per session; no general transcript restoration or cross-tab coordination. Full-document continuation is an opt-in one-shot checkpoint, not transcript persistence.
- File storage is single-host. Multi-instance/serverless use requires genuinely shared atomic durable storage, authentication, quotas, cleanup, retention and failure recovery supplied by the host.
- WordPress MySQL/MariaDB, persistent object caches, multi-worker load, multisite, Elementor and WooCommerce are not certified. Only the four documented built-in adapters are covered.
- There are no dangerous business actions by default, no universal website discovery and no model fine-tuning step. Source/DOM reports remain incomplete evidence that owners review.

Before 1.0, declare the actual support matrix, pass it in remote CI, measure live-model behavior under explicit budgets, review deployment/security/accessibility gaps, and resolve or clearly exclude remaining important gaps. Follow the [release gates](releasing.md); local alpha checks alone cannot promote a release to stable.
