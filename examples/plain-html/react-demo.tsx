import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import type { Root } from 'react-dom/client';
import { createInertiaApp, router } from '@inertiajs/react';
import { PageSquireWidget } from '@pagesquire/react';
import { createInertiaNavigation } from '@pagesquire/react/inertia';
import { AssistantClient, createHttpTransport } from '@pagesquire/client';
import { BrowserRuntime } from '@pagesquire/core';
import type { CapabilityRegistry, PageObserver } from '@pagesquire/core';

const fixture = window as unknown as {
  pagesquireChat: { client: AssistantClient; dispose: () => void };
  pagesquireDemo: { observer: PageObserver; registry: CapabilityRegistry };
};
type InertiaSetup = Parameters<
  NonNullable<NonNullable<Parameters<typeof createInertiaApp>[0]>['setup']>
>[0];
fixture.pagesquireChat.dispose();
const runtime = new BrowserRuntime({
  observer: fixture.pagesquireDemo.observer,
  registry: fixture.pagesquireDemo.registry,
  navigation: createInertiaNavigation(router),
});
const client = new AssistantClient({
  runtime,
  transport: createHttpTransport({
    endpoint: document.querySelector<HTMLMetaElement>(
      'meta[name="pagesquire-endpoint"]',
    )!.content,
    baseUrl: location.href,
    csrfToken: () =>
      document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')!
        .content,
  }),
});
fixture.pagesquireChat.client = client;
let root: Root;
function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageSquireWidget client={client} title="PageSquire · React demo" />
      {children}
    </>
  );
}
await createInertiaApp({
  id: 'chat-widget',
  progress: false,
  page: {
    component: 'Home',
    props: { errors: {} },
    url: location.pathname,
    version: null,
    clearHistory: false,
    encryptHistory: false,
  },
  resolve: (name: string) => {
    function Page() {
      return createPortal(
        <p id="inertia-destination">
          {name === 'Next' ? 'Inertia destination ready' : 'Inertia home ready'}
        </p>,
        document.querySelector('#inertia-content')!,
      );
    }
    Page.layout = (page: ReactNode) => <Layout>{page}</Layout>;
    return Page;
  },
  setup: ({ el, App, props }: InertiaSetup) => {
    if (!el) throw new Error('The browser fixture requires its mount element.');
    root = createRoot(el);
    root.render(
      <StrictMode>
        <App {...props} />
      </StrictMode>,
    );
  },
});
Object.assign(window, {
  inertiaRuntime: runtime,
  unmountPageSquireReact: () => root.unmount(),
});
