# @pagesquire/react

F4 also exports `createNextNavigation` from `@pagesquire/react/next`. Inject the real App Router and attached document inside the host's browser-only effect. The destination must call `navigation.committed(location.href)` from its actual ready client effect, not a loading fallback. Push invocation alone is not success; the registered verifier still checks actual state. Keep the widget in a persistent layout. See [Node/Next.js integration](../../docs/node-next.md) for server/auth/storage boundaries and the tested fixture.

Thin React 19 wrapper around the same PageSquire widget. The host owns a stable `AssistantClient`, CSS import, registry, permissions, and backend URL.

```tsx
import { PageSquireWidget } from '@pagesquire/react';
import '@pagesquire/client/widget.css';

<PageSquireWidget client={client} title="Page assistant" />;
```

Mount in a persistent layout. Effects remove listeners/widget DOM and cancel work on unmount or client replacement. Creating a new client inside every render will reset that lifecycle. Module imports are SSR-safe; create DOM-dependent runtimes only after mounting.

## Inertia v3

```ts
import { router } from '@inertiajs/react';
import { createInertiaNavigation } from '@pagesquire/react/inertia';

const navigation = createInertiaNavigation(router);
// Pass navigation into new BrowserRuntime({ observer, registry, navigation }).
```

The router is injected; core does not import Inertia. Only GET visits are supported. The adapter resolves on successful visits and uses only its own cancel token. Errors, cancellation, and finishes without success reject. Register the standard `browser.navigate` capability, a destination verifier, and an explicit URL allowlist in the site adapter. Keep the widget in an Inertia persistent layout so the same conversation survives a visit.

For a strict CSP, disable optional Inertia progress CSS with `progress: false` in the host's `createInertiaApp`, or configure its nonce support. PageSquire does not relax the host policy; its widget stylesheet is external.

The local fixture runs React Strict Mode and the real Inertia v3 router. It verifies SPA navigation and a subsequent accessibility conversation. This does not establish compatibility with every custom host form, layout, or error handler. See the [host integration guide](../../docs/laravel-react.md).
