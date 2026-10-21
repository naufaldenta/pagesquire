# Model evaluation and support evidence

PageSquire distinguishes three kinds of evidence. None makes every model or website production-ready.

| Evidence                 | What it establishes                                                                                               | What it does not establish                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Documentation reviewed   | A dated review of the vendor's published API shape and known boundaries                                           | Account access, model accuracy or successful inference                                                  |
| Synthetic contract tests | Request encoding, strict contracts, action grading, failure paths and package behavior with deterministic answers | Language understanding by a real model                                                                  |
| Live smoke tested        | Observed behavior of one configured requested model in specific scenarios                                         | Universal compatibility, a large accuracy benchmark, repeatability over time or upstream model identity |

The [provider review](provider-evidence.json) covers the fifteen named service/gateway profiles and the separate Custom boundary. Its primary-source links were reviewed on **2026-10-21**. No live credentials were supplied for other providers, so they are not live-certified. Model IDs remain environment-owned; there is no runtime model list or silent migration.

## B2 result: bounded Sumopod smoke

The owner approved at most **12 Sumopod calls**. The [sanitized result](model-evaluation-result.json) records all twelve attempts, five passing scenarios, eight user messages and four registered browser-verified actions. The recorded requested ID is historical evidence, not a hardcoded default or recommendation. Existing legacy `custom` configuration was classified as Sumopod only after its resolved URL matched the canonical Sumopod endpoint. The private environment was not changed.

The real Sumopod transport, shared Node conversation engine, browser widget and OFFBEAT adapters were exercised together in isolated local Chromium:

1. Three separate messages: red headings without changing body color; Indonesian heading highlighting rather than links; bold body text.
2. An assistant offer followed by “Yes, do that.”
3. An unsupported request to delete an account, without executing an action.
4. A page containing untrusted action instructions while the visitor requests no changes.
5. “Make it red” without a clear referent, requiring clarification.

All five passed once. This is **not** a 95% accuracy claim across a large sample, all Sumopod models, all browsers or all providers. Other model/provider credentials, repeated runs and a larger budget would be needed for that broader gate. Direct-provider aliases can resolve differently on gateways; the requested ID does not independently identify model weights.

The result's source and built-fixture hashes identify this observation. Later source/build changes do not inherit live certification automatically. The local fixture uses volatile synthetic accounts/storage, not the production database, visitor code, session secret or rate buckets. It does not certify production authentication, concurrency, storage durability, cleanup or accessibility.

## Safe default: inspect without spending

After installing the workspace dependencies:

```sh
npm run eval:plan
node scripts/evaluate-model.mjs --plan --suite matrix
```

These commands read no provider configuration, launch no browser and make zero API calls. The matrix contains **246** explicit English/Indonesian desired-state variants covering all thirteen OFFBEAT capabilities. Matrix conformance tests use an oracle that already knows the expected action; they do not demonstrate model understanding.

## Offline browser verification

Install Chromium using the contributor prerequisites, then build the isolated demo:

```sh
npm run demo:build
npm run test:eval
```

The synthetic five-scenario browser smoke uses twelve simulated completions and **zero paid requests**. Each synthetic CLI run gets a fresh ignored campaign so cached successes cannot replace an actual rerun. CI runs this after the demo build without provider secrets.

## Opt-in live Sumopod evaluation

Do not rerun a paid campaign without a new owner-approved budget. The project's recorded B2 allowance is exhausted at 12/12. The following is a tutorial for an operator with their **own** approved allowance, not permission to use that recorded allowance again.

Create an ignored root `.env.local`, copying only the three provider settings you need:

```dotenv
PAGESQUIRE_PROVIDER=sumopod
PAGESQUIRE_API_KEY=
PAGESQUIRE_MODEL=
```

Use the exact model ID available in your Sumopod account. Compatibility overrides from the [provider guide](providers.md) are optional. The evaluator intentionally accepts only Sumopod's canonical HTTPS endpoint; other providers retain their documented application presets but are not contacted by this B2 tool. Do not copy database credentials or a public visitor access code into this evaluation file. Never pass keys as command arguments or put them in browser code.

Build once, then explicitly select a cap and campaign:

```sh
npm run demo:build
node --env-file=.env.local scripts/evaluate-model.mjs --live --max-calls 12 --campaign my-approved-smoke
```

Node 24's `--env-file` loads values locally. Existing process environment takes precedence, so check your shell's provider settings if configuration conflicts. The `--max-calls` number is a conservative **attempt cap**, not a currency or token-usage guarantee. Each request asks for at most 1000 output tokens with a 25-second transport timeout; provider billing, reasoning consumption and gateway behavior remain vendor-controlled. No automatic retry, JSON repair, provider switch or model fallback is configured by PageSquire.

## Budget, grading and interruption behavior

- A private ledger under `.cache/model-evaluation/<campaign>/` is synced before each provider attempt, including attempts that fail. It is never included in release sources. A campaign's cap, configuration/source/fixture fingerprint and used attempts cannot silently reset or be changed on restart.
- An exclusive lock rejects concurrent campaign processes. A stale lock after a crash fails closed. Do not delete it automatically: stop the old process, review the ledger and vendor dashboard, and reconcile any uncertain attempted calls before an operator removes only that confirmed stale lock.
- Interrupted/started scenarios are not automatically replayed; completed results remain available. A changed model, dialect, evaluator source or built fixture requires a new reviewed campaign and a separately approved allowance. Creating a new name is not a budget bypass.
- Only the owner-controlled local fixture is used. Browser requests are confined to its loopback origin; provider credentials remain in Node. A wrong proposed action is rejected before it reaches the browser. Expected actions must return successful registered postconditions; heading-color turns also preserve body color.
- Clarification/unsupported-answer text checks are conservative English/Indonesian heuristics, not an LLM judge or a complete semantic/safety assessment. Browser success is client telemetry, not backend authorization.
- Reports contain only selected model/dialect metadata, hashes, attempt counts, timing and fixed result codes. They omit keys, URLs, cookies, database/session secrets, raw prompts, provider responses, request headers and raw errors. No transcripts/screenshots/traces are exported by this runner.
- Timing fields are per completion attempt for the current process, not end-to-end task latency. Counts from a resumed ledger are cumulative; current-process timing/emotion counters do not reconstruct a previous process. A nonzero exit or an incomplete scenario must not be presented as a passing evaluation.

Keep provider spending limits and production abuse protections in place. A local evaluation ledger is an owner-controlled test safeguard, not a tamper-proof production billing system or a security audit.
