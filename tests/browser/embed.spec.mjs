import { test, expect } from '@playwright/test';
import {
  validateChatRequest,
  validateActionResult,
} from '@pagesquire/protocol';
import { readFile } from 'node:fs/promises';

test('the one-tag embed boots under a strict CSP and completes a verified read', async ({
  page,
}) => {
  const requests = [];
  const violations = [];
  page.on('console', (message) => {
    if (
      /Content Security Policy|PageSquire could not start/.test(message.text())
    )
      violations.push(message.text());
  });
  await page.route('**/pagesquire/chat', async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    requests.push({ body, csrf: request.headers()['x-csrf-token'] });
    const response = body.result
      ? {
          protocolVersion: '0.1',
          text: 'I read the public content.',
          emotion: 'happy',
          finished: true,
          toolCalls: [],
        }
      : {
          protocolVersion: '0.1',
          text: 'Checking the requested action…',
          emotion: 'thinking',
          finished: false,
          toolCalls: [
            {
              protocolVersion: '0.1',
              callId: 'embed-call',
              capabilityId: 'page.read',
              snapshotId: body.snapshot.id,
              parameters: { scope: 'content', mode: 'summary', offset: 0 },
            },
          ],
        };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        protocolVersion: '0.1',
        conversationId: 'embed-conversation',
        response,
      }),
    });
  });
  await page.goto('/embed.html');
  await page.waitForFunction(() => Boolean(window.PageSquire?.client));
  const widget = page.locator('.pagesquire-embed .pagesquire-widget');
  await expect(
    widget.getByRole('heading', { name: 'Embed demo' }),
  ).toBeVisible();
  await widget.getByRole('textbox').fill('Summarize this page');
  await widget.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(widget.getByRole('log')).toContainText(
    'I read the public content.',
  );
  expect(requests).toHaveLength(2);
  for (const { body, csrf } of requests) {
    expect(validateChatRequest(body).valid).toBe(true);
    expect(csrf).toBe('synthetic-embed-csrf-token-0123456789');
  }
  expect(requests[0].body.capabilityIds).toEqual([
    'page.read',
    'page.scroll_to',
    'page.highlight',
  ]);
  const result = requests[1].body.result;
  expect(validateActionResult(result).valid).toBe(true);
  expect(result.status).toBe('success');
  expect(JSON.stringify(result.evidence)).toContain('single script tag');
  expect(violations).toEqual([]);
  const manifest = JSON.parse(
    await readFile('packages/embed/dist/manifest.json', 'utf8'),
  );
  expect(manifest.capabilities.map((entry) => entry.id)).toEqual([
    'page.read',
    'page.scroll_to',
    'page.highlight',
    'browser.navigate',
    'ui.find',
    'ui.click',
    'ui.type',
    'ui.select',
    'ui.check',
    'ui.press_key',
    'ui.hover',
    'ui.switch_tab',
    'ui.scroll',
    'ui.wait_for',
    'ui.ask',
    'ui.hand_off',
    'ui.screenshot',
    'link.handoff',
    'link.return',
  ]);
});

test('the trace viewer shows the verified timeline of an embed conversation', async ({
  page,
}) => {
  await page.route('**/pagesquire/chat', async (route) => {
    const body = route.request().postDataJSON();
    const active = body.snapshot.targets.find(
      (target) => target.name === 'Active',
    );
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        protocolVersion: '0.1',
        conversationId: 'trace-conversation',
        response: body.result
          ? {
              protocolVersion: '0.1',
              text: 'Showing active tasks.',
              emotion: 'happy',
              finished: true,
              toolCalls: [],
            }
          : {
              protocolVersion: '0.1',
              text: 'Checking the requested action…',
              emotion: 'thinking',
              finished: false,
              toolCalls: [
                {
                  protocolVersion: '0.1',
                  callId: 'trace-call',
                  capabilityId: 'ui.click',
                  snapshotId: body.snapshot.id,
                  parameters: { target: active.id },
                },
              ],
            },
      }),
    });
  });
  await page.goto('/eval-todo.html');
  await page.waitForFunction(() => Boolean(window.PageSquire?.trace));
  await page.evaluate(() => window.PageSquire.client.send('Show active tasks'));
  const viewer = page.getByRole('region', { name: 'PageSquire trace' });
  await expect(viewer.getByRole('status')).toContainText(
    '2 requests, 1 actions (1 verified, 0 not), 0 errors',
  );
  await expect(viewer.locator('li[data-type="reply"]').first()).toContainText(
    'Model proposed ui.click',
  );
  await expect(viewer.locator('li[data-type="result"]')).toContainText(
    'Result ui.click: success VERIFIED',
  );
  await viewer.getByLabel('Show').selectOption('errors');
  await expect(viewer.locator('li')).toHaveCount(0);
});

test('targets on screen survive the target limit, so overlays stay visible to the model', async ({
  page,
}) => {
  await page.goto('/eval-shop.html');
  await page.waitForFunction(() => Boolean(window.PageSquire?.runtime));
  const snapshot = await page.evaluate(() =>
    window.PageSquire.runtime.observe(),
  );
  expect(snapshot.truncated.targets).toBe(true);
  const names = snapshot.targets.map((target) => target.name);
  expect(names).toContain('Accept cookies');
  expect(names).toContain('Reject cookies');
});

test('an Indonesian page gets Indonesian widget, approval and error text automatically', async ({
  page,
}) => {
  await page.route('**/pagesquire/chat', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'RATE_LIMITED' } }),
    }),
  );
  await page.goto('/embed-id.html');
  await page.waitForFunction(() => Boolean(window.PageSquire?.client));
  const widget = page.locator('.pagesquire-embed .pagesquire-widget');
  await expect(
    widget.getByLabel('Apa yang bisa saya bantu di halaman ini?'),
  ).toBeVisible();
  await expect(widget.getByRole('button', { name: 'Kirim' })).toBeVisible();
  await expect(
    widget.getByRole('button', { name: 'Percakapan baru' }),
  ).toBeVisible();
  await widget.getByRole('textbox').fill('Halo');
  await widget.getByRole('button', { name: 'Kirim' }).click();
  await expect(widget.getByRole('log')).toContainText('Kamu: Halo');
  await expect(widget.getByRole('log')).toContainText(
    'Batas penggunaan sudah tercapai',
  );
  const approval = page.evaluate(async () => {
    const { runtime } = window.PageSquire;
    const snapshot = runtime.observe();
    const save = snapshot.targets.find((target) => target.name === 'Simpan');
    return runtime.execute({
      protocolVersion: '0.1',
      callId: 'id-approval',
      capabilityId: 'ui.click',
      snapshotId: snapshot.id,
      parameters: { target: save.id },
    });
  });
  const prompt = page.getByRole('alertdialog', { name: 'Setujui aksi ini?' });
  await expect(prompt.getByRole('button', { name: 'Tolak' })).toBeFocused();
  await prompt.getByRole('button', { name: 'Tolak' }).click();
  expect((await approval).code).toBe('APPROVAL_DENIED');
});

test('the embed asks for streamed progress and completes a conversation from NDJSON', async ({
  page,
}) => {
  const accepts = [];
  await page.route('**/pagesquire/chat', async (route) => {
    accepts.push(route.request().headers().accept);
    const line = (event) => `${JSON.stringify(event)}\n`;
    await route.fulfill({
      contentType: 'application/x-ndjson; charset=utf-8',
      body:
        line({ type: 'progress', stage: 'accepted' }) +
        line({ type: 'progress', stage: 'thinking' }) +
        line({
          type: 'reply',
          reply: {
            protocolVersion: '0.1',
            conversationId: 'stream-conversation',
            response: {
              protocolVersion: '0.1',
              text: 'Streamed answer.',
              emotion: 'happy',
              finished: true,
              toolCalls: [],
            },
          },
        }),
    });
  });
  await page.goto('/embed.html');
  await page.waitForFunction(() => Boolean(window.PageSquire?.client));
  const widget = page.locator('.pagesquire-embed .pagesquire-widget');
  await widget.getByRole('textbox').fill('Hello');
  await widget.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(widget.getByRole('log')).toContainText('Streamed answer.');
  expect(accepts[0]).toContain('application/x-ndjson');
  await expect(widget.getByRole('status')).toContainText('Ready');
});
