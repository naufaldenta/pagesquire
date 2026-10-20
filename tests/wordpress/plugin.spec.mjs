import { test, expect } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://127.0.0.1:4177';
const endpoint = (suffix, fixture = false) =>
  `${origin}/?rest_route=/${fixture ? 'pagesquire-fixture' : 'pagesquire'}/v1/${suffix}`;
let config;
let ids;

async function login(page, reader = false) {
  await page.goto(`${origin}/wp-login.php`, { timeout: 30000 });
  await expect(page.locator('#user_login')).toBeVisible();
  await page
    .locator('#user_login')
    .fill(reader ? 'fixture-reader' : 'fixture-admin');
  await page
    .locator('#user_pass')
    .fill(
      reader ? 'pagesquire-reader-password' : 'pagesquire-fixture-password',
    );
  await page.locator('#wp-submit').click();
  await page.waitForURL(/wp-admin/, { timeout: 30000 });
}

async function call(page, suffix, body, options = {}) {
  return page.request.fetch(endpoint(suffix, options.fixture), {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      Origin: origin,
      'X-WP-Nonce': config.nonce,
      ...(options.headers ?? {}),
    },
    ...(body === undefined ? {} : { data: body }),
  });
}

async function dashboard(page) {
  await page.goto(`${origin}/wp-admin/admin.php?page=pagesquire`);
  config = await page
    .locator('#pagesquire-admin-config')
    .evaluate((element) => JSON.parse(element.textContent));
}

async function draft(page, navigation = false) {
  await page
    .getByLabel('HTTPS JSON provider endpoint')
    .fill('https://provider.example.test/v1/chat/completions');
  await page.getByLabel('Model identifier').fill('synthetic-model');
  for (const id of [ids.alpha, ids.beta])
    await page.locator(`[name=pageIds][value="${id}"]`).check();
  if (navigation)
    await page
      .locator('[name=capabilityIds][value="browser.navigate"]')
      .check();
  await page.getByRole('button', { name: 'Save draft and disable' }).click();
  await expect(page.locator('#pagesquire-admin-status')).toContainText(
    'Draft saved',
  );
}

async function inspect(page, navigation = false) {
  const inspector = await page.context().newPage();
  await inspector.goto(`${origin}/?page_id=${ids.alpha}&pagesquire_inspect=1`);
  await runChecks(inspector, 3);
  if (navigation) {
    await inspector
      .getByRole('button', { name: 'Verify navigation to PageSquire Beta' })
      .click();
    await inspector.waitForURL(
      (url) => url.searchParams.get('page_id') === String(ids.beta),
    );
    await runChecks(inspector, 4);
    await inspector
      .getByRole('button', { name: 'Verify navigation to PageSquire Alpha' })
      .click();
    await inspector.waitForURL(
      (url) => url.searchParams.get('page_id') === String(ids.alpha),
    );
    await runChecks(inspector, 4);
  } else {
    await inspector.goto(`${origin}/?page_id=${ids.beta}&pagesquire_inspect=1`);
    await runChecks(inspector, 3);
  }
  await inspector.close();
  await page.getByRole('button', { name: 'Refresh readiness' }).click();
  await expect(page.locator('#pagesquire-gaps')).toContainText(
    'current inspection results',
  );
}

async function runChecks(page, verified) {
  await expect(
    page.locator('.pagesquire-inspector [role=status]'),
  ).toContainText('Roots:');
  await page.getByRole('button', { name: 'Run adapter checks' }).click();
  await expect(
    page.locator('.pagesquire-inspector [role=status]'),
  ).toContainText(`verified: ${verified}.`);
  await expect(page.locator('main h1')).not.toHaveCSS(
    'color',
    'rgb(255, 0, 0)',
  );
}

async function enable(page, navigation = false) {
  await draft(page, navigation);
  await inspect(page, navigation);
  await page.getByLabel('Who can use the assistant?').selectOption('public');
  await page.locator('[name=consent]').check();
  await page.getByRole('button', { name: 'Enable verified assistant' }).click();
  await expect(page.locator('#pagesquire-admin-status')).toContainText(
    'Assistant enabled',
  );
}

test.beforeEach(async ({ page }) => {
  await page
    .context()
    .route('**/*', (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
  await login(page);
  await dashboard(page);
  const response = await call(page, 'reset', {}, { fixture: true });
  expect(response.ok()).toBe(true);
  ids = (await response.json()).pages;
  await dashboard(page);
});

test('unique database locks reject stale-cache collisions and protect the original owner', async ({
  page,
}) => {
  const response = await call(page, 'locks', {}, { fixture: true });
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({
    entered: false,
    busy: true,
    ownerProtected: true,
    released: true,
  });
});

test('provider presets fill endpoints, persist explicit compatibility controls and never make draft model calls', async ({
  page,
}) => {
  const selector = page.getByLabel('AI provider', { exact: true });
  await expect(selector.locator('option')).toHaveCount(16);
  expect(
    config.state.providers.find((preset) => preset.id === 'xai').tokenParameter,
  ).toBe('max_tokens');
  await selector.selectOption('groq');
  await expect(page.getByLabel('HTTPS JSON provider endpoint')).toHaveValue(
    'https://api.groq.com/openai/v1/chat/completions',
  );
  await page.getByLabel('Model identifier').fill('owner-selected-model');
  await page
    .getByLabel('Response mode', { exact: true })
    .selectOption('prompt');
  await page
    .getByLabel('Output-token field')
    .selectOption('max_completion_tokens');
  await page.getByRole('button', { name: 'Save draft and disable' }).click();
  await expect(page.locator('#pagesquire-admin-status')).toContainText(
    'Draft saved',
  );
  await dashboard(page);
  expect(config.state.settings.provider).toBe('groq');
  expect(config.state.settings.model).toBe('owner-selected-model');
  expect(config.state.settings.responseMode).toBe('prompt');
  expect(config.state.settings.tokenParameter).toBe('max_completion_tokens');
  expect(config.state.settings.enabled).toBe(false);
  expect(config.state.settings.apiKey).toBeUndefined();
  const invalid = await call(
    page,
    'settings',
    { provider: 'invented-provider' },
    { method: 'PUT' },
  );
  expect(invalid.status()).toBe(422);
  const unsafe = await call(
    page,
    'settings',
    { endpoint: 'http://localhost:20128/v1/chat/completions' },
    { method: 'PUT' },
  );
  expect(unsafe.status()).toBe(422);
  await selector.selectOption('qwen');
  await expect(page.getByLabel('HTTPS JSON provider endpoint')).toHaveValue('');
  await expect(page.getByLabel('Response mode', { exact: true })).toHaveValue(
    'preset',
  );
  const statistics = await call(page, 'state', undefined, { fixture: true });
  expect((await statistics.json()).calls).toBe(0);
});

test('installed ZIP completes five-step setup and verified full-document assistance', async ({
  page,
  browser,
}, testInfo) => {
  await expect(page.locator('.pagesquire-step')).toHaveCount(5);
  expect(config.state.settings.enabled).toBe(false);
  await enable(page, true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath('dashboard-desktop.png'),
    fullPage: true,
  });
  const guest = await browser.newContext();
  const visitor = await guest.newPage();
  const payloads = [];
  visitor.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      (new URL(request.url()).searchParams.get('rest_route') ?? '').endsWith(
        '/v1/chat',
      )
    )
      payloads.push(request.postDataJSON());
  });
  await visitor.addInitScript(() => {
    window.emotions = [];
    window.addEventListener('pagesquire:emotion', (event) =>
      window.emotions.push(event.detail),
    );
  });
  await visitor.goto(`${origin}/?page_id=${ids.alpha}`);
  await visitor.waitForFunction(() =>
    Boolean(window.pagesquireWordPress?.client),
  );
  const widget = visitor.locator('.pagesquire-widget');
  await widget
    .getByRole('textbox')
    .fill('Navigate, make headings red, highlight links and use bold');
  await widget.getByRole('button', { name: 'Send', exact: true }).click();
  await visitor.waitForURL(
    (url) => url.searchParams.get('page_id') === String(ids.beta),
    { timeout: 30000 },
  );
  await expect(widget).toHaveAttribute('aria-busy', 'false', {
    timeout: 30000,
  });
  await expect(widget.getByRole('log')).toContainText(
    'requested changes were verified',
  );
  await expect(visitor.locator('main h1')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(visitor.locator('#body-copy')).not.toHaveCSS(
    'color',
    'rgb(255, 0, 0)',
  );
  await expect(visitor.locator('#body-copy a')).toHaveCSS(
    'outline-style',
    'solid',
  );
  await expect(visitor.locator('main')).toHaveCSS('font-weight', '700');
  await expect(widget).toHaveAttribute('data-emotion', 'happy');
  expect(await visitor.evaluate(() => window.emotions)).toContain('thinking');
  expect(await visitor.evaluate(() => window.emotions.at(-1))).toBe('happy');
  await expect(widget.getByRole('log')).not.toContainText('Premature');
  expect(payloads).toHaveLength(5);
  for (const payload of payloads)
    expect(JSON.stringify(payload.snapshot)).not.toMatch(
      /private-section-secret|password-value-secret|textarea-value-secret|fixture-admin/,
    );
  const state = await (
    await call(page, 'state', undefined, { fixture: true })
  ).json();
  expect(state.calls).toBe(5);
  expect(JSON.parse(state.budget).attempts).toBe(5);
  await visitor.setViewportSize({ width: 360, height: 780 });
  const box = await visitor.locator('#pagesquire-widget').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  await expect(
    widget.getByRole('button', { name: 'Send', exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await visitor.screenshot({
    path: testInfo.outputPath('widget-mobile.png'),
    fullPage: true,
  });
  await visitor.reload();
  await visitor.waitForFunction(() =>
    Boolean(window.pagesquireWordPress?.client),
  );
  expect(
    (await (await call(page, 'state', undefined, { fixture: true })).json())
      .calls,
  ).toBe(5);
  await guest.close();
});

test('admin authorization, nonce, origin, scope and draft readiness fail closed', async ({
  page,
  browser,
}) => {
  const anonymous = await browser.newContext();
  const response = await anonymous.request.get(endpoint('context'));
  expect(response.status()).toBe(403);
  expect(
    (
      await call(page, 'context', undefined, {
        headers: { 'X-WP-Nonce': 'bad' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await call(page, 'context', undefined, {
        headers: { Origin: 'https://evil.test' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await call(page, 'settings', { enabled: true }, { method: 'PUT' })
    ).status(),
  ).toBe(422);
  for (const id of [ids.private, ids.protected, ids.draft]) {
    expect(
      (
        await call(page, 'settings', { pageIds: [id] }, { method: 'PUT' })
      ).status(),
    ).toBe(422);
  }
  expect(
    (
      await call(
        page,
        'settings',
        { apiKey: 'never-stored-over-http' },
        { method: 'PUT' },
      )
    ).status(),
  ).toBe(422);
  expect(
    (
      await anonymous.request.post(endpoint('session'), {
        headers: { Origin: origin },
        data: {},
      })
    ).status(),
  ).toBe(403);
  const reader = await anonymous.newPage();
  await login(reader, true);
  expect(
    (
      await anonymous.request.get(endpoint('context'), {
        headers: { Origin: origin, 'X-WP-Nonce': config.nonce },
      })
    ).status(),
  ).toBe(403);
  await anonymous.close();
});

test('AI integration ZIP contains bounded metadata and valid English setup skills, never secrets or bodies', async ({
  page,
}, testInfo) => {
  await draft(page);
  const response = await call(page, 'context');
  expect(response.headers()['cache-control']).toContain('no-store');
  const context = await response.json();
  expect(context.pages).toHaveLength(2);
  expect(context.pages[0].blocks.map((block) => block.name)).toContain(
    'core/paragraph',
  );
  expect(JSON.stringify(context)).not.toMatch(
    /Ordinary public|private-section-secret|value-secret|pagesquire-fixture-server-key|protected-page-secret|post_content|innerHTML|attrs|fixture-admin/,
  );
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export AI integration ZIP' }).click();
  const download = await downloadPromise;
  const archive = unzipSync(await readFile(await download.path()));
  expect(Object.keys(archive)).toHaveLength(7);
  expect(JSON.parse(strFromU8(archive['pagesquire.mapping.json']))).toEqual(
    context.mapping,
  );
  for (const host of ['.agents', '.claude']) {
    const skill = strFromU8(archive[`${host}/skills/assistant-setup/SKILL.md`]);
    expect(skill).toContain('name: assistant-setup');
    expect(skill).toContain('untrusted evidence');
    expect(skill).toContain('not website source code');
    const directory = testInfo.outputPath(host, 'skills/assistant-setup');
    await mkdir(path.join(directory, 'references'), { recursive: true });
    await writeFile(path.join(directory, 'SKILL.md'), skill);
    await writeFile(
      path.join(directory, 'references/context.json'),
      archive[`${host}/skills/assistant-setup/references/context.json`],
    );
  }
  expect(
    (await (await call(page, 'state', undefined, { fixture: true })).json())
      .calls,
  ).toBe(0);
});

test('mapping imports reject executable configuration and require fresh inspection', async ({
  page,
}) => {
  await enable(page);
  const mapping = (await (await call(page, 'context')).json()).mapping;
  for (const hostile of [
    { ...mapping, handler: 'eval("bad")' },
    { ...mapping, siteOrigin: 'https://evil.test' },
    { ...mapping, contentRoot: 'body' },
    { ...mapping, capabilityIds: ['wordpress.delete_posts'] },
  ]) {
    expect(
      (await call(page, 'mapping', hostile, { method: 'PUT' })).status(),
    ).toBe(422);
  }
  await page.locator('#pagesquire-import').setInputFiles({
    name: 'mapping.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(mapping)),
  });
  await expect(page.locator('#pagesquire-enabled-state')).toHaveText(
    'Assistant disabled',
  );
  expect((await (await call(page, 'admin')).json()).observations).toEqual([]);
  expect(
    (
      await call(page, 'settings', { enabled: true }, { method: 'PUT' })
    ).status(),
  ).toBe(422);
});

test('theme changes invalidate readiness and ambiguous roots never get adapter approval', async ({
  page,
}) => {
  await enable(page);
  await call(
    page,
    'control',
    { theme: 'pagesquire-ambiguous' },
    { fixture: true },
  );
  const inspector = await page.context().newPage();
  await inspector.goto(`${origin}/?page_id=${ids.alpha}&pagesquire_inspect=1`);
  await expect(inspector.locator('[role=status]')).toContainText('Roots: 2;');
  await inspector.getByRole('button', { name: 'Run adapter checks' }).click();
  await expect(inspector.locator('[role=status]')).toContainText(
    'verified: 0.',
  );
  expect((await call(page, 'session', {})).status()).toBe(403);
  expect(
    (await (await call(page, 'admin')).json()).gaps.length,
  ).toBeGreaterThan(0);
  await inspector.close();
});

test('core block theme can be inspected using the reviewed main root', async ({
  page,
}) => {
  await draft(page);
  await call(page, 'control', { theme: 'twentytwentyfive' }, { fixture: true });
  await inspect(page);
  expect((await (await call(page, 'context')).json()).site.theme.slug).toBe(
    'twentytwentyfive',
  );
});

test('provider failures consume durable global attempts and changing cookies does not reset the budget', async ({
  page,
  browser,
}) => {
  await enable(page);
  expect(
    (
      await call(page, 'settings', { dailyAttempts: 1 }, { method: 'PUT' })
    ).ok(),
  ).toBe(true);
  await call(page, 'control', { mode: 'failure' }, { fixture: true });
  for (let index = 0; index < 2; index++) {
    const guest = await browser.newContext();
    const visitor = await guest.newPage();
    await visitor.goto(`${origin}/?page_id=${ids.alpha}`);
    await visitor.waitForFunction(() =>
      Boolean(window.pagesquireWordPress?.client),
    );
    const widget = visitor.locator('.pagesquire-widget');
    await widget.getByRole('textbox').fill('Hello');
    await widget.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(widget).toHaveAttribute('aria-busy', 'false', {
      timeout: 20000,
    });
    await expect(widget.getByRole('log')).not.toContainText('secret upstream');
    await expect(widget.getByRole('log')).not.toContainText(
      'changes were verified',
    );
    await guest.close();
  }
  const state = await (
    await call(page, 'state', undefined, { fixture: true })
  ).json();
  expect(state.calls).toBe(1);
  expect(JSON.parse(state.budget).attempts).toBe(1);
});

test('public session requires Origin and chat requires its CSRF token and an approved snapshot URL', async ({
  page,
  browser,
}) => {
  await enable(page);
  const guest = await browser.newContext();
  expect(
    (await guest.request.post(endpoint('session'), { data: {} })).status(),
  ).toBe(403);
  expect(
    (
      await guest.request.post(endpoint('session'), {
        data: {},
        headers: { Origin: 'https://evil.test' },
      })
    ).status(),
  ).toBe(403);
  const session = await guest.request.post(endpoint('session'), {
    data: {},
    headers: { Origin: origin },
  });
  expect(session.ok()).toBe(true);
  const token = (await session.json()).csrfToken;
  const visitor = await guest.newPage();
  await visitor.goto(`${origin}/?page_id=${ids.alpha}`);
  await visitor.waitForFunction(() =>
    Boolean(window.pagesquireWordPress?.client),
  );
  const snapshot = await visitor.evaluate(() =>
    window.pagesquireWordPress.runtime.observe(),
  );
  const payload = {
    protocolVersion: '0.1',
    message: 'Hello',
    snapshot,
    capabilityIds: config.state.settings.mapping.capabilityIds,
  };
  const rejected = await guest.request.post(endpoint('chat'), {
    data: payload,
    headers: { Origin: origin },
  });
  expect(rejected.status()).toBe(403);
  expect((await rejected.json()).error.code).toBe('CSRF_MISMATCH');
  expect(
    (
      await guest.request.post(endpoint('chat'), {
        data: {
          ...payload,
          snapshot: { ...snapshot, url: `${origin}/wp-admin/` },
        },
        headers: { Origin: origin, 'X-CSRF-Token': token },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await guest.request.post(endpoint('chat'), {
        data: { ...payload, message: 'x'.repeat(200000) },
        headers: { Origin: origin, 'X-CSRF-Token': token },
      })
    ).status(),
  ).toBe(413);
  expect(
    (await (await call(page, 'state', undefined, { fixture: true })).json())
      .calls,
  ).toBe(0);
  await guest.close();
});

test('page-content changes and malformed observation reports invalidate approval without leaking content', async ({
  page,
}) => {
  await enable(page);
  const report = (await (await call(page, 'admin')).json()).observations[0];
  for (const invalid of [
    { ...report, rawHTML: '<input value="private">' },
    { ...report, rootCount: 2 },
    {
      ...report,
      verifiedCapabilityIds: [
        'accessibility.set_heading_color',
        'accessibility.set_heading_color',
      ],
    },
    { ...report, verifiedCapabilityIds: [{ code: 'eval' }] },
  ]) {
    expect((await call(page, 'observations', invalid)).status()).toBe(422);
  }
  expect(
    (
      await call(page, 'settings', { assistantName: '   ' }, { method: 'PUT' })
    ).status(),
  ).toBe(422);
  await call(page, 'control', { editPage: true }, { fixture: true });
  const context = await (await call(page, 'context')).json();
  expect(context.gaps.some((gap) => gap.includes('current, unambiguous'))).toBe(
    true,
  );
  expect(JSON.stringify(context)).not.toContain('Changed public fixture');
  expect((await call(page, 'session', {})).status()).toBe(403);
});

test('authenticated-reader access uses the reader nonce without granting administration', async ({
  page,
  browser,
}) => {
  await enable(page);
  expect(
    (
      await call(
        page,
        'settings',
        { access: 'authenticated' },
        { method: 'PUT' },
      )
    ).ok(),
  ).toBe(true);
  const context = await browser.newContext();
  expect(
    (
      await context.request.post(endpoint('session'), {
        data: {},
        headers: { Origin: origin },
      })
    ).status(),
  ).toBe(403);
  const reader = await context.newPage();
  await login(reader, true);
  await reader.goto(`${origin}/?page_id=${ids.alpha}`);
  await reader.waitForFunction(() =>
    Boolean(window.pagesquireWordPress?.client),
  );
  const nonce = await reader.evaluate(
    () => window.pagesquireWordPress.config.nonce,
  );
  expect(nonce).toBeTruthy();
  expect(
    (
      await context.request.get(endpoint('context'), {
        headers: { Origin: origin, 'X-WP-Nonce': nonce },
      })
    ).status(),
  ).toBe(403);
  const widget = reader.locator('.pagesquire-widget');
  await widget.getByRole('textbox').fill('Make headings red');
  await widget.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(widget).toHaveAttribute('aria-busy', 'false');
  await expect(reader.locator('main h1')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await context.close();
});

test('public bootstrap requests have an IP/site budget independent of cookies', async ({
  page,
  browser,
}) => {
  await enable(page);
  expect(
    (
      await call(
        page,
        'control',
        { freezeQuotaClock: true, resetRequestBudget: true },
        { fixture: true },
      )
    ).ok(),
  ).toBe(true);
  const guest = await browser.newContext();
  let last;
  for (let index = 0; index < 31; index++) {
    await guest.clearCookies();
    last = await guest.request.post(endpoint('session'), {
      data: {},
      headers: { Origin: origin },
    });
    if (index < 30) expect(last.status()).toBe(200);
  }
  expect(last.status()).toBe(429);
  expect(
    (
      await call(
        page,
        'control',
        { advanceQuotaClock: true },
        { fixture: true },
      )
    ).ok(),
  ).toBe(true);
  expect(
    (
      await guest.request.post(endpoint('session'), {
        data: {},
        headers: { Origin: origin },
      })
    ).status(),
  ).toBe(200);
  expect(
    (await (await call(page, 'state', undefined, { fixture: true })).json())
      .calls,
  ).toBe(0);
  await guest.close();
});

test('theme CSS overriding a requested color is unverified, never a successful adapter check', async ({
  page,
}) => {
  await draft(page);
  const inspector = await page.context().newPage();
  await inspector.goto(`${origin}/?page_id=${ids.alpha}&pagesquire_inspect=1`);
  await expect(inspector.locator('[role=status]')).toContainText('Roots: 1;');
  await inspector.addStyleTag({
    content: 'main h1, main h2 { color: #123456 !important; }',
  });
  await inspector.getByRole('button', { name: 'Run adapter checks' }).click();
  await expect(inspector.locator('[role=status]')).toContainText(
    'verified: 2.',
  );
  const reports = (await (await call(page, 'admin')).json()).observations;
  expect(
    reports.find((report) => report.pageId === ids.alpha).verifiedCapabilityIds,
  ).not.toContain('accessibility.set_heading_color');
  await inspector.close();
});

test('unknown model actions cannot mutate the page or produce a false success', async ({
  page,
  browser,
}) => {
  await enable(page);
  await call(page, 'control', { mode: 'invalid' }, { fixture: true });
  const guest = await browser.newContext();
  const visitor = await guest.newPage();
  await visitor.goto(`${origin}/?page_id=${ids.alpha}`);
  await visitor.waitForFunction(() =>
    Boolean(window.pagesquireWordPress?.client),
  );
  const widget = visitor.locator('.pagesquire-widget');
  await widget.getByRole('textbox').fill('Make headings red');
  await widget.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(widget).toHaveAttribute('aria-busy', 'false');
  await expect(visitor.locator('main h1')).not.toHaveCSS(
    'color',
    'rgb(255, 0, 0)',
  );
  await expect(widget.getByRole('log')).not.toContainText(
    'requested changes were verified',
  );
  expect(
    (await (await call(page, 'state', undefined, { fixture: true })).json())
      .calls,
  ).toBe(1);
  await guest.close();
});
