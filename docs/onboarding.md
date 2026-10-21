# Hybrid onboarding: scripts first, optional coding-agent help

For cursor/target feedback, nested scrolling, reading/summary workflows, complete host accessibility-control inventory, tours and opt-in voice, follow [assistant driving](assistant-driving.md). A successful install is not complete feature coverage: inspect every actual host control, compile its exact schema and verify its real effect. Do not install site-specific intent rules that discard the rest of a compound request.

PageSquire does not require model fine-tuning for each website. The model receives reviewed capabilities and filtered runtime context. F3 helps the website owner discover candidate integration points, then map actual behavior to the same contract used by execution and verification.

The scripts work without an AI. A coding assistant can help complete the semantic mapping and tests using a prepared English skill. Neither path automatically enables discovered buttons or infers business permissions.

## 1. Build the unpublished CLI

From the PageSquire checkout, run `npm ci` and `npm run build`. The root `npm run pagesquire -- ...` command runs the local CLI. For local packaged consumers, install the CLI/core/protocol tarballs and invoke the `pagesquire` executable. The package is not on npm yet; do not use a download-on-demand command for an unreserved name.

The examples below run from the PageSquire checkout and target an existing sibling website. Replace the root and URL with your own development project. Nothing is installed into that website's dependencies.

## 2. Initialize default-deny configuration

```sh
npm run pagesquire -- init --root ../my-website --url http://127.0.0.1:8000/
```

Created files:

- `pagesquire.config.json`: source roots, trusted manifest/binding paths, generated directory, and explicit browser origin/path scope.
- `pagesquire/capabilities.json`: empty capability manifest.
- `pagesquire/bindings.json`: empty named handler/verifier inventory.
- `pagesquire/adapter.mjs`: site-owned implementation entry point with no enabled features.

Init does not edit `AGENTS.md`, `CLAUDE.md`, package/composer files, lockfiles or existing application code. Existing conflicting content stops the operation. Review the configuration; add only exact page paths you own and intend to observe. Configuration paths must remain inside the project, without symlinks/junctions. Do not enable a provider at this stage.

## 3. Scan source, optionally observe pages

```sh
npm run pagesquire -- scan --root ../my-website
npm run pagesquire -- report --root ../my-website
```

The source scanner reads bounded local files, recognizes framework dependency names, and reports candidate controls/headings/routes by file/line. It never executes PHP, imports website JavaScript, runs Composer/npm scripts, invokes Artisan, or exports source snippets/route literals. Standard secret/config/private/generated/dependency locations are excluded. Candidate extraction is deliberately conservative and incomplete.

For DOM observation, install Playwright/Chromium in the CLI environment and explicitly supply configured URLs:

```sh
npm exec -- playwright install chromium
npm run pagesquire -- scan --root ../my-website --url http://127.0.0.1:8000/
npm run pagesquire -- report --root ../my-website
```

An isolated unauthenticated browser renders that exact page. No buttons are clicked and no fields filled. Browser rendering runs the site's page scripts, but fetch/XHR, foreign resources, mutating methods, service workers, WebSockets, downloads and unapproved navigation are blocked. GET requests for approved rendering resources still reach the site; use owner-approved staging pages, not routes with mutating GET behavior. No automatic crawling or authenticated storage import is supported.

`.pagesquire/scan.json` contains metadata only. `.pagesquire/report.md` describes truncation, skipped inputs, ambiguous selector hints, blocked requests and configured but unvisited pages. Hidden components, database-driven layouts, slow asynchronous states, authenticated routes and shadow DOM/iframes may be absent. A successful scan does not mean the assistant understands every feature. Review reports privately; paths and stable IDs can still identify business information.

Reports and AI preparation re-check the current source/configuration snapshot. Changed or added source inputs require another scan. DOM observations may change immediately after capture and must be repeated when needed; freshness checks do not certify live DOM state. Add `.pagesquire/` to your own ignore rules if reports should not be committed; the CLI does not edit existing ignore files.

## 4. Choose manual or assisted mapping

Manual: author capabilities, direct named handler/verifier exports, and the binding inventory using the [binding reference](../packages/cli/templates/assistant-setup/references/integration.md), [runtime contract](runtime.md), and [Laravel/React guide](laravel-react.md).

AI-assisted: create project-local guidance without sending anything to a model:

```sh
npm run pagesquire -- prepare-ai --root ../my-website --host both
```

Choose `codex`, `claude`, or `both` explicitly. Review the generated skill and references. No global configuration, host instructions, dependencies or website source are changed. Conflicting skill files or legacy commands stop installation. Identical installs are idempotent; after config changes, review/remove the old generated context file yourself before regenerating rather than overwriting it blindly.

## 5. Invoke the prepared integration skill

Open the website project in the selected assistant and invoke:

- Codex: `$assistant-setup`
- Claude Code: `/assistant-setup`

The project paths follow the hosts' official skill discovery conventions: [Codex local skills](https://developers.openai.com/codex/skills) and [Claude Code project skills](https://code.claude.com/docs/en/skills). Reload/restart the host if the new skill is not discovered. If another skill has the same name, select/review the project-local one; host precedence can differ. PageSquire does not modify personal/enterprise skill settings.

The skill asks the coding agent to inspect relevant real code, preserve existing changes, distinguish headings from body text, define narrow desired-state operations, implement real postcondition verifiers, and run relevant tests. Scan/source/page data remains untrusted evidence. Missing permission decisions, secrets, dependencies or production authority must not be guessed. The generated skill is guidance, not a security boundary or a guarantee that every coding model will follow it correctly.

## 6. Validate, compile, then verify behavior

```sh
npm run pagesquire -- validate --root ../my-website
npm run pagesquire -- validate --root ../my-website --compile
```

Validation checks the manifest, duplicate IDs, parameter schemas, binding inventory, safe local paths and direct named-function exports without importing any adapter. Empty manifests, unsupported schemas and consequential actions fail. `--compile` explicitly writes CSP-safe `parameters.js` plus `bindings.mjs` imports under the configured generated directory. Hand-written conflicts are preserved.

Use these exports in `CapabilityRegistry` and the same trusted manifest on the server. The existing registry checks schema drift again at runtime. Code that passes static validation can still throw, return false, ignore cancellation or perform unsafe side effects; run host/browser tests and review the implementation before enabling anything. The CLI always reports `runtimeVerified: false`, even after compilation.

At minimum, test your selected feature's actual postcondition and failure behavior. For accessibility, test heading-only color (body unchanged), explicit link highlighting and font weight, combined sequential calls, ambiguous/hidden controls, and cancellation. Test navigation with your actual framework adapter. Use synthetic data and fake providers; live-provider accuracy, costs and production rollout need separate approval/evaluation.

## Current boundary

The fixture tests verify generated validators/bindings against real browser postconditions and test both skill-host artifact layouts. They do not launch a separate Codex/Claude session or establish coding-agent adherence. F4 supplies [standalone PHP](standalone-php.md) and [Node/Next.js](node-next.md) adapters. F5 provides a separate [WordPress dashboard workflow](../packages/wordpress/README.md): filtered metadata/DOM counts, exported project-local skills and configuration-only import rather than server-source scanning. Public publishing remains F6. No existing JDIH application code is modified by these examples.
