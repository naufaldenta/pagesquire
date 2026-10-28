import {
  AssistantClient,
  ChatNavigationStore,
  createHttpTransport,
  mountWidget,
} from '@pagesquire/client';
import { createRuntime } from './adapters.mjs';
import { api, readText, route } from './api.mjs';

async function boot() {
  const element = document.querySelector('#pagesquire-site-config');
  const container = document.querySelector('#pagesquire-widget');
  if (!element || !container || window.pagesquireWordPress) return;
  const config = JSON.parse(element.textContent);
  document
    .querySelector('#wpadminbar')
    ?.setAttribute('data-pagesquire-private', '');
  let csrfToken;
  const adapter = createRuntime(config, document, {
    runAbility: async (name, input, signal) => {
      if (!csrfToken) throw Error('The assistant session is not ready.');
      const headers = {
        'Content-Type': 'application/json',
        'X-CSRF-TOKEN': csrfToken,
      };
      if (config.nonce) headers['X-WP-Nonce'] = config.nonce;
      const response = await fetch(route(config, 'ability'), {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        signal,
        headers,
        body: JSON.stringify({ name, input }),
      });
      if (!response.ok) throw Error('The ability could not run.');
      return JSON.parse(await readText(response, 32768)).output;
    },
  });
  const { runtime, observer } = adapter;
  window.pagesquireWordPress = { runtime, observer, config };
  if (config.inspect) {
    const panel = document.createElement('section');
    panel.className = 'pagesquire-inspector';
    panel.setAttribute('aria-label', 'PageSquire inspection');
    const heading = document.createElement('h2');
    heading.textContent = 'PageSquire inspection';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const summary = document.createElement('p');
    summary.textContent =
      'Only structural counts and adapter results are uploaded. Review this visible state before approving it.';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Run adapter checks';
    panel.append(heading, summary, status, button);
    container.append(panel);
    const verified = new Set();
    const collect = () => {
      const roots = [
        ...document.querySelectorAll(config.mapping.contentRoot),
      ].filter(
        (element) =>
          observer.isVisible(element) && !observer.isExcluded(element),
      );
      let headingCount = 0;
      let linkCount = 0;
      let controlCount = 0;
      if (roots.length === 1)
        for (const element of roots[0].querySelectorAll(
          'h1,h2,h3,h4,h5,h6,a[href],button,input,select,textarea',
        )) {
          if (!observer.isVisible(element) || observer.isExcluded(element))
            continue;
          if (/^H[1-6]$/.test(element.tagName)) headingCount++;
          else if (element.matches('a[href]')) linkCount++;
          else controlCount++;
        }
      const counts = [roots.length, headingCount, linkCount, controlCount];
      return {
        schemaVersion: '0.1',
        pageId: config.pageId,
        fingerprint: config.fingerprint,
        rootCount: Math.min(roots.length, 1000),
        headingCount: Math.min(headingCount, 1000),
        linkCount: Math.min(linkCount, 1000),
        controlCount: Math.min(controlCount, 1000),
        truncated: counts.some((count) => count > 1000),
        verifiedCapabilityIds: [...verified],
      };
    };
    const save = async () => {
      const report = collect();
      await api(config, 'observations', { method: 'POST', body: report });
      status.textContent = `Roots: ${report.rootCount}; headings: ${report.headingCount}; links: ${report.linkCount}; verified: ${report.verifiedCapabilityIds.length}.`;
      return report;
    };
    const resumed = await runtime.resumeNavigation();
    if (
      resumed?.status === 'success' &&
      resumed.capabilityId === 'browser.navigate'
    )
      verified.add('browser.navigate');
    await save();
    button.addEventListener('click', async () => {
      button.disabled = true;
      const originals = [
        ...document.querySelectorAll(
          `${config.mapping.contentRoot},${config.mapping.contentRoot} h1,${config.mapping.contentRoot} h2,${config.mapping.contentRoot} h3,${config.mapping.contentRoot} h4,${config.mapping.contentRoot} h5,${config.mapping.contentRoot} h6,${config.mapping.contentRoot} a[href]`,
        ),
      ].map((element) => [
        element,
        element.getAttribute('style'),
        element.classList.contains('pagesquire-link-highlight'),
      ]);
      try {
        for (const [id, parameters] of [
          ['accessibility.set_heading_color', { color: '#ff0000' }],
          ['accessibility.set_link_highlight', { enabled: true }],
          ['accessibility.set_font_weight', { weight: 700 }],
          ['page.read', { scope: 'content', mode: 'summary', offset: 0 }],
          ['page.scroll_to', { scope: 'content', position: 'start' }],
          ['page.highlight', { scope: 'content' }],
        ]) {
          if (!config.mapping.capabilityIds.includes(id)) continue;
          const result = await runtime.execute({
            protocolVersion: '0.1',
            callId: crypto.randomUUID(),
            capabilityId: id,
            snapshotId: runtime.observe().id,
            parameters,
          });
          if (result.status === 'success') verified.add(id);
          else verified.delete(id);
        }
        await save();
      } catch {
        status.textContent =
          'The configured content root is missing or ambiguous. Review the mapping.';
      } finally {
        for (const [element, style, highlighted] of originals) {
          if (style === null) element.removeAttribute('style');
          else element.setAttribute('style', style);
          element.classList.toggle('pagesquire-link-highlight', highlighted);
        }
        button.disabled = false;
      }
    });
    if (config.mapping.capabilityIds.includes('browser.navigate'))
      for (const page of config.pages.filter(
        (page) => page.id !== config.pageId,
      )) {
        const navigate = document.createElement('button');
        navigate.type = 'button';
        navigate.textContent = `Verify navigation to ${page.title}`;
        navigate.addEventListener('click', async () => {
          const destination = new URL(page.url);
          destination.searchParams.set('pagesquire_inspect', '1');
          const result = await runtime.execute({
            protocolVersion: '0.1',
            callId: crypto.randomUUID(),
            capabilityId: 'browser.navigate',
            snapshotId: runtime.observe().id,
            parameters: { url: destination.href },
          });
          if (result.code !== 'NAVIGATION_PENDING')
            status.textContent =
              'Navigation could not be started. Check the approved page scope.';
        });
        panel.append(navigate);
      }
    return;
  }
  ({ csrfToken } = await api(config, 'session', {
    method: 'POST',
    body: {},
  }));
  const transport = createHttpTransport({
    locale: config.locale ?? 'auto',
    endpoint: route(config, 'chat'),
    baseUrl: location.href,
    csrfToken: () => csrfToken,
    fetch: (input, init) => {
      const headers = new Headers(init.headers);
      if (config.nonce) headers.set('X-WP-Nonce', config.nonce);
      return fetch(input, { ...init, headers });
    },
  });
  let navigationStore;
  try {
    navigationStore = new ChatNavigationStore(
      sessionStorage,
      'pagesquire:wp-chat:0.1',
    );
  } catch {}
  const client = new AssistantClient({
    runtime,
    transport,
    locale: config.locale ?? 'auto',
    ...(navigationStore ? { navigationStore } : {}),
    onEmotionChange: (emotion) =>
      window.dispatchEvent(
        new CustomEvent('pagesquire:emotion', { detail: emotion }),
      ),
  });
  mountWidget(container, client, {
    title: config.assistantName,
    locale: config.locale ?? 'auto',
  });
  window.pagesquireWordPress.client = client;
  window.addEventListener(
    'pagehide',
    () => {
      client.cancel();
      runtime.cancel();
      adapter.driver.dispose();
    },
    { once: true },
  );
  await client.resumeNavigation();
}
void boot().catch(() => {
  const container = document.querySelector('#pagesquire-widget');
  if (container)
    container.textContent =
      'PageSquire is unavailable. Review the site configuration or reload the page.';
});
