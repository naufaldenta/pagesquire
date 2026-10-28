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

async function grant(ctx, sw, page) {
  const control = await panel(ctx, sw, await tabIdOf(sw, page.url()));
  await control.locator('#allow').click();
  await expect(control.locator('#message')).toContainText('Allowed');
  return control;
}

/** Average colour of a CSS-pixel point of the page, read from the image. */
function sample(page, screenshot, x, y) {
  return page.evaluate(
    async ({ screenshot, x, y }) => {
      const image = new Image();
      image.src = `data:${screenshot.mediaType};base64,${screenshot.data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const scale = image.width / innerWidth;
      const pixel = context.getImageData(
        Math.round(x * scale),
        Math.round(y * scale),
        1,
        1,
      ).data;
      return (pixel[0] + pixel[1] + pixel[2]) / 3;
    },
    { screenshot, x, y },
  );
}

test('screenshots stay off until the visitor allows them, and fields are blacked out', async ({
  ctx,
  sw,
  page,
  sites,
}) => {
  await open(page, sites.shots.url);
  const control = await grant(ctx, sw, page);
  await expect(control.locator('#screenshots')).not.toBeChecked();
  expect(await act(page, 'ui.screenshot', { tab: 'tab1' })).toMatchObject({
    code: 'ACTION_FAILED',
    message: expect.stringContaining('Screenshots are off'),
  });

  await control.locator('#screenshots').check();
  await page.locator('#name').fill('private-value-marker');
  const result = await act(page, 'ui.screenshot', { tab: 'tab1' });
  expect(result).toMatchObject({
    code: 'VERIFIED',
    evidence: { tab: 'tab1' },
    screenshot: { mediaType: 'image/jpeg' },
  });
  const { screenshot } = result;
  expect(screenshot.width).toBeLessThanOrEqual(1024);
  expect(screenshot.data.length).toBeLessThanOrEqual(100000);
  expect(result.evidence).toMatchObject({
    width: screenshot.width,
    height: screenshot.height,
  });

  // The typed field is black; the heading next to it is not.
  const field = await page.locator('#name').boundingBox();
  expect(
    await sample(
      page,
      screenshot,
      field.x + field.width / 2,
      field.y + field.height / 2,
    ),
  ).toBeLessThan(40);
  const heading = await page.locator('h1').boundingBox();
  expect(
    await sample(page, screenshot, heading.x + 2, heading.y + heading.height),
  ).toBeGreaterThan(120);
  await expect(control.locator('#activity')).toContainText('screenshot');

  await control.locator('#screenshots').uncheck();
  expect((await act(page, 'ui.screenshot', { tab: 'tab1' })).code).toBe(
    'ACTION_FAILED',
  );
});

test('a site that does not declare screenshots never offers or takes them', async ({
  ctx,
  sw,
  page,
  sites,
}) => {
  await open(page, sites.granted.url);
  const control = await grant(ctx, sw, page);
  await expect(control.locator('#screenshots-row')).toBeHidden();
  // Without data-screenshots the tool is not even registered.
  expect((await act(page, 'ui.screenshot', { tab: 'tab1' })).code).toBe(
    'UNKNOWN_CAPABILITY',
  );
  // Signed or not, the extension refuses: the site did not declare them.
  expect(
    await raw(page, {
      kind: 'screenshot',
      tab: 'tab1',
      signature: signatureFor(page, 'ui.screenshot', { tab: 'tab1' }),
    }),
  ).toMatchObject({ ok: false, code: 'SCREENSHOTS_OFF' });
  expect(
    await raw(page, {
      kind: 'screenshot',
      tab: 'tab1',
      signature: signatureFor(page, 'ui.screenshot', { tab: 'tab2' }),
    }),
  ).toMatchObject({ ok: false, code: 'MISMATCH' });
});
