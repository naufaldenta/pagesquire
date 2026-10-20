# @pagesquire/cli

Local PageSquire F3 onboarding for Node.js 24+. Static commands need no model, cloud account, API key or project-code execution. They do not install website dependencies or publish anything. The package is an unpublished alpha; use the checkout or local tarballs, not a public npm download command.

From the PageSquire checkout:

```sh
npm ci
npm run build
npm run pagesquire -- init --root ../my-website --url http://127.0.0.1:8000/
npm run pagesquire -- scan --root ../my-website
npm run pagesquire -- report --root ../my-website
npm run pagesquire -- prepare-ai --root ../my-website --host both
```

Then review the installed skill and invoke `$assistant-setup` in Codex or `/assistant-setup` in Claude Code from the website project. The CLI never launches either assistant or transmits context to a model. Coding-agent permissions/costs belong to the chosen host. Manual integration is equally supported: author the manifest, named handler/verifier functions and binding inventory yourself, then validate and test.

```sh
npm run pagesquire -- validate --root ../my-website
npm run pagesquire -- validate --root ../my-website --compile
```

The first command is read-only. The second explicitly writes generated validators and binding imports, but still does not import application modules. Results are JSON with `scope: "static-contract"` and `runtimeVerified: false`. Empty/invalid manifests return exit status 1. Success means schemas and direct named-function exports match, not that handlers are safe or work. Host/browser tests are mandatory before enabling features.

See [the onboarding guide](../../docs/onboarding.md) for the full sequence, files, scope, privacy boundaries, and manual binding format.

## Optional DOM observation

Install Playwright and its Chromium binary in the CLI environment, then explicitly request an approved page:

```sh
npm exec -- playwright install chromium
npm run pagesquire -- scan --root ../my-website --url http://127.0.0.1:8000/
```

The URL must match `site.origin` and an exact `site.paths` pathname in the website's `pagesquire.config.json`. At most five explicit URLs are allowed. No links are followed automatically. Do not supply credentials, query strings or fragments. The fresh isolated browser has no existing login/session. Service workers, WebSockets, downloads, popups, foreign origins, fetch/XHR, non-GET/HEAD requests and out-of-scope navigation are blocked. Normal same-origin documents/scripts/styles/images/fonts may load; GET is not universally side-effect free. Scan only owner-approved development/staging pages. Browser scripts run as part of rendering the page, unlike the static scanner, which never executes project code.

Only control metadata, stable selector hints, ambiguity counts and heading counts are exported. No page text, labels, field values, screenshots, cookies, network payloads or authentication state are stored. Metadata/paths/IDs can still be sensitive: review reports before sharing. Blocked resources, hidden/authenticated states and dynamic data can make coverage incomplete. DOM results are observations at one instant, never authorization or runtime postcondition proof.

## Files and safeguards

Init creates `pagesquire.config.json`, `pagesquire/capabilities.json`, `pagesquire/bindings.json`, and `pagesquire/adapter.mjs`. The manifest is empty by default. Scans/reports live in `.pagesquire/`; generated browser files live under `pagesquire/generated/` by default. Skill installation touches only the selected project's `.agents/skills/assistant-setup/` and/or `.claude/skills/assistant-setup/`. Existing instructions, application files, dependencies and secrets remain untouched.

Conflicting files and project symlinks/junctions are refused; there is no force-overwrite switch. Identical installations are idempotent. Reports and generated files can replace only positively identified PageSquire artifacts. Filesystem changes are bounded, but simultaneous hostile filesystem edits are outside this alpha's threat model; use a trusted local checkout.

Static scans cap source inputs at 500 files, 256 KiB/file, 8 MiB total, 3,000 directory entries and 1,000 candidates. Standard dependency/build/private/config/storage/upload/backup/hidden locations and sensitive filename patterns are excluded. A source file containing PageSquire private/ignore/root annotations is conservatively omitted from candidate extraction. Scripts, route commands and package hooks are never run. Static candidates can be false positives; disabled/hidden branches cannot be fully understood from source alone.

Parameter schemas must be synchronous/self-contained, with closed object inputs. Direct named function/arrow exports in JS/TS are inspected using Babel's parser; default/re-exported/imported aliases are not resolved. Consequential capabilities remain disabled. TypeScript adapters require the host's bundler. Generated bindings must be recompiled after manifest/schema changes; the browser registry independently checks schema identity.

F3 is not automatic website training, a crawler, a permissions generator, a WordPress plugin, or a Node/Next.js backend. It does not claim complete site coverage or production readiness.

For WordPress, use the separate [plugin dashboard workflow](../wordpress/README.md), not a CLI source scan of a production upload directory. Its exported setup skill prepares only reviewed built-in adapter configuration.
