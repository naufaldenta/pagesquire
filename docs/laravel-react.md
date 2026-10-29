# Laravel 13, React 19 and Inertia v3

This guide connects your site's existing features to PageSquire in a Laravel app with an Inertia React frontend. It does not train a model or scan your source code; for scanning and mapping, see [onboarding](onboarding.md).

These browser features plug into the same setup:

- [Action progress](action-progress.md). The shared widget and React wrapper show it from real runtime events. A custom Inertia UI can render `state.actionProgress` with `describeActionProgress` in its persistent layout. Rebuild the assets; no backend route, provider or database change is needed.
- [AppContext](app-context.md). Opt in from the host runtime to share public state and current feature availability. Read fresh public values, not the whole store. Deploy matching PHP, protocol and browser builds first. The FormRequest keeps the optional field, and raw protocol validation and Gates still apply.
- [Assistant driving](assistant-driving.md). Cursor and click feedback, reading and summaries, host controls, tours and optional speech. Mount the helpers in the persistent layout next to the runtime, keep the Inertia navigation adapter, and dispose them on teardown.

## 1. Install the packages

The packages are not on Packagist or npm yet. Use Composer path repositories for `packages/php` and `packages/laravel`, each with an explicit version (`"options": { "versions": { "pagesquire/server": "0.1.0-beta.0" } }`, and the same for `pagesquire/laravel`), because the Laravel package requires that exact server version. Use npm workspaces or local tarballs for `protocol`, `core`, `client` and `react`. Build PageSquire first so that the JavaScript validators and PHP schemas exist. The [Laravel package guide](../packages/laravel/README.md) covers server configuration and test commands.

## 2. Register a site adapter

Create a trusted capability manifest plus browser handlers, verifiers and compiled parameter bindings, following [the runtime guide](runtime.md). Generate IDs and schemas for the browser and the server from one source so they stay in sync. Include only features the site really supports. In practice:

- Keep heading color separate from body text color.
- Use desired-state controls for link highlighting and font weight, not toggles.
- After using a native control, check the application's actual state.

Write a helper of your own, for example `createSiteRuntime(document, navigation)`, that returns your configured `BrowserRuntime`. PageSquire cannot guess your selectors, business permissions or hidden workflows. Route and element allowlists are required; do not allow every element the observer finds.

## 3. Configure the server

Set `PAGESQUIRE_ENABLED=true` and the server-only `PAGESQUIRE_PROVIDER`, `PAGESQUIRE_MODEL` and `PAGESQUIRE_API_KEY`. Hosted presets know their endpoint. Custom or regional gateways also need the full HTTPS `PAGESQUIRE_PROVIDER_URL`. The older names `PAGESQUIRE_PROVIDER_ENDPOINT`, `PAGESQUIRE_PROVIDER_MODEL` and `PAGESQUIRE_PROVIDER_KEY` still work.

Merge new entries into your published config, and refresh the config cache when you change production settings. See [providers](providers.md) for JSON or prompt mode, the token field and other compatibility settings. No model is hardcoded. A provider with a different API protocol needs its own `Provider` binding.

Publish `pagesquire-config`, set a trusted manifest, and use server-side sessions and a durable cache with atomic locks. Then define the `pagesquire.use` and `pagesquire.capability` gates. Both deny by default and are checked on every request. Never define a gate that allows everything for a manifest you have not reviewed. Test switching between logged-in and guest users, and your production proxy and rate-limit settings.

## 4. Generate the named frontend route

The backend POST route is named `pagesquire.chat`. Enable the package before generating routes:

```sh
php artisan vendor:publish --tag=pagesquire-config --no-interaction
php artisan wayfinder:generate --no-interaction
```

Use the Wayfinder import instead of a hardcoded API URL. The widget uses plain `fetch`, not an Inertia visit, so it sends the CSRF token itself. Expose the token with the usual server-rendered `csrf-token` meta tag, never through a prompt.

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

The two `@/` imports are files your app generates or owns; they are not part of this repository. Put the component in your persistent Inertia layout so that a pending SPA visit does not unmount the assistant. Do not recreate the registry or client on every render. The module imports are safe during SSR; DOM access stays inside the effect.

## 6. Connect an optional avatar

Every final assistant message has an emotion. The client emits `thinking` while the provider or an action is working, then the response's emotion. The states are `idle`, `happy`, `sad`, `thinking`, `confused` and `hover`. Map them to the inputs or states in your `.riv` file, and fall back to idle for anything your file does not support. The asset, its input names and its license are yours. PageSquire provides the callback, not a Rive renderer.

## Limitations

- The backend keeps one conversation per session. Starting a chat in another tab replaces it, and the first tab then fails closed.
- Browser chat history lives in memory only.
- After a full-document navigation, verification resumes, but the chat does not continue automatically.
- Never use browser results to approve payments, deletions, publishing or other server-side changes.
- The tests use a fake provider. Accuracy with a live model, screen readers and use across several tabs have not been tested yet.
