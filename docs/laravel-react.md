# Laravel 13 + React 19 + Inertia v3 alpha

This guide connects existing site capabilities; it does not train a model or scan source code. F3 will add onboarding automation. The JDIH pilot application, routes, credentials, and artwork are not part of this distribution and are not modified by this guide.

## 1. Install the local packages

The packages are unpublished. Use Composer path repositories for `packages/php` and `packages/laravel`, and npm workspace/local tarballs for `protocol`, `core`, `client`, and `react`. Build the PageSquire workspace first so both standalone JavaScript validators and PHP schemas exist. Consult the [Laravel package guide](../packages/laravel/README.md) for server configuration and test commands. Do not change an existing application's dependencies without its owner's approval.

## 2. Register a site adapter

Create a trusted capability manifest and browser handlers/verifiers/compiled parameter bindings following [the runtime guide](runtime.md). Keep IDs and schemas synchronized on browser and server from one source. Include only features actually supported by this site. Separate heading color from body text color; use desired-state link highlighting and font-weight controls rather than toggles. Verify actual application state after invoking native controls.

Create a host helper, for example `createSiteRuntime(document, navigation)`, returning your configured `BrowserRuntime`. This helper belongs to your site; PageSquire cannot infer your selectors, business permissions, or hidden workflows. Route and element allowlists are required. Do not turn every observed target into a permitted target.

## 3. Configure the server

Set `PAGESQUIRE_ENABLED=true` and server-only `PAGESQUIRE_PROVIDER`, `PAGESQUIRE_MODEL`, and `PAGESQUIRE_API_KEY`. Hosted presets choose the endpoint; custom/regional gateways also need the full HTTPS `PAGESQUIRE_PROVIDER_URL`. Legacy `PAGESQUIRE_PROVIDER_ENDPOINT`, `PAGESQUIRE_PROVIDER_MODEL`, and `PAGESQUIRE_PROVIDER_KEY` remain accepted. Review or merge the new published config entries, then refresh the host's config cache when changing production settings. See [provider presets and the Laravel tutorial](providers.md) for JSON/prompt mode, token-field and model compatibility controls. No model is hardcoded; a genuinely different API protocol still needs a custom `Provider` binding.

Publish `pagesquire-config`, set a trusted manifest, use server-side sessions and a durable cache with atomic locks, then define `pagesquire.use` and `pagesquire.capability` gates. Both deny by default. Permissions are reevaluated for every request. Never define a blanket allow gate for an unreviewed manifest. Test auth/guest transitions and production proxy/rate-limit settings.

## 4. Generate the named frontend route

The backend POST route is named `pagesquire.chat`. Enable the package before generating routes:

```sh
php artisan vendor:publish --tag=pagesquire-config --no-interaction
php artisan wayfinder:generate --no-interaction
```

Use the host's Wayfinder import instead of a hardcoded API URL. The standalone widget uses ordinary fetch, not an Inertia page visit; it therefore supplies the host CSRF token explicitly. Expose it with the normal server-rendered `csrf-token` meta element, never through an AI prompt.

## 5. Mount in a persistent layout

```tsx
import { useEffect, useState } from 'react';
import { router } from '@inertiajs/react';
import { AssistantClient, createHttpTransport } from '@pagesquire/client';
import { PageSquireWidget } from '@pagesquire/react';
import { createInertiaNavigation } from '@pagesquire/react/inertia';
import { chat } from '@/routes/pagesquire';
import { createSiteRuntime } from '@/pagesquire/site-adapter';
import '@pagesquire/client/widget.css';

export function SiteAssistant() {
  const [client, setClient] = useState<AssistantClient | null>(null);
  useEffect(() => {
    const assistant = new AssistantClient({
      runtime: createSiteRuntime(document, createInertiaNavigation(router)),
      transport: createHttpTransport({
        endpoint: chat.url(),
        baseUrl: location.href,
        csrfToken: () =>
          document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')
            ?.content ?? '',
      }),
      onEmotionChange: (emotion) => {
        // Forward to your own licensed avatar/input mapping if installed.
        window.dispatchEvent(
          new CustomEvent('pagesquire:emotion', { detail: emotion }),
        );
      },
    });
    setClient(assistant);
    return () => assistant.cancel();
  }, []);
  return client ? <PageSquireWidget client={client} /> : null;
}
```

The two `@/` imports are host-generated/site-owned files, not exports from this repository. Wrap them in your persistent Inertia layout. A pending SPA visit must not unmount the assistant. Avoid re-creating the registry/client on every render. Module imports are SSR-safe; DOM access belongs in the effect.

## 6. Connect an optional avatar

Every final assistant message has an emotion. The client emits `thinking` throughout provider/action loading and then the response emotion. Supported states are `idle`, `happy`, `sad`, `thinking`, `confused`, and `hover`. Map these to the actual inputs/states in your `.riv` file, with an idle fallback for unsupported states. Asset input names and redistribution rights belong to the host. This alpha provides the callback, not a bundled Rive renderer.

## Verification and limitations

Locally verified: PHP engine/schema policy, Laravel gates/CSRF/rate limits/state binding, faked provider transport, heading-only color, links/font weight, safe widget rendering, cancellation, React Strict Mode, real Inertia v3 SPA navigation, and offline packed browser imports/types. No real provider request or JDIH deployment is included. Live-model accuracy, assistive-technology review, durable shared-cache deployment, multi-tab coordination, and production host integration remain release checks.

The backend keeps one conversation slot per session. A new chat can replace another tab's conversation; the other tab fails closed. Browser chat history is memory-only. Full-document navigation resumes core verification but not the chat automatically. Do not use browser telemetry to approve payments, deletions, publication, or other server mutations.
