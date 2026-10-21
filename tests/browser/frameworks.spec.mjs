import { test, expect } from '@playwright/test';
for (const port of [4174, 4175]) {
  test(`native ${port === 4174 ? 'PHP' : 'Node'} accepts five independent messages in one conversation`, async ({
    page,
  }) => {
    const requests = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/chat'))
        requests.push(request.postDataJSON());
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => Boolean(window.pagesquireChat));
    const widget = page.locator('.pagesquire-widget');
    for (const message of [
      'Make headings red',
      'Highlight links',
      'Use bold text',
      'Hello',
      'Highlight links',
    ]) {
      await widget.getByRole('textbox').fill(message);
      await widget.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(widget).toHaveAttribute('aria-busy', 'false', {
        timeout: 15000,
      });
      await expect(widget.getByRole('log')).not.toContainText(
        /request was rejected|unavailable|expired|could not complete/,
      );
    }
    expect(requests.filter((request) => request.message)).toHaveLength(5);
    expect(requests.filter((request) => request.result)).toHaveLength(4);
    expect(requests[0].conversationId).toBeUndefined();
    const ids = new Set(
      requests.slice(1).map((request) => request.conversationId),
    );
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBeTruthy();
    expect(new Set(requests.map((request) => request.requestId)).size).toBe(9);
    await expect(page.locator('main h1')).toHaveCSS('color', 'rgb(255, 0, 0)');
    await expect(page.locator('main')).toHaveClass('links-highlighted');
    await expect(page.locator('body')).toHaveCSS('font-weight', '700');
    await expect(widget).toHaveAttribute('data-emotion', 'happy');
  });

  test(`native ${port === 4174 ? 'PHP' : 'Node'} full-document conversation resumes once without replaying navigation`, async ({
    page,
  }) => {
    const payloads = [];
    page.on('request', (request) => {
      if (request.method() === 'POST') payloads.push(request.postDataJSON());
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => Boolean(window.pagesquireChat));
    await page.evaluate(() => {
      window.beforeNavigationMarker = true;
    });
    const widget = page.locator('.pagesquire-widget');
    await widget.getByRole('textbox').fill('Navigate then make headings red');
    await widget.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page).toHaveURL(`http://127.0.0.1:${port}/next.html`, {
      timeout: 15000,
    });
    await expect(widget.getByRole('log')).toContainText(
      'changes were verified',
      { timeout: 15000 },
    );
    await expect(page.locator('main h1')).toHaveCSS('color', 'rgb(255, 0, 0)');
    expect(
      await page.evaluate(() => window.beforeNavigationMarker),
    ).toBeUndefined();
    expect(payloads).toHaveLength(3);
    expect(payloads[1].result.capabilityId).toBe('browser.navigate');
    expect(payloads[1].result.status).toBe('success');
    expect(payloads[1].conversationId).toBe(payloads[2].conversationId);
    expect(payloads[1].snapshot.url).toContain('/next.html');
    expect(
      await page.evaluate(() =>
        Object.keys(sessionStorage).filter((key) =>
          key.startsWith('pagesquire:'),
        ),
      ),
    ).toEqual([]);
    const posts = payloads.length;
    await page.reload();
    await page.waitForFunction(() => Boolean(window.pagesquireChat));
    expect(payloads).toHaveLength(posts);
  });
}
test('Node backend drives sequential accessibility actions with verified state and emotion', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4175/');
  await page.waitForFunction(() => Boolean(window.pagesquireChat));
  const widget = page.locator('.pagesquire-widget');
  await widget.getByRole('textbox').fill('Highlight links and use bold text');
  await widget.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(widget.getByRole('log')).toContainText('changes were verified', {
    timeout: 15000,
  });
  await expect(page.locator('main')).toHaveClass('links-highlighted');
  await expect(page.locator('body')).toHaveCSS('font-weight', '700');
  await expect(widget).toHaveAttribute('data-emotion', 'happy');
});
test('real Next.js App Router waits for streamed destination and preserves widget across conversation', async ({
  page,
}) => {
  test.setTimeout(90000);
  const requests = [];
  const sessionRequests = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/session'))
      sessionRequests.push(request.url());
    if (request.method() === 'POST' && request.url().endsWith('/api/chat'))
      requests.push(request.postDataJSON());
  });
  await page.goto('http://127.0.0.1:4176/');
  await page.waitForFunction(() => Boolean(window.nextDemo));
  const widget = page.locator('.pagesquire-widget');
  await page.evaluate(() => {
    window.noReload = true;
    document.querySelector('.pagesquire-widget').dataset.marker = 'persistent';
  });
  await widget.getByRole('textbox').fill('Navigate then make headings red');
  await widget.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:4176/destination', {
    timeout: 45000,
  });
  await expect(widget.getByRole('log')).toContainText('changes were verified', {
    timeout: 45000,
  });
  await expect(page.locator('main h1')).toHaveText('Next.js destination ready');
  await expect(page.locator('main h1')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(widget).toHaveAttribute('data-marker', 'persistent');
  expect(await page.evaluate(() => window.noReload)).toBe(true);
  expect(requests).toHaveLength(3);
  expect(sessionRequests).toHaveLength(1);
  expect(requests[1].result.status).toBe('success');
  expect(requests[1].snapshot.text).toContain('Next.js destination ready');
  await expect(widget).toHaveAttribute('data-emotion', 'happy');
});
