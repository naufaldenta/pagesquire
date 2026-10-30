# @pagesquire/react

A thin React 19 wrapper around the PageSquire widget. The host owns a stable `AssistantClient`, the CSS import, the registry, permissions and the backend URL.

## Install

```sh
npm install @pagesquire/protocol@beta @pagesquire/core@beta @pagesquire/client@beta @pagesquire/react@beta
```

PageSquire is in beta, so ask for the `beta` tag. Install every PageSquire package at the same version; they depend on each other exactly. React 19 is a peer dependency. For Inertia or Next.js, use the router your app already has.

```tsx
import { PageSquireWidget } from '@pagesquire/react';
import '@pagesquire/client/widget.css';

<PageSquireWidget client={client} title="Page assistant" />;
```

Mount it in a persistent layout. On unmount, or when the client changes, its effects remove listeners and widget DOM and cancel work. Creating a new client on every render therefore resets everything. Imports are SSR-safe; create runtimes that need the DOM only after mounting.

## Inertia v3

```ts
import { router } from '@inertiajs/react';
import { createInertiaNavigation } from '@pagesquire/react/inertia';

const navigation = createInertiaNavigation(router);
// Pass navigation into new BrowserRuntime({ observer, registry, navigation }).
```

You pass the router in; core never imports Inertia. Only GET visits are supported. The adapter resolves when a visit succeeds and cancels only through its own cancel token. Errors, cancellations and visits that finish without success reject.

Register the standard `browser.navigate` capability, a destination verifier and an explicit URL allowlist in your site adapter. Keep the widget in an Inertia persistent layout so the conversation survives the visit.

Under a strict CSP, turn off Inertia's progress CSS with `progress: false` in `createInertiaApp`, or set up its nonce support. PageSquire doesn't relax your CSP, and its own widget stylesheet is an external file.

The local fixture runs React Strict Mode with the real Inertia v3 router and checks SPA navigation followed by an accessibility conversation. Your own forms, layouts or error handlers may still behave differently. See the [host integration guide](https://github.com/naufaldenta/pagesquire/blob/main/docs/laravel-react.md).

## Next.js App Router

`createNextNavigation` is exported from `@pagesquire/react/next`. Pass it the real App Router and the attached document inside the host's browser-only effect.

The destination page must call `navigation.committed(location.href)` from its real ready effect, not from a loading fallback. Calling `push` doesn't count as success: the registered verifier still checks the actual state. Keep the widget in a persistent layout.

See [Node/Next.js integration](https://github.com/naufaldenta/pagesquire/blob/main/docs/node-next.md) for server, auth and storage details and the tested fixture.
