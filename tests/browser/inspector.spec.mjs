import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/driving.html');
  await page.waitForFunction(() => Boolean(window.pagesquireDriving));
});
const root = (page) =>
  page.getByRole('region', {
    name: 'PageSquire capability inspector',
    exact: true,
  });
const headingRow = (page) =>
  root(page)
    .locator('details')
    .filter({
      has: page.locator('summary code', {
        hasText: 'accessibility.set_heading_color',
      }),
    });

test('inspector: opt-in mount shows registry coverage and preparation without acting', async ({
  page,
}) => {
  await expect(root(page)).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Open capability inspector', exact: true })
    .click();
  await expect(root(page)).toBeVisible();
  await expect(root(page)).toContainText('expected but missing');
  await expect(headingRow(page).locator('summary')).toContainText(
    'Needs preparation',
  );
  await expect(
    root(page).locator('details').filter({ hasText: 'site.search' }),
  ).toContainText('Not registered');
  await expect(page.locator('#settings')).not.toHaveAttribute('open', '');
  await expect(page.locator('#driving-article')).toBeHidden();
  expect(
    await page.evaluate(() => ({
      requests: window.pagesquireDriving.requests,
      opens: window.pagesquireDriving.opens,
    })),
  ).toEqual({ requests: 0, opens: 0 });
  await expect(page.locator('.pagesquire-driving')).toHaveCount(0);
});

test('inspector: live refresh re-resolves targets and never prepares or clicks them', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Open capability inspector', exact: true })
    .click();
  await page.locator('#settings summary').click();
  await expect(headingRow(page).locator('summary')).toContainText(
    'Needs preparation',
  );
  await root(page)
    .getByRole('button', { name: 'Refresh checks', exact: true })
    .click();
  await expect(headingRow(page).locator('summary')).toContainText(
    'Target ready',
  );
  await page
    .locator('#driver-heading-color')
    .evaluate((element) => element.setAttribute('data-pagesquire-private', ''));
  await root(page).getByRole('button', { name: 'Refresh checks' }).click();
  await expect(headingRow(page).locator('summary')).toContainText(
    'Private target',
  );
  await page.locator('#driver-heading-color').evaluate((element) => {
    element.removeAttribute('data-pagesquire-private');
    element.parentElement.append(element.cloneNode(true));
  });
  await root(page).getByRole('button', { name: 'Refresh checks' }).click();
  await expect(headingRow(page).locator('summary')).toContainText(
    'Ambiguous target',
  );
  await page
    .locator('#driver-heading-color')
    .evaluateAll((elements) => elements.forEach((element) => element.remove()));
  await root(page).getByRole('button', { name: 'Refresh checks' }).click();
  await expect(headingRow(page).locator('summary')).toContainText(
    'Target missing',
  );
  expect(await page.evaluate(() => window.pagesquireDriving.requests)).toBe(0);
});

test('inspector: search, filter, native details and safe export do not rerun probes', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Open capability inspector', exact: true })
    .click();
  const calls = await page.evaluate(() => window.pagesquireDriving.probeCalls);
  await root(page).getByLabel('Search capabilities').fill('color');
  await expect(root(page).locator('details')).toHaveCount(1);
  await headingRow(page).locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(headingRow(page).locator('pre')).toContainText(
    'additionalProperties',
  );
  await root(page).getByLabel('Filter status').selectOption('issues');
  await expect(root(page)).toContainText('No matching capabilities');
  await root(page).getByLabel('Search capabilities').fill('');
  await expect(root(page).locator('details')).not.toHaveCount(0);
  await root(page)
    .getByRole('button', { name: 'Show diagnostics JSON' })
    .click();
  const json = await root(page)
    .getByLabel('Diagnostics JSON', { exact: true })
    .inputValue();
  expect(JSON.parse(json).authorization).toBe('not_evaluated');
  expect(json).not.toMatch(
    /private-article-secret|private-form-value|private-textarea-secret|inputSchema|description|aliases|snapshot|https?:|selector|handler/,
  );
  expect(await page.evaluate(() => window.pagesquireDriving.probeCalls)).toBe(
    calls,
  );
});

test('inspector: mounting, refreshing and unmounting preserve an active runtime snapshot', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.inspectionSnapshot = window.pagesquireDriving.runtime.observe();
  });
  await page
    .getByRole('button', { name: 'Open capability inspector', exact: true })
    .click();
  await root(page).getByRole('button', { name: 'Refresh checks' }).click();
  await page.evaluate(() => {
    window.oldInspectorRefresh = [
      ...document.querySelectorAll('.pagesquire-inspector button'),
    ].find((button) => button.textContent === 'Refresh checks');
  });
  const snapshot = await page.evaluate(() =>
    window.pagesquireDriving.observer.requireSnapshot(
      window.inspectionSnapshot.id,
    ),
  );
  expect(snapshot.id).toBeTruthy();
  await page
    .getByRole('button', { name: 'Close capability inspector', exact: true })
    .click();
  await expect(root(page)).toHaveCount(0);
  const calls = await page.evaluate(() => window.pagesquireDriving.probeCalls);
  await page.evaluate(() => window.oldInspectorRefresh.click());
  expect(await page.evaluate(() => window.pagesquireDriving.probeCalls)).toBe(
    calls,
  );
  await page
    .getByRole('button', { name: 'Open capability inspector', exact: true })
    .click();
  const observation = await page.evaluate(() =>
    window.pagesquireDriving.runtime.observe(),
  );
  expect(observation.text).not.toContain('Refresh checks');
  expect(observation.text).not.toContain('Capability inspector');
  expect(
    observation.targets.some((target) =>
      target.name.includes('Diagnostics JSON'),
    ),
  ).toBe(false);
});

test('inspector: closed details hide controls but not the first summary or its children', async ({
  page,
}) => {
  const before = await page.evaluate(() => {
    const { observer } = window.pagesquireDriving;
    const summary = document.querySelector('#settings summary');
    const label = document.createElement('span');
    label.textContent = 'Summary label';
    summary.append(label);
    return {
      control: observer.isVisible(
        document.querySelector('#driver-heading-color'),
      ),
      summary: observer.isVisible(summary),
      label: observer.isVisible(label),
      details: observer.isVisible(document.querySelector('#settings')),
    };
  });
  expect(before).toEqual({
    control: false,
    summary: true,
    label: true,
    details: true,
  });
  await page.locator('#settings summary').click();
  expect(
    await page.evaluate(() =>
      window.pagesquireDriving.observer.isVisible(
        document.querySelector('#driver-heading-color'),
      ),
    ),
  ).toBe(true);
});

test('inspector: a real action still works after inspection and diagnostics refresh', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Open capability inspector', exact: true })
    .click();
  const result = await page.evaluate(() =>
    window.pagesquireDriving.call('accessibility.set_heading_color', {
      color: '#c52b28',
    }),
  );
  expect(result.status).toBe('success');
  await root(page).getByRole('button', { name: 'Refresh checks' }).click();
  await expect(headingRow(page).locator('summary')).toContainText(
    'Target ready',
  );
  await expect(page.locator('#guide h2')).toHaveCSS(
    'color',
    'rgb(197, 43, 40)',
  );
});

test('inspector: narrow layouts and keyboard controls stay usable without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page
    .getByRole('button', { name: 'Open capability inspector', exact: true })
    .click();
  await root(page).getByLabel('Search capabilities').focus();
  await page.keyboard.press('Tab');
  await expect(root(page).getByLabel('Filter status')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    root(page).getByRole('button', { name: 'Refresh checks' }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await root(page)
    .getByRole('button', { name: 'Show diagnostics JSON' })
    .click();
  await expect(
    root(page).getByLabel('Diagnostics JSON', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/inspector-mobile.png',
    fullPage: true,
  });
});
