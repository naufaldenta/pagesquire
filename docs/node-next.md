# Node and Next.js integration

PageSquire ships a Node.js 24 backend (`@pagesquire/server`) and a Next.js 16.4.2 App Router fixture. You do not train a model for each website. Use the [onboarding CLI](onboarding.md) to map the site's real controls, write verified capabilities and connect a catalog that the server owns.

These browser features work the same way in Next.js:

- [Action progress](action-progress.md). The shared widget and React wrapper show it. A custom Next.js UI must render `state.actionProgress` itself. Do not present a path change as verified navigation, and do not show model reasoning.
- [AppContext](app-context.md). Optional public state and feature availability from the runtime. It is not server identity or permission. Deploy matching schemas first, and read current host state rather than a stale React closure.
- [Assistant driving](assistant-driving.md). Animated cursor, preparing host controls, scoped reading, tours and local speech. Wait until the destination is committed and ready before reading or summarizing; a path change is not enough. Keep the server catalog and permission checks identical to the browser definitions.

## Install

The packages are on npm. PageSquire is in beta, so ask for the `beta` tag, and keep every PageSquire package on the same version:

```sh
npm install @pagesquire/server@beta
npm install @pagesquire/protocol@beta @pagesquire/core@beta @pagesquire/client@beta @pagesquire/react@beta
```

The first line is the Node.js 24 backend. The second is the browser side; leave out `@pagesquire/react` if your frontend does not use React. In a Next.js app, install both into the same project.

## Node backend

Set `PAGESQUIRE_PROVIDER`, `PAGESQUIRE_API_KEY` and `PAGESQUIRE_MODEL` on the server. Custom or regional gateways also need `PAGESQUIRE_PROVIDER_URL`. See [providers](providers.md); presets do not choose a model for you. A React or browser-only app still needs a backend to keep the key private.

Keep the `@pagesquire/server` import out of client bundles. Your app must provide a real session and auth service and a private, persistent storage directory. `hostAuth` and `manifest` below are your own code, not part of PageSquire:

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

Set `origin` to the exact **public** origin. Internal URLs behind a proxy do not count. The browser transport sends a session-bound `X-CSRF-TOKEN`, and requests without a matching Origin or CSRF token are rejected. Keep provider settings on the server, validate the environment at startup and never print secrets. Never return the transcript, conversation state or provider settings to the browser.

Your app is responsible for:

- session creation, cookies and login
- which capabilities each user may use
- reverse-proxy trust
- quotas per principal, per IP and globally
- retention and monitoring

Connect your HTTP server to Web Request/Response with whatever your stack supports, and apply body and connection limits before buffering. The [Node fixture](../examples/node-chat/server.mjs) shows native HTTP streaming, but its sessions live in memory and only work on localhost. Do not deploy it.

## Next.js server

An App Router `app/api/assistant/route.ts` can export the handler above with `export const runtime = 'nodejs'`. The Edge runtime is not supported. Your app's existing authentication and CSRF handling are required. The handler uses Web Request/Response, so the NextRequest cookie helpers are optional. See the [Route Handler reference](https://nextjs.org/docs/app/api-reference/file-conventions/route).

`FileConversationStore` needs **one persistent host**. On Vercel, serverless or several instances, pass in a shared `ConversationStore` with durable transactions and serialization. A module-level `Map` is neither persistence nor a global rate limit; the fixture uses one only to set up fake local sessions.

`createChatHandler` has these limits built in:

- A per-minute request bucket for each session.
- An hourly provider budget for each session (`attemptsPerHour`, default 60, maximum 1000) that counts across conversations. When it runs out, the handler returns 429 `BUDGET_EXHAUSTED`. This is not a global or per-IP quota.

When the client asks for it, the handler also streams fixed progress stages as NDJSON; see [streaming](streaming.md).

For a full Vercel example with frontend and API in one project, see [OFFBEAT](../examples/brutalist-demo/README.md). It stores conversations in a private Supabase PostgreSQL database with committed checkpoints, fenced leases and atomic usage limits, and has its own access-code sessions and CSRF and origin checks. Its policies and thirteen capabilities are specific to OFFBEAT. Adapt authorization, privacy, quotas and database privileges to your own site.

## Next.js browser

Keep the widget and runtime in a persistent Client Component or layout. In its browser-only effect, pass in the App Router instance:

```ts
import { createNextNavigation } from '@pagesquire/react/next';
const navigation = createNextNavigation(router, { document });
// Pass navigation into BrowserRuntime({ observer, registry, navigation }).
// When the requested destination's actual DOM/state is ready:
navigation.committed(location.href);
```

Call `navigation.committed()` from the destination's committed, ready client effect, **not** from a loading fallback or a pathname watcher. For streamed or deferred pages, call it once the state the capability verifier needs is available. Share the adapter through the site's persistent context.

- `push()` alone does not count as arrival. After `committed()`, the registered postcondition verifier runs and a fresh snapshot is returned.
- A redirect to an unexpected destination fails. A destination that never becomes ready times out.
- Cancelling stops the wait, but not a route transition that has already started.
- Restrict URLs with the observer's same-origin allowlist, and do not expose GET routes that change data.

The adapter has no Next.js runtime dependency and does not touch the document during SSR. It is tested with the App Router only; the Pages Router and custom routers are not tested. See the [useRouter reference](https://nextjs.org/docs/app/api-reference/functions/use-router).

Reuse the host's authenticated session, and make bootstrap effects safe when React Strict Mode runs them twice. The fixture sends one cookie-setting request per document, because two racing session requests can pair one response's CSRF token with the other response's cookie. That is a trick for the fixture, not a replacement for real session management.

## Erasing a transcript

To erase a transcript from trusted server code without resetting request or provider budgets, call `forgetConversation(store, sessionKey, principal)`; see the [operations runbook](operations.md). It is not an assistant capability or a public endpoint. It does not revoke host sessions or delete data held by the provider or in backups.

## Running the fixtures

After `npm ci`, `composer install` and `npm run build` in the repository root:

```sh
node examples/node-chat/server.mjs
# In a separate terminal, for the Next.js fixture:
npm --prefix examples/nextjs run dev
```

Open the addresses the dev servers print and try `Navigate then make headings red`. The Next.js browser test checks streamed destination readiness, the persistent widget, a fresh destination snapshot, the heading-only action and the final emotion. The Node and PHP full-document tests check that continuing after navigation does not replay it. The fixture providers are scripted, not live models. The Next.js dev fixture does not run under the strict CSP that the plain-HTML fixture uses.
