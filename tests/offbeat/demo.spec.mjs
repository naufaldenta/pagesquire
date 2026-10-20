import { expect, test } from '@playwright/test';

async function openAssistant(page) {
  await page
    .getByRole('button', { name: 'Open PageSquire', exact: true })
    .click();
  const panel = page.getByRole('complementary', {
    name: 'PageSquire guided actions',
  });
  await expect(
    panel.getByRole('button', { name: 'Make headings red' }),
  ).toBeEnabled();
  return panel;
}

test('original landing loads without hydration errors, provider calls or broken artwork', async ({
  page,
}) => {
  const errors = [];
  const requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request));
  await page.goto('/');
  await expect(page).toHaveTitle('OFFBEAT — Weird looks good on you');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'WEIRD LOOKS',
  );
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px Anton'))).toBe(
    true,
  );
  expect(
    await page
      .locator('.hero-art > img')
      .evaluate((image) => image.complete && image.naturalWidth === 1536),
  ).toBe(true);
  const panel = await openAssistant(page);
  await expect(panel.getByLabel('Demo access code')).toBeEnabled();
  await expect(
    panel.getByText('ACCESS CODE REQUIRED', { exact: true }),
  ).toBeVisible();
  await panel
    .getByRole('button', { name: 'Highlight links', exact: true })
    .click();
  await expect(panel.locator('[data-status]')).toHaveAttribute(
    'data-status',
    'verified',
  );
  expect(requests.filter((request) => request.method() !== 'GET')).toEqual([]);
  expect(
    requests.filter(
      (request) => new URL(request.url()).origin !== 'http://127.0.0.1:4180',
    ),
  ).toEqual([]);
  expect(
    requests
      .filter((request) => /\/api\//.test(request.url()))
      .every(
        (request) =>
          new URL(request.url()).pathname === '/api/session' &&
          request.method() === 'GET',
      ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('guided actions verify headings separately from body, links, weight, size, filter and scroll', async ({
  page,
}) => {
  await page.goto('/');
  const originalBody = await page
    .locator('.hero-copy > p')
    .evaluate((element) => getComputedStyle(element).color);
  const panel = await openAssistant(page);
  for (const [label, text] of [
    ['Make headings red', 'Headings are now red. Body text is unchanged.'],
    ['Highlight links', 'Page links are highlighted and underlined.'],
    ['Make text bold', 'Reading text is now bold.'],
    ['Make text larger', 'Reading text is now 20 pixels.'],
    ['Show 3D art', 'The gallery now shows only 3D art.'],
    ['Jump to the gallery', 'You are at the gallery.'],
  ]) {
    await panel.getByRole('button', { name: label, exact: true }).click();
    await expect(panel.locator('[data-status]')).toHaveAttribute(
      'data-status',
      'verified',
    );
    await expect(panel.locator('[data-status]')).toContainText(text);
    await expect(panel.locator('.assistant-top .squire-face')).toHaveAttribute(
      'data-emotion',
      'happy',
    );
  }
  await expect(page.locator('#hero-title')).toHaveCSS(
    'color',
    'rgb(197, 43, 40)',
  );
  await expect(page.locator('.hero-copy > p')).toHaveCSS('color', originalBody);
  await expect(page.locator('.hero-copy > p')).toHaveCSS('font-weight', '700');
  await expect(page.locator('.hero-copy > p')).toHaveCSS('font-size', '20px');
  await expect(page.locator('.site-header nav a').first()).toHaveCSS(
    'background-color',
    'rgb(217, 255, 71)',
  );
  await expect(page.locator('[data-art-card]:visible')).toHaveCount(1);
  expect(
    await page
      .locator('#gallery')
      .evaluate((element) => Math.abs(element.getBoundingClientRect().top)),
  ).toBeLessThan(4);
  await panel.getByRole('button', { name: 'Reset page', exact: true }).click();
  await expect(page.locator('#hero-title')).toHaveCSS(
    'color',
    'rgb(23, 23, 23)',
  );
  await expect(page.locator('.hero-copy > p')).toHaveCSS('font-weight', '400');
  await expect(page.locator('.hero-copy > p')).toHaveCSS('font-size', '16px');
  await expect(page.locator('[data-art-card]:visible')).toHaveCount(4);
  await expect(page.locator('.site-header nav a').first()).not.toHaveCSS(
    'background-color',
    'rgb(217, 255, 71)',
  );
});

test('failure never claims a verified change and six original expressions can be previewed', async ({
  page,
}) => {
  await page.goto('/');
  const panel = await openAssistant(page);
  await page
    .locator('#hero-title')
    .evaluate((element) =>
      element.style.setProperty('color', 'blue', 'important'),
    );
  await panel.getByRole('button', { name: 'Make headings red' }).click();
  await expect(panel.locator('[data-status]')).toHaveAttribute(
    'data-status',
    'failed',
    { timeout: 9000 },
  );
  await expect(panel.locator('[data-status]')).not.toContainText('Verified');
  await expect(panel.locator('.assistant-top .squire-face')).toHaveAttribute(
    'data-emotion',
    'confused',
  );
  await panel.getByText('Preview the six expressions').click();
  for (const emotion of [
    'idle',
    'happy',
    'sad',
    'thinking',
    'confused',
    'hover',
  ]) {
    await panel
      .getByRole('button', {
        name: `Preview ${emotion} expression`,
        exact: true,
      })
      .click();
    await expect(panel.locator('.assistant-top .squire-face')).toHaveAttribute(
      'data-emotion',
      emotion,
    );
  }
});

test('gallery filters and native art dialogs work by keyboard and restore focus', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Illustration', exact: true }).click();
  await expect(page.locator('[data-art-card]:visible')).toHaveCount(1);
  await expect(page.locator('.art-count')).toHaveText('1 / 4 WORLDS');
  const trigger = page.getByRole('button', {
    name: 'Explore Little menace energy',
  });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('dialog', { name: 'Little menace energy' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'Everything', exact: true }).click();
  await expect(page.locator('[data-art-card]:visible')).toHaveCount(4);
});

test('manual accessibility settings use the same controls and modal focus stays inside', async ({
  page,
}) => {
  await page.goto('/');
  const trigger = page.getByRole('button', {
    name: 'Open accessibility settings',
  });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Make it yours.' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Heading color').selectOption('#6440d5');
  await dialog
    .getByLabel('Highlight links', { exact: true })
    .selectOption('true');
  await dialog.getByLabel('Reading text weight').selectOption('700');
  await dialog.getByLabel('Reading text size').selectOption('20');
  await expect(page.locator('#hero-title')).toHaveCSS(
    'color',
    'rgb(100, 64, 213)',
  );
  await expect(page.locator('.hero-copy > p')).toHaveCSS('font-weight', '700');
  await expect(page.locator('.hero-copy > p')).toHaveCSS('font-size', '20px');
  for (let count = 0; count < 9; count++) {
    await page.keyboard.press('Tab');
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  const panel = await openAssistant(page);
  await panel.getByRole('button', { name: 'Make headings red' }).click();
  await expect(panel.locator('[data-status]')).toHaveAttribute(
    'data-status',
    'verified',
  );
});

for (const width of [375, 768, 1440]) {
  test(`responsive ${width}px layout has no overflow and keeps usable controls`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`offbeat-${width}.png`),
      fullPage: true,
    });
    const panel = await openAssistant(page);
    await expect(panel).toBeInViewport();
    await panel.getByRole('button', { name: 'Make headings red' }).click();
    await expect(panel.locator('[data-status]')).toHaveAttribute(
      'data-status',
      'verified',
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test('API denies unauthorized writes and static files do not expose repository/env files', async ({
  request,
}) => {
  for (const file of ['/.env.local', '/package.json', '/env.example'])
    expect((await request.get(file)).status()).toBe(404);
  expect((await request.get('/api/session')).status()).toBe(200);
  expect((await request.get('/api/chat')).status()).toBe(405);
  expect((await request.post('/api/chat', { data: {} })).status()).toBe(403);
  expect((await request.get('/fonts/OFL.txt')).status()).toBe(200);
  expect((await request.get('/pagesquire-license.txt')).status()).toBe(200);
});

test('private chat unlocks, thinks, verifies multiple scoped actions, preserves the panel and signs out', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const panel = await openAssistant(page);
  await panel.getByLabel('Demo access code').fill('offbeat-test-access-code');
  await panel.getByRole('button', { name: 'Unlock AI', exact: true }).click();
  await expect(
    panel.getByText('LIVE · PRIVATE DEMO', { exact: true }),
  ).toBeVisible();
  const originalBody = await page
    .locator('.hero-copy > p')
    .evaluate((element) => getComputedStyle(element).color);
  await panel
    .getByLabel('Message PageSquire')
    .fill('Make headings red, highlight links and use bold text');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.locator('.assistant-top')).toBeInViewport();
  await expect(panel.locator('.assistant-top .squire-face')).toHaveAttribute(
    'data-emotion',
    'thinking',
  );
  await expect(panel.getByRole('log')).toContainText(
    'Requested changes verified on this page.',
  );
  await expect(panel.locator('.assistant-top .squire-face')).toHaveAttribute(
    'data-emotion',
    'happy',
  );
  await expect(panel.getByRole('log')).not.toContainText('Premature success');
  await expect(page.locator('#hero-title')).toHaveCSS(
    'color',
    'rgb(197, 43, 40)',
  );
  await expect(page.locator('.hero-copy > p')).toHaveCSS('color', originalBody);
  await expect(page.locator('.hero-copy > p')).toHaveCSS('font-weight', '700');
  await expect(page.locator('.site-header nav a').first()).toHaveCSS(
    'background-color',
    'rgb(217, 255, 71)',
  );
  await expect(
    panel.getByRole('log').locator('.chat-message.action'),
  ).toHaveCount(3);
  await page.screenshot({
    path: testInfo.outputPath('offbeat-chat-desktop.png'),
  });
  await panel
    .getByRole('button', { name: 'Close PageSquire', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Open PageSquire', exact: true })
    .click();
  await expect(panel.getByRole('log')).toContainText(
    'Requested changes verified',
  );
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  await panel
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await expect(panel.getByRole('log').locator('.chat-message')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(panel.getByLabel('Demo access code')).toBeVisible();
});

test('chat errors stay text-only and a mobile unlock form stays inside the viewport', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/');
  const panel = await openAssistant(page);
  await panel.getByLabel('Demo access code').fill('incorrect-code');
  await panel.getByRole('button', { name: 'Unlock AI', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('incorrect');
  await panel.getByLabel('Demo access code').fill('offbeat-test-access-code');
  await panel.getByRole('button', { name: 'Unlock AI', exact: true }).click();
  await expect(panel.getByLabel('Message PageSquire')).toBeEnabled();
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'RATE_LIMITED',
          message: '<img src=x onerror=alert(1)> quota',
        },
      }),
    }),
  );
  await panel.getByLabel('Message PageSquire').fill('Hello');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.getByRole('log')).toContainText('request was rejected');
  await expect(panel.getByRole('log')).not.toContainText('onerror=');
  await expect(panel.getByRole('log').locator('img')).toHaveCount(0);
  await expect(panel.getByLabel('Message PageSquire')).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('offbeat-chat-mobile.png'),
  });
});
