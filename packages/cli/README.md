# @pagesquire/cli

Command-line onboarding for adding PageSquire to a website. Requires Node.js 24+.

The static commands need no model, cloud account or API key. They never run your project's code, install its dependencies or publish anything.

## Install

Keep the CLI out of your website's dependencies: install it in a small tools folder next to the website.

```sh
mkdir pagesquire-tools
cd pagesquire-tools
npm init -y
npm install @pagesquire/cli@beta
```

PageSquire is in beta, so ask for the `beta` tag. For a single command without installing, `npx @pagesquire/cli@beta <command>` works too.

## Quick start

From the tools folder, with the website in `../my-website`:

```sh
npx pagesquire init --root ../my-website --url http://127.0.0.1:8000/
npx pagesquire scan --root ../my-website
npx pagesquire report --root ../my-website
npx pagesquire prepare-ai --root ../my-website --host both
```

Next, review the installed skill and run `$assistant-setup` in Codex or `/assistant-setup` in Claude Code from the website project. The CLI never starts either assistant and never sends anything to a model. The coding agent's permissions and costs are set by the tool you choose.

You can also integrate by hand: write the manifest, the named handler and verifier functions and the binding inventory yourself, then validate and test.

## Validate

```sh
npx pagesquire validate --root ../my-website
npx pagesquire validate --root ../my-website --compile
```

The first command is read-only. The second also writes generated validators and binding imports, but still does not import your application modules.

Output is JSON with `scope: "static-contract"` and `runtimeVerified: false`. An empty or invalid manifest exits with status 1. A pass means the schemas match and the named functions are exported directly. It does not mean the handlers are safe or work, so test in the host app and the browser before enabling anything.

See [the onboarding guide](https://github.com/naufaldenta/pagesquire/blob/main/docs/onboarding.md) for the full sequence, the files involved, privacy boundaries and the manual binding format.

## Optional DOM observation

Install Playwright and its Chromium binary in the tools folder, then pass the page you want observed:

```sh
npm install playwright
npx playwright install chromium
npx pagesquire scan --root ../my-website --url http://127.0.0.1:8000/
```

- The URL must match `site.origin` and one of the exact `site.paths` in the website's `pagesquire.config.json`. You can pass at most five URLs, and links are not followed.
- Don't include credentials, query strings or fragments.
- The browser starts fresh, with no existing login or session.
- Service workers, WebSockets, downloads, popups, other origins, fetch/XHR, non-GET/HEAD requests and out-of-scope navigation are blocked. Same-origin documents, scripts, styles, images and fonts load normally.
- Unlike the static scanner, this runs the page's scripts, and GET requests are not always free of side effects. Only scan development or staging pages you control.

The scan exports control metadata, stable selector hints and counts of ambiguous matches and headings. It stores no page text, labels, field values, screenshots, cookies, network payloads or login state. Paths and IDs can still be sensitive, so review reports before sharing them.

Blocked resources, hidden or logged-in states and dynamic data can leave gaps. A DOM result describes the page at one moment. It does not authorize anything or prove that an action works.

## Files and safeguards

`init` creates `pagesquire.config.json`, `pagesquire/capabilities.json`, `pagesquire/bindings.json` and `pagesquire/adapter.mjs`. The manifest starts empty. Scans and reports go in `.pagesquire/`, and generated browser files go in `pagesquire/generated/` by default.

Installing the skill writes only to `.agents/skills/assistant-setup/` and/or `.claude/skills/assistant-setup/` in the selected project. Your existing instructions, application files, dependencies and secrets are left alone.

- Conflicting files and project symlinks or junctions are refused. There is no force option.
- Repeating an identical install changes nothing.
- Reports and generated files only replace files the CLI can identify as PageSquire's own.
- The CLI does not guard against another process editing the files at the same time. Run it on a trusted local checkout.

Static scans read at most 500 files, 256 KiB per file, 8 MiB in total, 3,000 directory entries and 1,000 candidates. Dependency, build, private, config, storage, upload, backup and hidden directories are skipped, along with sensitive file names. A file with a PageSquire private, ignore or root annotation is left out of candidate extraction. Scripts, route commands and package hooks are never run. Candidates can be false positives, and disabled or hidden branches can't be fully understood from source alone.

Parameter schemas must be synchronous and self-contained, with closed object inputs. Named function and arrow exports in JS/TS are read with Babel's parser. Default exports, re-exports and imported aliases are not resolved. Consequential capabilities stay disabled. TypeScript adapters need the host's bundler. Recompile the generated bindings after changing the manifest or schemas; the browser registry also checks schema identity on its own.

The CLI does not train a model, crawl the site or generate permissions. It is not a WordPress plugin or a Node/Next.js backend.

For WordPress, use the [plugin dashboard workflow](https://github.com/naufaldenta/pagesquire/blob/main/packages/wordpress/README.md) instead of scanning a production upload directory. Its exported setup skill only prepares configuration for the built-in adapters.
