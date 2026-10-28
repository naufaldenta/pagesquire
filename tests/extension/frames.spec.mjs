import {
  act,
  expect,
  open,
  panel,
  raw,
  signatureFor,
  tabIdOf,
  test,
} from './fixtures.mjs';

const frames = (page) =>
  page.evaluate(() => window.PageSquire.runtime.observe().frames ?? []);
const partnerFrame = (page, sites) =>
  page.frames().find((frame) => frame.url() === sites.partner.partner);

async function grant(ctx, sw, page, sites) {
  const control = await panel(ctx, sw, await tabIdOf(sw, page.url()));
  await expect(control.locator('#frames')).toHaveText(sites.partner.origin);
  // A payment provider's frame is never allowed, even when declared.
  await expect(control.locator('#frames-refused')).toContainText(
    'https://js.stripe.com',
  );
  await control.locator('#allow').click();
  await expect(control.locator('#granted-frames')).toContainText(
    sites.partner.origin,
  );
  await expect
    .poll(async () => (await frames(page)).length, { timeout: 15000 })
    .toBe(1);
  return control;
}

test('granted frames are read without field values and acted in with real input', async ({
  ctx,
  sw,
  page,
  sites,
}) => {
  await open(page, sites.framed.url);
  const partner = partnerFrame(page, sites);
  await partner.locator('#note').fill('private-note-marker');
  expect(await frames(page)).toEqual([]);

  await grant(ctx, sw, page, sites);
  const [frame] = await frames(page);
  expect(frame).toMatchObject({
    id: 'frame1',
    origin: sites.partner.origin,
    title: 'Partner booking',
  });
  expect(frame.text).toContain('Not booked');
  expect(frame.targets.map((target) => target.name)).toEqual(
    expect.arrayContaining([
      'Book a table',
      'Booking note',
      'Send reminder',
      'Partner terms',
    ]),
  );
  expect(
    frame.targets.every((target) => target.id.startsWith('frame1-target-')),
  ).toBe(true);
  // Field values and password fields never leave the frame.
  expect(JSON.stringify(frame)).not.toContain('private-note-marker');
  expect(JSON.stringify(frame)).not.toContain('Partner password');

  await partner.evaluate(() => (window.inputs = []));
  expect(
    await act(page, 'ui.click', { target: '@Book a table' }),
  ).toMatchObject({
    code: 'VERIFIED',
  });
  await expect(partner.locator('#status')).toHaveText('Booked');
  expect(
    await act(page, 'ui.type', {
      target: '@Booking note',
      text: 'Window seat',
      clear: true,
    }),
  ).toMatchObject({ code: 'VERIFIED', evidence: { length: 11 } });
  await expect(partner.locator('#note')).toHaveValue('Window seat');
  expect(
    (await act(page, 'ui.check', { target: '@Send reminder', checked: true }))
      .code,
  ).toBe('VERIFIED');
  await expect(partner.locator('#reminder')).toBeChecked();
  const received = await partner.evaluate(() => window.inputs);
  expect(received).toEqual(
    expect.arrayContaining([
      { type: 'click', target: 'book', trusted: true },
      { type: 'input', target: 'note', trusted: true },
      { type: 'click', target: 'reminder', trusted: true },
    ]),
  );
  expect(received.every((input) => input.trusted)).toBe(true);
  await expect
    .poll(async () => JSON.stringify(await frames(page)))
    .toContain('Booked');
  expect(JSON.stringify(await frames(page))).not.toContain('Window seat');

  // Links, sign-in forms and unsupported tools stay out of reach.
  expect((await act(page, 'ui.click', { target: '@Partner terms' })).code).toBe(
    'LINK_NAVIGATION',
  );
  expect(
    (
      await act(page, 'ui.type', {
        target: '@Partner user',
        text: 'ada',
        clear: true,
      })
    ).code,
  ).toBe('TARGET_NOT_ALLOWED');
  expect((await act(page, 'ui.hover', { target: '@Book a table' })).code).toBe(
    'UNSUPPORTED_TARGET',
  );
  await expect(partner.locator('#partner-user')).toHaveValue('');
});

test('signatures bind which frame target receives the input', async ({
  ctx,
  sw,
  page,
  sites,
}) => {
  await open(page, sites.framed.url);
  await grant(ctx, sw, page, sites);
  const [frame] = await frames(page);
  const id = (name) => frame.targets.find((target) => target.name === name).id;
  const local = (name) => id(name).replace('frame1-', '');
  const click = (name, signedFor) => ({
    kind: 'click',
    frame: 'frame1',
    target: local(name),
    signature: signatureFor(page, 'ui.click', { target: signedFor }),
  });
  expect(
    await raw(page, click('Send reminder', id('Book a table'))),
  ).toMatchObject({
    ok: false,
    code: 'MISMATCH',
  });
  // Page-target signatures cannot reach frames, nor frame signatures the page.
  expect(await raw(page, click('Book a table', 'target-raw'))).toMatchObject({
    code: 'MISMATCH',
  });
  expect(
    await raw(
      page,
      {
        kind: 'click',
        signature: signatureFor(page, 'ui.click', {
          target: id('Book a table'),
        }),
      },
      '#dark-mode',
    ),
  ).toMatchObject({ code: 'MISMATCH' });
  const partner = partnerFrame(page, sites);
  await expect(partner.locator('#reminder')).not.toBeChecked();
  await expect(partner.locator('#status')).toHaveText('Not booked');

  expect(
    await raw(page, click('Book a table', id('Book a table'))),
  ).toMatchObject({
    ok: true,
    effect: { stateChanged: false },
  });
  await expect(partner.locator('#status')).toHaveText('Booked');
  // Correctly signed, but a sign-in form inside the frame stays the visitor's.
  expect(
    await raw(page, {
      kind: 'type',
      text: 'ada',
      frame: 'frame1',
      target: local('Partner user'),
      signature: signatureFor(page, 'ui.type', {
        target: id('Partner user'),
        text: 'ada',
      }),
    }),
  ).toMatchObject({ code: 'TARGET_NOT_ALLOWED' });
});

test('undeclared frames are never read, and Stop hides granted ones', async ({
  ctx,
  sw,
  page,
  sites,
}) => {
  await open(page, sites.framed.url);
  const control = await grant(ctx, sw, page, sites);
  await page.waitForTimeout(500);
  expect((await frames(page)).map((frame) => frame.origin)).toEqual([
    sites.partner.origin,
  ]);
  await control.locator('#stop').click();
  await expect
    .poll(async () => (await frames(page)).length, { timeout: 15000 })
    .toBe(0);
  await control.locator('#resume').click();
  await expect
    .poll(async () => (await frames(page)).length, { timeout: 15000 })
    .toBe(1);
});
