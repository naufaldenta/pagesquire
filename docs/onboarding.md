# Onboarding a website: scripts first, coding agent optional

PageSquire does not fine-tune a model for each website. The model sees reviewed capabilities and filtered page context. The `pagesquire` CLI helps you find candidate integration points in your site, then map their real behavior to the same contract that execution and verification use.

The scripts work without AI. If you want, a coding agent can help finish the mapping and tests with a generated skill. Either way, nothing the scan finds is enabled automatically, and no business permissions are guessed.

Installing PageSquire does not mean every feature is covered. Inspect each real control on the site, compile its exact schema and verify its real effect. For cursor feedback, nested scrolling, reading and summaries, accessibility controls, tours and voice, see [assistant driving](assistant-driving.md). Avoid site-specific intent rules that drop the rest of a compound request.

## 1. Build the CLI

From the PageSquire checkout, run `npm ci` and `npm run build`. `npm run pagesquire -- ...` then runs the CLI. To use it from another project, install the CLI, core and protocol tarballs and run the `pagesquire` executable. The package is not on npm yet and the name is not reserved there, so do not run it through a command that downloads packages on demand.

The examples below run from the PageSquire checkout against a website in a sibling folder. Replace the root and URL with your own development project. Nothing is installed into the website's dependencies.

## 2. Create a default-deny configuration

```sh
npm run pagesquire -- init --root ../my-website --url http://127.0.0.1:8000/
```

`init` creates:

- `pagesquire.config.json`: source roots, paths to the trusted manifest and bindings, the generated directory, and the browser origin and paths you allow.
- `pagesquire/capabilities.json`: an empty capability manifest.
- `pagesquire/bindings.json`: an empty list of named handlers and verifiers.
- `pagesquire/adapter.mjs`: your adapter's entry point, with nothing enabled.

`init` does not touch `AGENTS.md`, `CLAUDE.md`, package or composer files, lockfiles or application code. It stops if a file it would create already exists with different content. Review the configuration and add only page paths you own and want observed. Configuration paths must stay inside the project and may not go through symlinks or junctions. Do not enable a provider yet.

## 3. Scan the source and, optionally, pages

```sh
npm run pagesquire -- scan --root ../my-website
npm run pagesquire -- report --root ../my-website
```

The source scanner reads local files up to a size limit, recognizes framework dependencies, and reports candidate controls, headings and routes by file and line. It never runs PHP, imports the site's JavaScript, runs Composer or npm scripts or calls Artisan, and it does not export source snippets or route strings. Folders for secrets, config, private files, generated output and dependencies are skipped. The scanner is conservative and will miss things.

To observe rendered pages, install Playwright's Chromium in the CLI environment and pass the configured URLs:

```sh
npm exec -- playwright install chromium
npm run pagesquire -- scan --root ../my-website --url http://127.0.0.1:8000/
npm run pagesquire -- report --root ../my-website
```

Each page is rendered in an isolated browser without a login. Nothing is clicked or filled in. The site's own scripts run, but fetch and XHR, foreign resources, mutating methods, service workers, WebSockets, downloads and unexpected navigation are blocked. GET requests for the page's resources still reach the site, so scan a staging copy and avoid routes where a GET changes data. There is no automatic crawling and no import of logged-in browser storage.

`.pagesquire/scan.json` holds metadata only. `.pagesquire/report.md` lists truncation, skipped inputs, ambiguous selector hints, blocked requests and configured pages that were not visited. The scan can miss hidden components, database-driven layouts, slow async states, logged-in routes, shadow DOM and iframes, so a clean scan does not mean the assistant knows every feature. Keep reports private: paths and IDs can reveal business details.

`report` and `prepare-ai` check that the source and configuration have not changed since the scan. Scan again after changes. DOM observations go stale quickly, so repeat them when needed. Add `.pagesquire/` to your ignore file if you do not want the reports committed; the CLI does not edit ignore files.

## 4. Choose manual or assisted mapping

**Manual.** Write the capabilities, the named handler and verifier exports and the binding list yourself, using the [binding reference](../packages/cli/templates/assistant-setup/references/integration.md), the [runtime contract](runtime.md) and the [Laravel/React guide](laravel-react.md).

**With a coding agent.** Generate project-local guidance. This sends nothing to a model:

```sh
npm run pagesquire -- prepare-ai --root ../my-website --host both
```

Pass `codex`, `claude` or `both`, and review the generated skill and references. Global configuration, host instructions, dependencies and the site's source are left alone. Installation stops on conflicting skill files or legacy commands. Running it again with the same result changes nothing. If the configuration changed, review and remove the old generated context file yourself before you generate it again.

## 5. Run the generated skill

Open the website project in the coding agent you chose and run:

- Codex: `$assistant-setup`
- Claude Code: `/assistant-setup`

The files follow each tool's skill conventions: [Codex local skills](https://developers.openai.com/codex/skills) and [Claude Code project skills](https://code.claude.com/docs/en/skills). Reload or restart the tool if it does not find the new skill. If another skill has the same name, pick the project-local one; precedence differs between tools. PageSquire does not change personal or enterprise skill settings.

The skill asks the agent to read the relevant code, keep existing changes, tell headings apart from body text, define narrow desired-state operations, write real postcondition verifiers and run the tests. Scan output and page data are treated as untrusted evidence. The agent should not guess missing permission decisions, secrets, dependencies or production access. The skill is guidance, not a security boundary, and not every model follows it well.

## 6. Validate, compile, then test behavior

```sh
npm run pagesquire -- validate --root ../my-website
npm run pagesquire -- validate --root ../my-website --compile
```

`validate` checks the manifest, duplicate IDs, parameter schemas, the binding list, local paths, and that bindings are direct named function exports. It does not import the adapter. Empty manifests, unsupported schemas and consequential actions fail. `--compile` writes CSP-safe `parameters.js` and `bindings.mjs` into the generated directory, and leaves conflicting hand-written files alone.

Use these exports in `CapabilityRegistry`, and the same trusted manifest on the server. The registry checks for schema drift again at runtime. Code that passes validation can still throw, return false, ignore cancellation or have unsafe side effects, so test it in a browser and review it before you enable anything. That is why the CLI always reports `runtimeVerified: false`.

At minimum, test the real postcondition and the failure behavior of each feature. For accessibility features, test:

- heading color changes headings only, not body text
- explicit link highlighting and font weight
- several calls in a row
- ambiguous and hidden controls
- cancellation

Test navigation with your framework's adapter. Use synthetic data and a fake provider; measure live-model accuracy and cost separately before going live.

## Other backends

The CLI's own tests check generated validators and bindings against real browser postconditions, and check the file layout for both coding agents. They do not run a Codex or Claude session.

For other backends, see [standalone PHP](standalone-php.md) and [Node/Next.js](node-next.md). WordPress has its own [dashboard workflow](../packages/wordpress/README.md): it reports filtered page metadata and element counts, exports project-local skills and imports configuration only. It does not scan server source.
