# PageSquire one-tag embed

A prebuilt browser bundle that adds the PageSquire widget to any page with a single script tag and no build step. It ships a fixed, verified catalog:

- `page.read`
- `page.scroll_to`
- `page.highlight`
- `browser.navigate`, only when `data-pages` lists more than one page

For custom capabilities, use the npm packages and the [onboarding CLI](../../docs/onboarding.md).

## 1. Build or host the files

The bundle is not one of the npm packages. Build it from a checkout of this repository:

```sh
git clone https://github.com/naufaldenta/pagesquire.git
cd pagesquire
npm ci && npm run build
```

The build writes `packages/embed/dist/`:

- `pagesquire.min.js`, the bundle with widget, runtime, client and compiled validators
- `pagesquire.css`
- `manifest.json`, the catalog the server must load

Serve the two browser files from your own origin or CDN. There is no public CDN copy, because no published package contains the bundle.

## 2. Add the tag

```html
<meta name="csrf-token" content="SESSION_BOUND_TOKEN" />
<script
  src="/assets/pagesquire.min.js"
  data-endpoint="/pagesquire/chat"
  data-content-root="main"
  data-pages="/,/about,/pricing"
  data-title="Site assistant"
  defer
></script>
```

| Attribute                            | Meaning                                                                                                                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-endpoint`                      | Required. Same-origin chat route.                                                                                                                                                                                            |
| `data-csrf-token` / `data-csrf-meta` | The session-bound CSRF token, or the name of the `<meta>` tag that holds it (default `csrf-token`, which matches Laravel).                                                                                                   |
| `data-content-root`                  | CSS selector of the public content the assistant may read (default `main`). It must match exactly one element.                                                                                                               |
| `data-pages`                         | Comma-separated same-origin paths where the assistant may work and navigate (default: the current page only).                                                                                                                |
| `data-title`                         | Assistant name.                                                                                                                                                                                                              |
| `data-container`                     | CSS selector for the widget host. By default a new element is appended to `<body>`.                                                                                                                                          |
| `data-styles="none"`                 | Skips the injected `<style>`. Use this under a CSP without `'unsafe-inline'` styles, and link `pagesquire.css` instead.                                                                                                      |
| `data-generic="true"`                | Also offers the generic `ui.*` tools (click, type, select, check, keys, find, wait) in guarded mode. See [generic actions](../../docs/generic-actions.md).                                                                   |
| `data-companion="true"`              | With `data-generic`, clicks, typing and keys use real input through the [companion extension](../../docs/companion-extension.md) when the visitor installed and allowed it. Development build: local and `.test` sites only. |
| `data-actable`                       | CSS selector of the region generic tools may operate in (default: `data-content-root`).                                                                                                                                      |
| `data-locale`                        | `"en"`, `"id"` or `"auto"` (default: follows `<html lang>`) for built-in UI text. See [languages](../../docs/i18n.md).                                                                                                       |
| `data-trace`                         | `"true"` records a local, redacted trace and shows its viewer; `"content"` also keeps text and evidence (development only). See [traces](../../docs/trace-and-eval.md).                                                      |
| `data-webmcp="true"`                 | Also registers the catalog as [WebMCP](../../docs/webmcp-and-approval.md) tools when the browser supports them.                                                                                                              |

Configuration is read only from the script element's attributes. Nothing is read from page content. After boot, `window.PageSquire` holds `{runtime, client, observer, webmcp}`.

## 3. Connect a backend

The bundle never holds provider keys. Point `data-endpoint` at any PageSquire backend that loads `dist/manifest.json` as its catalog:

- [Node / Next.js](../../docs/node-next.md): `npm install @pagesquire/server@beta`, then `new ConversationEngine({ manifest, provider })` with `createChatHandler`.
- [Standalone PHP](../../docs/standalone-php.md): `composer require pagesquire/server:^0.1@beta`, then put the manifest in the engine.
- [Laravel](../../docs/laravel-react.md): `composer require pagesquire/server:^0.1@beta pagesquire/laravel:^0.1@beta`, then set the `pagesquire.manifest` config.

Allow the four capability IDs in the host's authorization (for example `capabilityIds` in Node, or the Laravel gates). The usual server rules still apply: exact Origin, a CSRF token bound to the session, private storage and budgets.

The bundle is about 210 KB minified, because it includes the validators compiled at build time. No `eval` is used, so it runs under `script-src 'self'`.
