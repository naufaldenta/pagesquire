import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/driving.html');
  await page.waitForFunction(() => Boolean(window.pagesquireDriving));
});

test('app context: only declared public fields reach each turn and preparation remains possible', async ({
  page,
}) => {
  await page.locator('#change-headings').click();
  await expect(page.locator('#guide h2')).toHaveCSS(
    'color',
    'rgb(197, 43, 40)',
  );
  await page.waitForFunction(() => !window.pagesquireDriving.client.state.busy);
  const contexts = await page.evaluate(() => window.pagesquireDriving.contexts);
  expect(contexts).toHaveLength(2);
  expect(
    contexts[0].fields.find((field) => field.name === 'settings_open').value,
  ).toBe(false);
  expect(
    contexts[0].availability.find(
      (entry) => entry.capabilityId === 'accessibility.set_heading_color',
    ).status,
  ).toBe('needs_preparation');
  expect(
    contexts[1].fields.find((field) => field.name === 'settings_open').value,
  ).toBe(true);
  expect(
    contexts[1].fields.find((field) => field.name === 'heading_color').value,
  ).toBe('#c52b28');
  expect(JSON.stringify(contexts)).not.toMatch(
    /private-article-secret|private-form-value|private-textarea-secret|snapshot|https?:|selector/,
  );
});

test('app context: availability is checked again after provider work before any handler or presentation', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { runtime } = window.pagesquireDriving;
    const snapshot = runtime.observe();
    const pending = runtime.execute({
      protocolVersion: '0.1',
      callId: 'context-race',
      capabilityId: 'accessibility.set_heading_color',
      snapshotId: snapshot.id,
      parameters: { color: '#c52b28' },
    });
    document.querySelector('#driver-heading-color').disabled = true;
    return pending;
  });
  expect(result.code).toBe('CAPABILITY_UNAVAILABLE');
  await expect(page.locator('#settings')).not.toHaveAttribute('open', '');
  await expect(page.locator('.pagesquire-driving')).toHaveCount(0);
  await expect(page.locator('#guide h2')).not.toHaveCSS(
    'color',
    'rgb(197, 43, 40)',
  );
});

test('app context: a control becoming unavailable after execution does not invalidate verification or continuation', async ({
  page,
}) => {
  await page.locator('#open-article').evaluate((element) =>
    element.addEventListener('click', () => {
      element.disabled = true;
    }),
  );
  await page.locator('#open-summary').click();
  await page.waitForFunction(() =>
    window.pagesquireDriving.client.state.messages.some((message) =>
      message.text.includes('Synthetic summary'),
    ),
  );
  const data = await page.evaluate(() => ({
    results: window.pagesquireDriving.results,
    contexts: window.pagesquireDriving.contexts,
  }));
  expect(data.results.map((result) => result.status)).toEqual([
    'success',
    'success',
  ]);
  expect(
    data.contexts[1].availability.find(
      (entry) => entry.capabilityId === 'content.open',
    ).status,
  ).toBe('disabled');
});
