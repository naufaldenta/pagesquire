import { readFile } from 'node:fs/promises';
import { ProjectFiles, OnboardingError } from './files.js';
import { loadConfig, pageUrl } from './config.js';
import type { ScanResult } from './scan.js';

export async function scanDom(
  files: ProjectFiles,
  urls: string[],
): Promise<ScanResult['dom']> {
  if (urls.length > 5 || new Set(urls).size !== urls.length)
    throw new OnboardingError(
      'PAGE_LIMIT',
      'Observe at most five distinct explicit pages per scan.',
    );
  const config = await loadConfig(files);
  const pages = urls.map((value) => pageUrl(value));
  for (const url of pages)
    if (
      url.origin !== config.site.origin ||
      !config.site.paths.includes(url.pathname)
    )
      throw new OnboardingError(
        'URL_NOT_ALLOWED',
        'Add the exact origin and page pathname to pagesquire.config.json before observing it.',
      );
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    throw new OnboardingError(
      'BROWSER_UNAVAILABLE',
      'Install Playwright and Chromium to enable optional DOM discovery.',
    );
  }
  let browser;
  try {
    browser = await playwright.chromium.launch();
  } catch {
    throw new OnboardingError(
      'BROWSER_UNAVAILABLE',
      'Install Chromium with playwright install chromium before DOM discovery.',
    );
  }
  const script = await readFile(
    new URL('./browser-probe.js', import.meta.url),
    'utf8',
  );
  const results: ScanResult['dom'] = [];
  try {
    for (const url of pages) {
      const context = await browser.newContext({
        serviceWorkers: 'block',
        acceptDownloads: false,
      });
      const deadline = setTimeout(() => {
        void context.close().catch(() => {});
      }, 20000);
      let blockedRequests = 0;
      let requests = 0;
      let primaryPage: import('playwright').Page | undefined;
      await context.route('**/*', async (route) => {
        const request = route.request();
        let allowed = false;
        try {
          const target = new URL(request.url());
          allowed =
            ['GET', 'HEAD'].includes(request.method()) &&
            ['document', 'script', 'stylesheet', 'image', 'font'].includes(
              request.resourceType(),
            ) &&
            target.origin === url.origin &&
            !target.username &&
            !target.password &&
            ![...target.searchParams.keys()].some((key) =>
              /password|token|secret|authorization|api[_-]?key/i.test(key),
            );
          if (request.isNavigationRequest())
            allowed &&=
              request.frame() === primaryPage?.mainFrame() &&
              target.pathname === url.pathname &&
              !target.search &&
              !target.hash;
        } catch {
          /* Refuse unknown URL schemes. */
        }
        if (allowed && ++requests <= 500) await route.continue();
        else {
          blockedRequests = Math.min(1000000, blockedRequests + 1);
          await route.abort();
        }
      });
      await context.routeWebSocket('**/*', (socket) => {
        blockedRequests++;
        socket.close();
      });
      const page = await context.newPage();
      primaryPage = page;
      context.on('page', (popup) => {
        if (popup !== page) void popup.close();
      });
      try {
        const response = await page.goto(url.href, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        if (!response?.ok() || page.url() !== url.href)
          throw new Error('Page unavailable');
        const data = (await page.evaluate(
          `${script}\nPageSquireProbe.observePage()`,
        )) as Awaited<
          ReturnType<(typeof import('./dom-probe.js'))['observePage']>
        >;
        results.push({
          path: url.pathname,
          status: 'observed',
          ...data,
          blockedRequests,
        });
      } catch {
        results.push({
          path: url.pathname,
          status: 'failed',
          controls: [],
          headings: 0,
          blockedRequests,
          truncated: false,
        });
      } finally {
        clearTimeout(deadline);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}
