'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  BrowserRuntime,
  CapabilityRegistry,
  PageObserver,
} from '@pagesquire/core';
import {
  AssistantClient,
  createHttpTransport,
  mountWidget,
} from '@pagesquire/client';
import { createNextNavigation } from '@pagesquire/react/next';
import { manifest } from '../../../tests/fixtures/capabilities.mjs';
import { parameters } from '../../../tests/fixtures/dist/bindings.js';

// Share one cookie-establishing request across Strict Mode's development effect replay.
let sessionBootstrap;
function bootstrapSession() {
  sessionBootstrap ??= fetch('/api/session', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok)
        throw new Error('The local fixture session is unavailable.');
      return response.json();
    })
    .catch((error) => {
      sessionBootstrap = undefined;
      throw error;
    });
  return sessionBootstrap;
}

export default function Assistant() {
  const container = useRef(null);
  const router = useRouter();
  useEffect(() => {
    let disposed = false;
    let dispose;
    async function mount() {
      const { csrfToken } = await bootstrapSession();
      if (disposed) return;
      const navigation = createNextNavigation(router, { document });
      const local = {
        ...manifest,
        capabilities: manifest.capabilities.filter((entry) =>
          ['browser.navigate', 'accessibility.set_heading_color'].includes(
            entry.id,
          ),
        ),
      };
      const handlers = {
        'browser.navigate': (args, context) => context.navigate(args.url),
        'accessibility.set_heading_color': (args) => {
          document.querySelectorAll('main h1, main h2').forEach((heading) => {
            heading.style.color = args.color;
          });
        },
      };
      const verifiers = {
        'browser.verifyNavigation': (args) => ({
          verified:
            location.href === new URL(args.url, location.href).href &&
            Boolean(document.querySelector('[data-destination="ready"]')),
        }),
        'accessibility.set_heading_color.verify': () => ({
          verified:
            getComputedStyle(document.querySelector('main h1')).color ===
            'rgb(255, 0, 0)',
        }),
      };
      const runtime = new BrowserRuntime({
        observer: new PageObserver({
          document,
          allowUrl: (url) => ['/', '/destination'].includes(url.pathname),
        }),
        registry: new CapabilityRegistry(local, {
          handlers,
          verifiers,
          parameters,
        }),
        navigation,
        timeoutMs: 15000,
      });
      const client = new AssistantClient({
        runtime,
        transport: createHttpTransport({
          endpoint: '/api/chat',
          baseUrl: location.href,
          csrfToken: () => csrfToken,
        }),
      });
      dispose = mountWidget(container.current, client);
      window.nextDemo = { runtime, navigation, client };
    }
    void mount();
    return () => {
      disposed = true;
      dispose?.();
      delete window.nextDemo;
    };
  }, [router]);
  return <div ref={container} data-pagesquire-root="" />;
}
