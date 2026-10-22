import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('http://127.0.0.1:4174/');
  await page.waitForFunction(() => Boolean(window.pagesquireChat));
});

async function send(page, text) {
  const widget = page.locator('.pagesquire-widget');
  await widget.getByRole('textbox').fill(text);
  await widget.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(widget).toHaveAttribute('data-busy', 'false', {
    timeout: 15000,
  });
  return widget;
}

test('real PHP conversation verifies heading-only color and carries thinking then happy emotion', async ({
  page,
}) => {
  const original = await page
    .locator('#body-copy')
    .evaluate((el) => getComputedStyle(el).color);
  const widget = await send(page, 'Make headings red');
  await expect(page.locator('main h1')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(page.locator('#body-copy')).toHaveCSS('color', original);
  await expect(widget).toHaveAttribute('data-emotion', 'happy');
  await expect(widget.getByRole('log')).toContainText(
    'accessibility.set_heading_color: success',
  );
  await expect(widget.getByRole('log')).toContainText('changes were verified');
  await expect(widget.getByRole('log')).not.toContainText('premature');
  expect(await page.evaluate(() => window.pagesquireChat.emotions)).toEqual([
    'thinking',
    'happy',
  ]);
  expect(
    await widget
      .getByRole('textbox')
      .evaluate((el) => el === document.activeElement),
  ).toBe(true);
});

test('combined request executes sequentially with fresh snapshots and preserves server history', async ({
  page,
}) => {
  const payloads = [];
  page.on('request', (req) => {
    if (req.method() === 'POST') payloads.push(req.postDataJSON());
  });
  const widget = await send(page, 'Highlight links and use bold text');
  await expect(page.locator('main')).toHaveClass('links-highlighted');
  await expect(page.locator('body')).toHaveCSS('font-weight', '700');
  expect(payloads).toHaveLength(3);
  expect(new Set(payloads.map((p) => p.snapshot.id)).size).toBe(3);
  expect(payloads[1].conversationId).toBe(payloads[2].conversationId);
  expect(payloads[0]).not.toHaveProperty('history');
  for (const request of payloads) {
    expect(request.snapshot.text).not.toMatch(
      /private-section-secret|textarea-secret|Highlight links and use bold text/,
    );
    expect(request.capabilityIds).not.toContain('testing.consequential');
  }
  await widget.getByRole('button', { name: 'New conversation' }).click();
  await expect(widget.getByRole('log')).toBeEmpty();
  await expect(widget).toHaveAttribute('data-emotion', 'idle');
});

test('unverified action stops without a false success message', async ({
  page,
}) => {
  const widget = await send(page, 'Try an unverified action');
  await expect(widget.getByRole('log')).toContainText(
    'testing.unverified: unverified',
  );
  await expect(widget.getByRole('log')).toContainText('could not verify');
  await expect(widget.getByRole('log')).not.toContainText(
    'changes were verified',
  );
  await expect(widget).toHaveAttribute('data-emotion', 'confused');
});

test('Escape cancels a running browser action and restores the input', async ({
  page,
}) => {
  const widget = page.locator('.pagesquire-widget');
  await widget.getByRole('textbox').fill('Wait');
  await widget.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(widget).toHaveAttribute('data-emotion', 'thinking');
  await widget.getByRole('textbox').focus();
  await page.keyboard.press('Escape');
  await expect(widget).toHaveAttribute('data-busy', 'false');
  await expect(widget).toHaveAttribute('data-emotion', 'idle');
  await expect(widget.getByRole('log')).toContainText('cancelled');
  await send(page, 'Make headings red');
  await expect(page.locator('main h1')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(widget).toHaveAttribute('data-emotion', 'happy');
  await expect(widget.getByRole('log')).toContainText('changes were verified');
});

test('provider text is rendered as text and never interpreted as HTML', async ({
  page,
}) => {
  await page.route('**/chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        protocolVersion: '0.1',
        conversationId: 'demo',
        response: {
          protocolVersion: '0.1',
          text: '<img src=x onerror=alert(1)>',
          emotion: 'sad',
          finished: true,
          toolCalls: [],
        },
      }),
    }),
  );
  const widget = await send(page, 'Hello');
  await expect(widget.getByRole('log')).toContainText(
    '<img src=x onerror=alert(1)>',
  );
  await expect(widget.locator('img')).toHaveCount(0);
  await expect(widget).toHaveAttribute('data-emotion', 'sad');
});

test('transport rejects stale tool snapshots and hides server error bodies', async ({
  page,
}) => {
  await page.route('**/chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        protocolVersion: '0.1',
        conversationId: 'demo',
        response: {
          protocolVersion: '0.1',
          text: 'Success!',
          emotion: 'happy',
          finished: false,
          toolCalls: [
            {
              protocolVersion: '0.1',
              callId: 'bad',
              capabilityId: 'accessibility.set_heading_color',
              snapshotId: 'old',
              parameters: { color: '#ff0000' },
            },
          ],
        },
      }),
    }),
  );
  const widget = await send(page, 'Make headings red');
  await expect(widget.getByRole('log')).toContainText('outdated snapshot');
  await expect(widget.getByRole('log')).not.toContainText('Success!');
  await expect(page.locator('#accessibility-panel')).toBeHidden();
  await page.unroute('**/chat');
  await page.route('**/chat', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: '{"secret":"synthetic-provider-key"}',
    }),
  );
  await send(page, 'Hello');
  await expect(widget.getByRole('log')).not.toContainText(
    'synthetic-provider-key',
  );
});

test('React Strict Mode mounts one widget, executes once, and cleans up', async ({
  page,
}) => {
  await page.addScriptTag({
    type: 'module',
    url: 'http://127.0.0.1:4174/dist/react-demo.js',
  });
  await expect(
    page.getByRole('heading', { name: 'PageSquire · React demo' }),
  ).toBeVisible();
  await expect(page.locator('.pagesquire-widget')).toHaveCount(1);
  await send(page, 'Make headings red');
  await expect(page.locator('.pagesquire-action')).toHaveCount(1);
  await page.evaluate(() => window.unmountPageSquireReact());
  await expect(page.locator('.pagesquire-widget')).toHaveCount(0);
});

test('same-origin PHP endpoint rejects a missing CSRF token', async ({
  page,
}) => {
  const response = await page.request.post('http://127.0.0.1:4174/chat', {
    headers: { Origin: 'http://127.0.0.1:4174' },
    data: {},
  });
  expect(response.status()).toBe(419);
});

test('real Inertia v3 router completes a verified SPA navigation without remounting the widget', async ({
  page,
}) => {
  await page.addScriptTag({
    type: 'module',
    url: 'http://127.0.0.1:4174/dist/react-demo.js',
  });
  await expect(page.locator('#inertia-destination')).toHaveText(
    'Inertia home ready',
  );
  await page.locator('.pagesquire-widget').evaluate((element) => {
    element.dataset.mountMarker = 'persistent';
  });
  const result = await page.evaluate(async () => {
    window.noReloadMarker = true;
    const runtime = window.inertiaRuntime;
    return runtime.execute({
      protocolVersion: '0.1',
      callId: 'inertia-visit-1',
      capabilityId: 'browser.navigate',
      snapshotId: runtime.observe().id,
      parameters: { url: '/next.html' },
    });
  });
  expect(result.status).toBe('success');
  expect(result.observation.text).toContain('Inertia destination ready');
  await expect(page).toHaveURL('http://127.0.0.1:4174/next.html');
  await expect(page.locator('#inertia-destination')).toHaveText(
    'Inertia destination ready',
  );
  expect(await page.evaluate(() => window.noReloadMarker)).toBe(true);
  await expect(page.locator('.pagesquire-widget')).toHaveCount(1);
  await expect(page.locator('.pagesquire-widget')).toHaveAttribute(
    'data-mount-marker',
    'persistent',
  );
  await send(page, 'Make headings red');
  await expect(page.locator('main h1')).toHaveCSS('color', 'rgb(255, 0, 0)');
});
