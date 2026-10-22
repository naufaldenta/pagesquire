import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.goto('/driving.html');
  await page.waitForFunction(() => Boolean(window.pagesquireDriving));
});

async function controlled(page, mode = 'verified') {
  await page.evaluate((mode) => {
    const { runtime } = window.pagesquireDriving;
    const resolve = runtime.registry.resolve.bind(runtime.registry);
    window.progressGates = {};
    runtime.registry.resolve = (id, parameters) => {
      const entry = resolve(id, parameters);
      return {
        ...entry,
        execute: async (...args) => {
          await new Promise((done) => (window.progressGates.execute = done));
          return entry.execute(...args);
        },
        verify: async (...args) => {
          await new Promise((done) => (window.progressGates.verify = done));
          if (mode === 'unverified') return { verified: false };
          if (mode === 'failed') throw Error('private-verifier-marker');
          return entry.verify(...args);
        },
      };
    };
  }, mode);
}
const release = (page, phase) =>
  page.evaluate((phase) => window.progressGates[phase](), phase);
const latest = (page) => page.locator('.pagesquire-action-list > li').last();

test('timeline waits for the real verifier and keeps progress outside the busy live region', async ({
  page,
}) => {
  await controlled(page);
  const widget = page.locator('.pagesquire-widget');
  await expect(
    widget.getByRole('region', { name: 'Action progress' }),
  ).toBeHidden();
  await page.locator('#change-headings').click();
  await page.waitForFunction(() => Boolean(window.progressGates.execute));
  await expect(latest(page)).toHaveAttribute('data-stage', 'executing');
  await expect(widget.locator('.pagesquire-status')).toContainText(
    'Executing: accessibility.set_heading_color',
  );
  await expect(widget).toHaveAttribute('data-busy', 'true');
  await expect(widget).not.toHaveAttribute('aria-busy', 'true');
  await expect(widget.getByRole('log')).toHaveAttribute('aria-busy', 'true');
  await expect(widget.locator('.pagesquire-status')).toHaveAttribute(
    'aria-live',
    'polite',
  );
  await expect(page.locator('#change-headings')).toBeFocused();
  await release(page, 'execute');
  await page.waitForFunction(() => Boolean(window.progressGates.verify));
  await expect(latest(page)).toHaveAttribute('data-stage', 'verifying');
  await expect(page.locator('#guide h2')).toHaveCSS(
    'color',
    'rgb(197, 43, 40)',
  );
  await expect(latest(page).locator('.pagesquire-action-outcome')).toHaveText(
    'Verifying',
  );
  await expect(widget.getByRole('log')).not.toContainText('state was verified');
  await release(page, 'verify');
  await expect(widget).toHaveAttribute('data-busy', 'false');
  await expect(latest(page)).toHaveAttribute('data-stage', 'verified');
  await expect(
    latest(page)
      .getByRole('list', { name: 'Observed stages' })
      .getByRole('listitem'),
  ).toHaveText(['Checking', 'Executing', 'Verifying', 'Verified']);
  const projection = await page.evaluate(() => ({
    progress: window.pagesquireDriving.client.state.actionProgress,
    observed: window.pagesquireDriving.runtime.observe().text,
  }));
  expect(JSON.stringify(projection.progress)).not.toMatch(
    /private-|parameters|evidence|https?:/,
  );
  expect(projection.observed).not.toContain('Action progress');
});

for (const mode of ['unverified', 'failed']) {
  test(`timeline ${mode} outcome never becomes verified or exposes host errors`, async ({
    page,
  }) => {
    await controlled(page, mode);
    await page.locator('#change-headings').click();
    await page.waitForFunction(() => Boolean(window.progressGates.execute));
    await release(page, 'execute');
    await page.waitForFunction(() => Boolean(window.progressGates.verify));
    await release(page, 'verify');
    await expect(page.locator('.pagesquire-widget')).toHaveAttribute(
      'data-busy',
      'false',
    );
    await expect(latest(page)).toHaveAttribute('data-stage', mode);
    await expect(latest(page)).not.toContainText('private-verifier-marker');
    await expect(latest(page).locator('.pagesquire-action-outcome')).toHaveText(
      mode === 'unverified' ? 'Not verified' : 'Failed',
    );
    await expect(
      latest(page).locator('.pagesquire-action-guidance'),
    ).toContainText(
      mode === 'unverified' ? 'not rolled back' : 'no automatic retry',
    );
    await expect(page.locator('#guide h2')).toHaveCSS(
      'color',
      'rgb(197, 43, 40)',
    );
    expect(await page.evaluate(() => window.pagesquireDriving.requests)).toBe(
      2,
    );
  });
}

test('Stop settles progress, ignores late work and reset clears the local timeline', async ({
  page,
}) => {
  await controlled(page);
  const widget = page.locator('.pagesquire-widget');
  await page.locator('#change-headings').click();
  await page.waitForFunction(() => Boolean(window.progressGates.execute));
  await widget.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(widget).toHaveAttribute('data-busy', 'false');
  await expect(latest(page)).toHaveAttribute('data-stage', 'cancelled');
  await expect(latest(page)).toContainText('not rolled back');
  await release(page, 'execute');
  await expect(latest(page)).toHaveAttribute('data-stage', 'cancelled');
  await widget.getByRole('button', { name: 'New conversation' }).click();
  await expect(
    widget.getByRole('region', { name: 'Action progress' }),
  ).toBeHidden();
  expect(
    await page.evaluate(
      () => window.pagesquireDriving.client.state.actionProgress,
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage).filter(
        (key) => key.includes('progress') || key.includes('timeline'),
      ),
    ),
  ).toEqual([]);
});

test('context denial has actionable guidance without claiming handler execution', async ({
  page,
}) => {
  await page.locator('#driver-heading-color').evaluate((element) => {
    element.disabled = true;
  });
  await page.locator('#change-headings').click();
  await expect(page.locator('.pagesquire-widget')).toHaveAttribute(
    'data-busy',
    'false',
  );
  await expect(latest(page)).toHaveAttribute('data-stage', 'failed');
  await expect(latest(page)).toContainText('current app state');
  await expect(
    latest(page)
      .getByRole('list', { name: 'Observed stages' })
      .getByRole('listitem'),
  ).toHaveText(['Checking', 'Failed']);
  await expect(page.locator('#settings')).not.toHaveAttribute('open', '');
});

test('mobile timeline stays keyboard-readable, bounded and free from horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.locator('#change-headings').click();
  await expect(page.locator('.pagesquire-widget')).toHaveAttribute(
    'data-busy',
    'false',
  );
  const list = page.getByRole('list', { name: 'Recent actions' });
  await list.focus();
  await expect(list).toBeFocused();
  expect(await list.getByRole('listitem').count()).toBeLessThanOrEqual(20 * 9);
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth > innerWidth,
    widget:
      document.querySelector('.pagesquire-widget').scrollWidth >
      document.querySelector('.pagesquire-widget').clientWidth,
  }));
  expect(overflow).toEqual({ page: false, widget: false });
  await list.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: test.info().outputPath('timeline-mobile.png'),
    fullPage: true,
  });
});

test('fixed WordPress-size panels keep Send visible after several action timelines', async ({
  page,
}) => {
  const css = await readFile(
    new URL('../../packages/wordpress/plugin.css', import.meta.url),
    'utf8',
  );
  await page.route('**/test-plugin.css', (route) =>
    route.fulfill({ contentType: 'text/css', body: css }),
  );
  await page.evaluate(() => {
    document.querySelector('#driver-chat').id = 'pagesquire-widget';
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/test-plugin.css';
    document.head.append(stylesheet);
  });
  await page.setViewportSize({ width: 360, height: 780 });
  for (let index = 0; index < 4; index++) {
    await page.evaluate(() =>
      document.querySelector('#change-headings').click(),
    );
    await page.waitForFunction(
      () => !window.pagesquireDriving.client.state.busy,
    );
  }
  const widget = page.locator('.pagesquire-widget');
  await test.info().attach('fixed-panel-geometry.json', {
    body: JSON.stringify(
      await widget.evaluate((element) => {
        const measure = (node) => {
          const rect = node.getBoundingClientRect(),
            style = getComputedStyle(node);
          return {
            tag: node.className || node.tagName,
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
            scrollHeight: node.scrollHeight,
            clientHeight: node.clientHeight,
            margin: style.margin,
            padding: style.padding,
            minHeight: style.minHeight,
            flex: style.flex,
          };
        };
        return {
          panel: measure(element.parentElement),
          widget: measure(element),
          children: [...element.children].map(measure),
          send: measure(element.querySelector('button[type="submit"]')),
        };
      }),
    ),
    contentType: 'application/json',
  });
  await page.screenshot({
    path: test.info().outputPath('fixed-panel-before-assert.png'),
    fullPage: false,
  });
  await expect(
    widget.getByRole('button', { name: 'Send', exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    widget.getByRole('button', { name: 'New conversation' }),
  ).toBeInViewport({ ratio: 1 });
  const actions = widget.getByRole('list', { name: 'Recent actions' });
  await actions.focus();
  await expect(actions).toBeFocused();
  const scrollable = await actions.evaluate(
    (list) =>
      list.scrollHeight > list.clientHeight ||
      list.closest('.pagesquire-action-progress').scrollHeight >
        list.closest('.pagesquire-action-progress').clientHeight,
  );
  expect(scrollable).toBe(true);
  await widget.getByRole('textbox').focus();
  await expect(
    widget.getByRole('button', { name: 'Send', exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: test.info().outputPath('fixed-panel-mobile.png'),
    fullPage: false,
  });
});
