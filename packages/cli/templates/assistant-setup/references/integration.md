# PageSquire onboarding contract

The CLI scans without an AI and never imports application modules. You provide the site-specific meaning and implementation; code is not model training. Use the host's existing framework conventions and reviewed PageSquire runtime/provider adapters.

## Files

The default config points to `pagesquire/capabilities.json`, `pagesquire/bindings.json`, and `pagesquire/generated/`. Paths are project-relative; read the actual config before editing. Do not follow symlinks outside the project or bypass CLI path restrictions.

The manifest uses `schemaVersion: "0.1"` and a `capabilities` array. Each entry has stable dotted `id`, English `description`, `execution: "browser"`, a handler ID, closed object `inputSchema`, `risk`, and `verification: { "handler": "..." }`. Supported alpha risks are read_only and reversible; consequential actions cannot be enabled. Use self-contained synchronous JSON Schemas without references. Every supported property needs real validation; do not set additionalProperties to true.

The inventory uses this shape:

```json
{
  "schemaVersion": "0.1",
  "handlers": {
    "site.setHeadingColor": {
      "module": "pagesquire/adapter.mjs",
      "export": "setHeadingColor"
    }
  },
  "verifiers": {
    "site.verifyHeadingColor": {
      "module": "pagesquire/adapter.mjs",
      "export": "verifyHeadingColor"
    }
  }
}
```

Modules must directly export named functions or named arrow/function-expression constants. Re-exports, imported aliases and default exports are not statically resolved by this alpha validator. JavaScript/TypeScript modules are allowed; a host bundler is needed for TypeScript. Never add top-level side effects just to satisfy validation.

Handlers receive `(parameters, context)`, with document, observer, signal, call, navigation and waitFor. Verify cancellation after awaits and before changes. Verifiers receive the same arguments and return `{ verified: boolean, evidence?: object }` based on actual host state, not a constant true. Use the real state/control API; verify the changed heading and unchanged body text separately where needed.

`validate --compile` writes `parameters.js` and `bindings.mjs` under the configured generated directory. Import their `parameters`, `handlers`, and `verifiers` exports to construct `CapabilityRegistry(manifest, { handlers, verifiers, parameters })`. The generated loader references your modules but the CLI does not execute them. Review generated code and run browser postcondition tests. A passing static report always says runtimeVerified=false.

## Server and framework boundaries

Keep keys/model/provider endpoints on the backend. Laravel gates deny by default and must use the site's actual authorization. The browser's capability IDs only narrow the server-owned catalog; browser results are not permission to mutate server business data. Use CSRF, throttling, durable state, expiry and budget controls.

Use the host's generated/named route URL, not an invented endpoint. F4 provides a standalone PHP endpoint/native provider, a Node Web Request backend and injected Next.js App Router navigation alongside Laravel/Inertia. Read the chosen adapter's integration guide; never import @pagesquire/server into browser/Client Components. Authorize using the host's actual session/principal and explicit public Origin plus CSRF. Single-host file stores require private persistent storage; serverless/multi-host hosts need shared atomic durable storage. Do not substitute a module-level Map as production state or rate limiting.

Mount React widgets in a stable/persistent layout. Next.js requires an explicit committed-ready notification from the destination, not merely router.push or a loading/pathname event, followed by the capability verifier. Opt-in full-document continuation uses ChatNavigationStore and client.resumeNavigation() once after destination bootstrap; do not consume the runtime checkpoint separately. It persists IDs/URL only, not transcripts, for 60 seconds. General reload restoration remains unsupported. WordPress has a separate PageSquire plugin dashboard and exported setup skill for its reviewed built-in adapters; do not substitute this generic CLI/source integration for that workflow. Custom builders/plugins and uninspected states are not certified. Do not claim compatibility without a corresponding host/browser test.

Each final response includes idle/happy/sad/thinking/confused/hover emotion metadata. Keep loading thinking. Forward the callback only to a host-owned, licensed avatar mapping; no particular .riv file or state-machine input is assumed.
