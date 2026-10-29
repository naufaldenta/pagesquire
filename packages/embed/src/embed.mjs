import {
  BrowserDriver,
  BrowserRuntime,
  CapabilityRegistry,
  NavigationStore,
  composedClosest,
  createCompanionDriver,
  createGenericBindings,
  createLinkBindings,
  PageObserver,
  createPageBindings,
  exposeToWebMcp,
} from '@pagesquire/core';
import {
  AssistantClient,
  ChatNavigationStore,
  TraceRecorder,
  createApprovalPrompt,
  createVisitorPrompt,
  createHttpTransport,
  mountLinkArrival,
  mountTraceViewer,
  mountWidget,
} from '@pagesquire/client';
import styles from '../../client/src/widget.css';
import { manifest } from './capabilities.mjs';
import { parameters } from '../dist/generated/bindings.mjs';

/**
 * One-tag install. Configuration comes only from the script element's data
 * attributes, written by the site owner; nothing is read from the page body.
 *
 *   data-endpoint     same-origin chat route (required)
 *   data-csrf-token   CSRF token, or data-csrf-meta to read <meta name=…> (default csrf-token)
 *   data-content-root CSS selector of the public content (default main)
 *   data-pages        comma-separated same-origin paths the assistant may use and open (default: this page)
 *   data-title        assistant name
 *   data-container    CSS selector for the widget host (default: a new fixed element)
 *   data-styles       "none" to skip injected styles, e.g. under a strict CSP; link pagesquire.css instead
 *   data-webmcp       "true" to also register the capabilities as WebMCP tools
 *   data-generic      "true" to offer generic ui.* tools (click, type, select, ...)
 *   data-actable      CSS selector of the region generic tools may operate in (default: data-content-root)
 *   data-outline      "true" to start snapshot text with a heading and landmark outline
 *   data-frames       "true" to include the visible text of same-origin iframes (read-only)
 *   data-companion    "true" to let generic tools use real input through the PageSquire companion
 *                     extension when the visitor installed and allowed it, and read and act in the
 *                     cross-origin frames the site declares and other tabs of the session
 *                     (development build)
 *   data-screenshots  "true", with data-companion, to also offer ui.screenshot: redacted screenshots
 *                     the visitor allows in the extension; the server must forward images
 *                     (EngineOptions.screenshots) to a model that reads them
 *   data-link         "true" when the server runs PageSquire Link: the assistant may offer to continue
 *                     on an approved partner site (the visitor sees and approves what is shared), and a
 *                     visitor sent here by a partner sees a banner to continue their request
 *   data-locale       "en", "id" or "auto" (default: follows <html lang>) for built-in UI text
 *   data-trace        "true" to record a local trace and show its viewer; "content" also keeps message
 *                     text, parameters and evidence (development only)
 */
const script = document.currentScript;

function settings(element) {
  const data = element?.dataset ?? {};
  if (!data.endpoint)
    throw Error('Set data-endpoint to the PageSquire chat route.');
  const pages = (data.pages ?? location.pathname)
    .split(',')
    .map((page) => page.trim())
    .filter(Boolean);
  if (
    !pages.length ||
    pages.length > 50 ||
    pages.some((page) => !page.startsWith('/') || page.startsWith('//'))
  )
    throw Error('data-pages must list same-origin paths such as /about.');
  const meta = data.csrfMeta ?? 'csrf-token';
  return {
    endpoint: data.endpoint,
    csrfToken: () =>
      data.csrfToken ??
      [...document.querySelectorAll('meta[name]')].find(
        (element) => element.getAttribute('name') === meta,
      )?.content ??
      '',
    contentRoot: data.contentRoot ?? 'main',
    pages,
    title: data.title ?? 'PageSquire',
    container: data.container,
    styles: data.styles !== 'none',
    webmcp: data.webmcp === 'true',
    generic: data.generic === 'true',
    companion: data.companion === 'true',
    screenshots: data.companion === 'true' && data.screenshots === 'true',
    link: data.link === 'true',
    outline: data.outline === 'true',
    frames: data.frames === 'true',
    locale: ['en', 'id'].includes(data.locale) ? data.locale : 'auto',
    trace: data.trace === 'true' || data.trace === 'content' ? data.trace : '',
    actable: data.actable ?? data.contentRoot ?? 'main',
  };
}

async function boot() {
  const config = settings(script);
  if (config.styles) {
    const style = document.createElement('style');
    style.textContent = styles;
    document.head.append(style);
  }
  let host = config.container
    ? document.querySelector(config.container)
    : undefined;
  if (!host) {
    host = document.createElement('div');
    host.className = 'pagesquire-embed';
    document.body.append(host);
  }
  // The companion extension also reports granted cross-origin frames.
  const companion =
    config.generic && config.companion ? createCompanionDriver() : undefined;
  const observer = new PageObserver({
    document,
    outline: config.outline,
    frames: config.frames,
    ...(companion
      ? {
          remoteFrames: () => companion.frames(),
          remoteTabs: () => companion.tabs(),
        }
      : {}),
    allowUrl: (url) => config.pages.includes(url.pathname),
    // Generic tools may act only inside the owner's declared region.
    ...(config.generic
      ? {
          canInteract: (element) =>
            Boolean(composedClosest(element, config.actable)),
        }
      : {}),
  });
  const driver = new BrowserDriver({ observer });
  const root = () => observer.findUnique(config.contentRoot);
  const page = createPageBindings({ scopes: { content: root }, driver });
  const navigation = config.pages.length > 1;
  const generic = config.generic
    ? createGenericBindings(companion ? { driver: companion } : {})
    : undefined;
  // The client is created below; a handoff runs only after it exists.
  const link = config.link
    ? createLinkBindings({
        approve: (callId, signal) => client.approveHandoff(callId, signal),
      })
    : undefined;
  void companion?.connected();
  const registry = new CapabilityRegistry(
    {
      ...manifest,
      capabilities: manifest.capabilities.filter(
        (entry) =>
          (navigation || entry.id !== 'browser.navigate') &&
          (generic || !entry.id.startsWith('ui.')) &&
          (entry.id !== 'ui.screenshot' || config.screenshots) &&
          (entry.id !== 'link.handoff' || config.link),
      ),
    },
    {
      handlers: {
        ...page.handlers,
        ...generic?.handlers,
        ...link?.handlers,
        'browser.navigate': (args, context) => context.navigate(args.url),
      },
      verifiers: {
        ...page.verifiers,
        ...generic?.verifiers,
        ...link?.verifiers,
        'browser.verifyNavigation': (args) => ({
          verified:
            document.URL === new URL(args.url, document.URL).href &&
            Boolean(root()),
          evidence: { ready: true },
        }),
      },
      parameters,
    },
  );
  let navigationStore;
  let chatNavigationStore;
  try {
    navigationStore = new NavigationStore(sessionStorage);
    chatNavigationStore = new ChatNavigationStore(
      sessionStorage,
      'pagesquire:embed-chat:0.1',
    );
  } catch {
    /* Without session storage, conversations end at a page load. */
  }
  const runtime = new BrowserRuntime({
    observer,
    registry,
    presentation: driver,
    // Risky generic steps such as submit or delete ask the visitor first.
    ...(generic
      ? { approve: createApprovalPrompt(host, { locale: config.locale }) }
      : {}),
    ...(generic || link
      ? { visitor: createVisitorPrompt(host, { locale: config.locale }) }
      : {}),
    // A handoff waits for the partner's server (up to 10 seconds).
    ...(link ? { timeoutMs: 20000 } : generic ? { timeoutMs: 8000 } : {}),
    ...(navigationStore ? { navigationStore } : {}),
  });
  const trace = config.trace
    ? new TraceRecorder({ includeContent: config.trace === 'content' })
    : undefined;
  const client = new AssistantClient({
    locale: config.locale,
    ...(trace ? { onTrace: trace.record } : {}),
    runtime,
    transport: createHttpTransport({
      locale: config.locale,
      endpoint: config.endpoint,
      baseUrl: location.href,
      csrfToken: config.csrfToken,
    }),
    ...(chatNavigationStore ? { navigationStore: chatNavigationStore } : {}),
    ...(generic ? { allowRecovery: true, timeoutMs: 120000 } : {}),
  });
  mountWidget(host, client, { title: config.title, locale: config.locale });
  if (link) mountLinkArrival(host, client, { locale: config.locale });
  if (trace) mountTraceViewer(host, trace);
  const webmcp = config.webmcp ? await exposeToWebMcp(runtime) : undefined;
  window.PageSquire = Object.freeze({
    runtime,
    client,
    observer,
    webmcp,
    trace,
  });
  window.addEventListener(
    'pagehide',
    () => {
      client.cancel();
      runtime.cancel();
      webmcp?.dispose();
      driver.dispose();
    },
    { once: true },
  );
  await client.resumeNavigation();
}

void boot().catch((error) => {
  console.warn(`PageSquire could not start: ${error.message}`);
});
