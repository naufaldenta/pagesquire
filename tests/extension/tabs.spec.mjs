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
} from './fixtures.mjs';

const tabs = (page) =>
  page.evaluate(() => window.PageSquire.runtime.observe().tabs ?? []);
const active = (sw, tabId) =>
  sw.evaluate(async (tabId) => (await chrome.tabs.get(tabId)).active, tabId);

async function grant(ctx, sw, page) {
  const control = await panel(ctx, sw, await tabIdOf(sw, page.url()));
  await control.locator('#allow').click();
  await expect(control.locator('#message')).toContainText('Allowed');
  await control.close();
}

/** The chat page opens the partner page of its own origin in a new tab. */
async function openMember(ctx, page) {
  const [member] = await Promise.all([
    ctx.waitForEvent('page'),
    page.evaluate(() => window.open('/partner.html')),
  ]);
  await member.waitForLoadState();
  await expect
    .poll(async () => (await tabs(page)).length, { timeout: 15000 })
    .toBe(1);
  return member;
}

test('a tab the page opens joins the session and takes real input', async ({
  ctx,
  sw,
  page,
  sites,
}) => {
  await open(page, sites.granted.url);
  await grant(ctx, sw, page);
  const member = await openMember(ctx, page);
  const [tab] = await tabs(page);
  expect(tab).toMatchObject({
    id: 'tab2',
    url: `${sites.granted.origin}/partner.html`,
    title: 'Partner booking',
  });
  expect(tab.text).toContain('Not booked');
  expect(tab.targets.map((target) => target.name)).toEqual(
    expect.arrayContaining(['Book a table', 'Booking note']),
  );
  expect(
    tab.targets.every((target) => target.id.startsWith('tab2-target-')),
  ).toBe(true);

  // Both tabs sit in one visible group.
  const [pageTab, memberTab] = [
    await tabIdOf(sw, page.url()),
    await tabIdOf(sw, member.url()),
  ];
  expect(
    await sw.evaluate(
      async ([a, b]) => {
        const [x, y] = await Promise.all([
          chrome.tabs.get(a),
          chrome.tabs.get(b),
        ]);
        return x.groupId !== -1 && x.groupId === y.groupId
          ? (await chrome.tabGroups.get(x.groupId)).title
          : null;
      },
      [pageTab, memberTab],
    ),
  ).toBe('PageSquire');

  await member.evaluate(() => (window.inputs = []));
  expect(
    await act(page, 'ui.click', { target: '@Book a table' }),
  ).toMatchObject({
    code: 'VERIFIED',
  });
  await expect(member.locator('#status')).toHaveText('Booked');
  expect(
    await act(page, 'ui.type', {
      target: '@Booking note',
      text: 'Window seat',
      clear: true,
    }),
  ).toMatchObject({ code: 'VERIFIED', evidence: { length: 11 } });
  await expect(member.locator('#note')).toHaveValue('Window seat');
  const received = await member.evaluate(() => window.inputs);
  expect(received).toEqual(
    expect.arrayContaining([
      { type: 'click', target: 'book', trusted: true },
      { type: 'input', target: 'note', trusted: true },
    ]),
  );
  expect(received.every((input) => input.trusted)).toBe(true);
  expect(JSON.stringify(await tabs(page))).not.toContain('Window seat');
  // The chat page's own targets keep working while another tab is in front.
  expect(
    (await act(page, 'ui.check', { target: '@Dark mode', checked: true })).code,
  ).toBe('VERIFIED');
  expect((await act(page, 'ui.click', { target: '@Partner terms' })).code).toBe(
    'LINK_NAVIGATION',
  );

  // Switching shows a tab to the visitor; tab1 is the chat page.
  expect((await act(page, 'ui.switch_tab', { tab: 'tab1' })).code).toBe(
    'VERIFIED',
  );
  expect(await active(sw, pageTab)).toBe(true);
  await expect.poll(async () => (await tabs(page))[0].active).toBe(false);
  expect((await act(page, 'ui.switch_tab', { tab: 'tab2' })).code).toBe(
    'VERIFIED',
  );
  expect(await active(sw, memberTab)).toBe(true);
  expect((await act(page, 'ui.switch_tab', { tab: 'tab3' })).code).toBe(
    'TARGET_MISSING',
  );
});

test('the visitor shares and unshares a tab; leaving the origin leaves the session', async ({
  ctx,
  sw,
  page,
  sites,
}) => {
  await open(page, sites.granted.url);
  await grant(ctx, sw, page);
  const other = await ctx.newPage();
  await other.goto(sites.granted.partner);
  // Same origin but neither opened by the page nor shared: not in the session.
  await page.waitForTimeout(500);
  expect(await tabs(page)).toEqual([]);

  const control = await panel(ctx, sw, await tabIdOf(sw, other.url()));
  await control.locator('#share').click();
  await expect
    .poll(async () => (await tabs(page)).length, { timeout: 15000 })
    .toBe(1);
  await expect(control.locator('#shared-tabs')).toContainText('tab2');
  await control.locator('#unshare').click();
  await expect
    .poll(async () => (await tabs(page)).length, { timeout: 15000 })
    .toBe(0);

  await control.locator('#share').click();
  await expect
    .poll(async () => (await tabs(page)).length, { timeout: 15000 })
    .toBe(1);
  await other.goto(sites.partner.url);
  await expect
    .poll(async () => (await tabs(page)).length, { timeout: 15000 })
    .toBe(0);
});

test('signatures bind tab targets, and Esc in a member tab stops the session', async ({
  ctx,
  sw,
  page,
  sites,
}) => {
  await open(page, sites.granted.url);
  await grant(ctx, sw, page);
  const member = await openMember(ctx, page);
  const [tab] = await tabs(page);
  const id = (name) => tab.targets.find((target) => target.name === name).id;
  const local = (name) => id(name).replace('tab2-', '');
  expect(
    await raw(page, {
      kind: 'click',
      frame: 'tab2',
      target: local('Send reminder'),
      signature: signatureFor(page, 'ui.click', { target: id('Book a table') }),
    }),
  ).toMatchObject({ ok: false, code: 'MISMATCH' });
  expect(
    await raw(page, {
      kind: 'switch',
      tab: 'tab1',
      signature: signatureFor(page, 'ui.switch_tab', { tab: 'tab2' }),
    }),
  ).toMatchObject({ ok: false, code: 'MISMATCH' });
  await expect(member.locator('#reminder')).not.toBeChecked();

  expect(
    await act(page, 'ui.check', { target: '@Send reminder', checked: true }),
  ).toMatchObject({ code: 'VERIFIED' });
  const memberTab = await tabIdOf(sw, member.url());
  await expect.poll(() => attached(sw, memberTab)).toBe(true);
  await member.keyboard.press('Escape');
  await expect.poll(() => attached(sw, memberTab)).toBe(false);
  await expect
    .poll(async () => (await tabs(page)).length, { timeout: 15000 })
    .toBe(0);
});
