# Node and Next.js integration

The shared widget/React wrapper includes [action progress](action-progress.md). Custom Next client UI must render `state.actionProgress` explicitly; do not label a path change as verified navigation or expose model reasoning. C4 changes browser assets/client state, not the Node endpoint, provider configuration or DB schema.

Optional [AppContext](app-context.md) shares declared public state/availability from the runtime. Do not use it as server identity/permission; deploy matching schemas first. Read current host state rather than a stale React closure. No provider/model-specific configuration is required.

Add [assistant driving](assistant-driving.md) inside the existing client runtime: optional animated cursor, host control preparation, scoped reading, tours and local-first speech. Preserve committed-destination readiness before reading or summarizing; a path change alone is insufficient. Keep server catalog/permission checks identical to the browser definitions.

F4 supplies a Node.js 24 backend and a Next.js 16.4.2 App Router fixture. No per-website model training is needed: use the hybrid CLI to map real controls, author verified capabilities and connect a server-owned catalog. All package identifiers remain unpublished local preview identifiers.

## Node backend

Choose `PAGESQUIRE_PROVIDER`, `PAGESQUIRE_API_KEY` and `PAGESQUIRE_MODEL` on the server; custom/regional gateways also require `PAGESQUIRE_PROVIDER_URL`. See [provider presets and compatibility tutorials](providers.md). Presets do not hardcode a model or certify every model. React/browser-only apps still need a backend to keep keys private.

Build PageSquire, install the local packages into your approved host workspace, and keep the server import out of client bundles. The host integration must provide a real session/auth service and a private persistent storage directory. The following `hostAuth` and `manifest` imports are site-owned examples, not bundled services:

```ts
import {
  ConversationEngine,
  FileConversationStore,
  OpenAiCompatibleProvider,
  providerConfigurationFromEnv,
  createChatHandler,
} from '@pagesquire/server';
import { hostAuth, manifest } from './site-owned-assistant-config.js';

const engine = new ConversationEngine({
  manifest,
  provider: new OpenAiCompatibleProvider(
    providerConfigurationFromEnv(process.env),
  ),
});
export const POST = createChatHandler({
  engine,
  origin: 'https://your-reviewed-host.example',
  store: new FileConversationStore('/private/persistent/pagesquire'),
  authorize: async (request) => {
    const session = await hostAuth.authorizeAssistant(request);
    return session
      ? {
          key: session.opaqueSessionKey,
          principal: session.principalAndAuthorizationRevision,
          csrfToken: session.csrfToken,
          capabilityIds: session.allowedCapabilityIds,
        }
      : null;
  },
});
```

Configure the exact **public** origin; proxy-internal Request URLs do not define this security boundary. The browser transport sends a session-bound `X-CSRF-TOKEN`; missing Origin/CSRF is rejected. Keep provider settings server-only, validate environment configuration at startup and do not print secrets. The host owns session creation, cookies, login, capability permissions, reverse-proxy trust, per-principal/IP/global quotas, retention, and operational monitoring. Never return transcript/state/provider settings to the browser.

Use the host's supported bridge from its HTTP server to Web Request/Response. Apply ingress body/connection limits before buffering. The local [Node fixture](../examples/node-chat/server.mjs) demonstrates native HTTP streaming but has localhost-only, in-memory demo sessions and must not be deployed publicly.

## Next.js server

An App Router `app/api/assistant/route.ts` can export the handler above with `export const runtime = 'nodejs'`. Do not use the Edge runtime. Existing host authentication/CSRF infrastructure is required. The route uses Web Request/Response, so NextRequest-specific cookies are optional. See the official [Route Handler API](https://nextjs.org/docs/app/api-reference/file-conventions/route).

File storage requires **one persistent host**. Vercel/serverless/multi-instance deployments need an injected shared `ConversationStore` with durable transactions and serialization. `createChatHandler` also streams fixed progress stages as NDJSON when the client asks; see [streaming](streaming.md). A module-level Map is not production persistence or global rate limiting. `createChatHandler` keeps a per-session hourly provider budget (`attemptsPerHour`, default 60, maximum 1000) across conversations next to the per-minute request bucket; exhaustion returns 429 `BUDGET_EXHAUSTED`. It is not a global or per-IP quota. The real fixture uses a Map only for synthetic local session setup; it is not a reusable auth implementation.

For a concrete same-project Vercel frontend/API example, see [OFFBEAT](../examples/brutalist-demo/README.md). It supplies a private Supabase PostgreSQL store with committed checkpoints, fenced leases and atomic usage limits, plus its own access-code sessions and CSRF/origin checks. These example policies and thirteen capabilities are scoped to OFFBEAT; review and adapt authorization, privacy, quotas and database privileges for your own host.

## Next.js browser

Keep the widget/runtime in a persistent Client Component/layout. In its browser-only effect, inject the actual App Router instance:

```ts
import { createNextNavigation } from '@pagesquire/react/next';
const navigation = createNextNavigation(router, { document });
// Pass navigation into BrowserRuntime({ observer, registry, navigation }).
// When the requested destination's actual DOM/state is ready:
navigation.committed(location.href);
```

The destination must notify from its committed, ready client effect, **not** a loading fallback or merely a pathname watcher. For streamed/deferred pages, call only once the state needed by the capability verifier is available. Share the adapter through the site's existing persistent context. `push()` alone is not completion. The adapter then allows the normal registered postcondition verifier to run and a fresh snapshot to be returned. Redirects to an unexpected destination fail; missing readiness times out. Cancellation stops waiting, not an already-issued framework route transition. Restrict URLs through the observer's explicit same-origin allowlist and do not expose mutating GET routes.

The injected interface has no Next.js runtime dependency or SSR document access. The tested adapter targets App Router; Pages Router and custom routers are not certified. See [the official App Router navigation reference](https://nextjs.org/docs/app/api-reference/functions/use-router).

Reuse the host's established authenticated session and make bootstrap effects safe under React Strict Mode replay. The local fixture shares one cookie-establishing request per browser document: racing two initial session requests can otherwise pair one response's CSRF token with the other response's cookie. This fixture technique is not a replacement for host authentication or production session management.

## Local verification

For trusted server-only transcript erasure without resetting request/provider budgets, use `forgetConversation(store, sessionKey, principal)` as described in the [operations runbook](operations.md). It is not an assistant capability or a public endpoint and does not revoke host sessions or delete provider/backups.

After root `npm ci`, `composer install` and `npm run build`:

```sh
node examples/node-chat/server.mjs
# In a separate terminal, for the Next.js fixture:
npm --prefix examples/nextjs run dev
```

Use the local addresses printed by the development servers. Try `Navigate then make headings red`. The real Next.js browser test checks streamed destination readiness, persistent widget, fresh destination snapshot, heading-only action and final emotion. Node/PHP full-document tests verify continuation without replaying navigation. Fixture providers are deterministic, not live models. Next's development fixture does not claim the strict CSP certification of the plain-HTML runtime fixture.
