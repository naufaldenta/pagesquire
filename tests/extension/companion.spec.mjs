import {
  act,
  attached,
  expect,
  open,
  panel,
  raw,
  signatureFor,
  tabIdOf,
  test,
  vector,
} from './fixtures.mjs';

const inputs = (page) => page.evaluate(() => window.inputs);
const clear = (page) => page.evaluate(() => (window.inputs = []));

async function grant(ctx, sw, page) {
  const control = await panel(ctx, sw, await tabIdOf(sw, page.url()));
  await expect(control.locator('#endpoint')).toHaveText('/pagesquire/chat');
  await expect(control.locator('#features')).toHaveText('trustedInput');
  await control.locator('#allow').click();
  await expect(control.locator('#message')).toContainText('Allowed');
  return control;
}

test('real input starts only after the visitor allows the site', async ({
  ctx,
  sw,
  page,
  sites,
}) => {
  await open(page, sites.granted.url);
  expect(
    (await act(page, 'ui.check', { target: '@Dark mode', checked: true })).code,
  ).toBe('VERIFIED');
  expect(await inputs(page)).toEqual([
    { type: 'click', target: 'dark-mode', trusted: false },
  ]);

  const control = await grant(ctx, sw, page);
  await clear(page);
  expect(
    (await act(page, 'ui.check', { target: '@Dark mode', checked: false }))
      .code,
  ).toBe('VERIFIED');
  await expect(page.locator('#dark-mode')).toHaveAttribute(
    'aria-checked',
    'false',
  );
  expect(
    (
      await act(page, 'ui.type', {
        target: '@Your name',
        text: 'Ada',
        clear: true,
      })
    ).code,
  ).toBe('VERIFIED');
  await expect(page.locator('#greeting')).toHaveText('Hello, Ada');
  expect(
    (await act(page, 'ui.press_key', { target: '@Your name', key: 'Tab' }))
      .code,
  ).toBe('VERIFIED');
  expect(await page.evaluate(() => document.activeElement.id)).toBe('size');
  expect(await inputs(page)).toEqual([
    { type: 'click', target: 'dark-mode', trusted: true },
    { type: 'input', target: 'name', trusted: true },
    { type: 'keydown', target: 'name', trusted: true, key: 'Tab' },
  ]);

  // The local audit log names actions, never typed text.
  await expect(control.locator('#activity')).toContainText('type');
  await expect(control.locator('#activity')).not.toContainText('Ada');

  await control.locator('#revoke').click();
  await expect(control.locator('#allow')).toBeVisible();
  await clear(page);
  expect(
    (await act(page, 'ui.check', { target: '@Dark mode', checked: true })).code,
  ).toBe('VERIFIED');
  expect(await inputs(page)).toEqual([
    { type: 'click', target: 'dark-mode', trusted: false },
  ]);
});

test('the extension refuses reserved, covered and malformed targets by itself', async ({
  ctx,
  sw,
  page,
  sites,
}) => {
  await open(page, sites.granted.url);
  await grant(ctx, sw, page);
  await clear(page);
  // Correctly signed calls still never reach reserved or covered targets.
  const typing = (text) => ({
    kind: 'type',
    text,
    signature: signatureFor(page, 'ui.type', { text }),
  });
  const clicking = () => ({
    kind: 'click',
    signature: signatureFor(page, 'ui.click', {}),
  });
  expect(await raw(page, typing('hunter2'), '#password')).toEqual({
    id: 1,
    ok: false,
    code: 'TARGET_NOT_ALLOWED',
  });
  await page.evaluate(() =>
    document
      .querySelector('#user')
      .closest('form')
      .setAttribute('data-pagesquire-private', ''),
  );
  expect(await raw(page, typing('x'), '#user')).toMatchObject({
    code: 'TARGET_NOT_ALLOWED',
  });
  expect(await raw(page, clicking(), '#covered')).toMatchObject({
    code: 'OBSCURED',
  });
  expect(await raw(page, clicking())).toMatchObject({
    code: 'TARGET_MISSING',
  });
  expect(
    await raw(page, { kind: 'key', key: 'Escape' }, '#name'),
  ).toMatchObject({ code: 'BAD_REQUEST' });
  expect(await raw(page, typing('x'), '#dark-mode')).toMatchObject({
    code: 'TARGET_NOT_ALLOWED',
  });
  await expect(page.locator('#password')).toHaveValue('');
  expect(await inputs(page)).toEqual([]);
});

test('only calls the site signed, as signed and once, become real input', async ({
  ctx,
  sw,
  page,
  sites,
}) => {
  await open(page, sites.granted.url);
  await grant(ctx, sw, page);
  await clear(page);
  const refused = async (args) =>
    (await raw(page, { kind: 'type', text: 'Ada', ...args }, '#name')).code;
  expect(await refused({})).toBe('UNSIGNED');
  const other = `${vector.signature.slice(0, 10)}${vector.signature[10] === 'A' ? 'B' : 'A'}${vector.signature.slice(11)}`;
  expect(
    await refused({
      signature: {
        claims: signatureFor(page, 'ui.type', { text: 'Ada' }).claims,
        value: other,
      },
    }),
  ).toBe('BAD_SIGNATURE');
  expect(
    await refused({
      signature: signatureFor(
        page,
        'ui.type',
        { text: 'Ada' },
        {
          origin: sites.sameHost.url.replace('/companion.html', ''),
        },
      ),
    }),
  ).toBe('MISMATCH');
  expect(
    await refused({
      signature: signatureFor(page, 'ui.type', { text: 'Eve' }),
    }),
  ).toBe('MISMATCH');
  expect(await refused({ signature: signatureFor(page, 'ui.click', {}) })).toBe(
    'MISMATCH',
  );
  expect(
    await refused({
      signature: signatureFor(
        page,
        'ui.type',
        { text: 'Ada' },
        {
          now: Date.now() - 10 * 60_000,
        },
      ),
    }),
  ).toBe('EXPIRED');
  await expect(page.locator('#name')).toHaveValue('');

  const once = signatureFor(page, 'ui.type', { text: 'Ada' });
  expect(await refused({ signature: once })).toBeUndefined();
  await expect(page.locator('#name')).toHaveValue('Ada');
  expect(await refused({ signature: once })).toBe('REPLAYED');
  await expect(page.locator('#name')).toHaveValue('Ada');

  // An unsigned call from the page's own runtime keeps synthetic input.
  await clear(page);
  expect(
    (
      await act(
        page,
        'ui.check',
        { target: '@Dark mode', checked: true },
        false,
      )
    ).code,
  ).toBe('VERIFIED');
  expect(await inputs(page)).toEqual([
    { type: 'click', target: 'dark-mode', trusted: false },
  ]);
  const control = await panel(ctx, sw, await tabIdOf(sw, page.url()));
  await expect(control.locator('#activity')).toContainText('REPLAYED');
});

test('Escape and Stop hand input back to the page until the visitor resumes', async ({
  ctx,
  sw,
  page,
  sites,
}) => {
  await open(page, sites.granted.url);
  const control = await grant(ctx, sw, page);
  const tabId = await tabIdOf(sw, page.url());
  await act(page, 'ui.check', { target: '@Dark mode', checked: true });
  await expect.poll(() => attached(sw, tabId)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(control.locator('#resume')).toBeVisible();
  await expect.poll(() => attached(sw, tabId)).toBe(false);
  await clear(page);
  expect(
    (await act(page, 'ui.check', { target: '@Dark mode', checked: false }))
      .code,
  ).toBe('VERIFIED');
  expect((await inputs(page))[0]).toEqual({
    type: 'click',
    target: 'dark-mode',
    trusted: false,
  });

  await control.locator('#resume').click();
  await clear(page);
  await act(page, 'ui.check', { target: '@Dark mode', checked: true });
  expect((await inputs(page))[0]).toEqual({
    type: 'click',
    target: 'dark-mode',
    trusted: true,
  });

  await control.locator('#stop').click();
  await expect(control.locator('#message')).toContainText('Stopped');
  await expect.poll(() => attached(sw, tabId)).toBe(false);
  await expect(control.locator('#activity')).toContainText('stop');
});

test('the debugger detaches when idle and when the tab leaves the origin', async ({
  ctx,
  sw,
  page,
  sites,
}) => {
  await open(page, sites.granted.url);
  await grant(ctx, sw, page);
  const tabId = await tabIdOf(sw, page.url());
  // Long enough to see it attached even on a busy machine.
  await sw.evaluate(() => chrome.storage.local.set({ idleDetachMs: 4000 }));
  await act(page, 'ui.check', { target: '@Dark mode', checked: true });
  await expect.poll(() => attached(sw, tabId)).toBe(true);
  await expect.poll(() => attached(sw, tabId), { timeout: 10000 }).toBe(false);

  await sw.evaluate(() => chrome.storage.local.set({ idleDetachMs: 60000 }));
  await act(page, 'ui.check', { target: '@Dark mode', checked: false });
  await expect.poll(() => attached(sw, tabId)).toBe(true);
  await page.goto(sites.sameHost.url);
  await expect.poll(() => attached(sw, tabId)).toBe(false);
});

test('only the exact granted origin gets real input', async ({
  ctx,
  sw,
  page,
  sites,
}) => {
  await open(page, sites.granted.url);
  await grant(ctx, sw, page);
  // Same host, other port: the relay is injected but the worker declines.
  await open(page, sites.sameHost.url);
  expect(await raw(page, { kind: 'click' }, '#dark-mode')).toEqual({
    type: 'pagesquire:hello-nack',
  });
  await clear(page);
  await act(page, 'ui.check', { target: '@Dark mode', checked: true });
  expect((await inputs(page))[0]).toEqual({
    type: 'click',
    target: 'dark-mode',
    trusted: false,
  });
});

test('a site without a valid declaration cannot be allowed', async ({
  ctx,
  sw,
  page,
  sites,
}) => {
  await open(page, sites.invalid.url);
  const control = await panel(ctx, sw, await tabIdOf(sw, page.url()));
  await expect(control.locator('#errors')).toContainText('"endpoint"');
  await expect(control.locator('#allow')).toBeHidden();
});
