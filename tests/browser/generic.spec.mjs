import { test, expect } from '@playwright/test';
import { validateActionResult, validateSnapshot } from '@pagesquire/protocol';

test.beforeEach(async ({ page }) => {
  await page.goto('/generic.html');
  await page.waitForFunction(() => Boolean(window.PageSquire?.runtime));
});

/** Runs one generic call; "@Name" values become that target's current id. */
function act(page, capabilityId, parameters = {}) {
  return page.evaluate(
    async ({ capabilityId, parameters }) => {
      const { runtime } = window.PageSquire;
      const snapshot = runtime.observe();
      const id = (name) =>
        snapshot.targets.find((target) => target.name === name)?.id ??
        'missing-target';
      const resolved = Object.fromEntries(
        Object.entries(parameters).map(([key, value]) => [
          key,
          typeof value === 'string' && value.startsWith('@')
            ? id(value.slice(1))
            : value,
        ]),
      );
      return runtime.execute({
        protocolVersion: '0.1',
        callId: crypto.randomUUID(),
        capabilityId,
        snapshotId: snapshot.id,
        parameters: resolved,
      });
    },
    { capabilityId, parameters },
  );
}
const observe = (page) =>
  page.evaluate(() => window.PageSquire.runtime.observe());
const byName = (snapshot, name) =>
  snapshot.targets.find((target) => target.name === name);

test('snapshots carry stable ids, element state, shadow DOM targets and diffs without field values', async ({
  page,
}) => {
  await page.locator('#name').fill('private-value-marker');
  const first = await observe(page);
  expect(validateSnapshot(first).valid).toBe(true);
  // The site echoes the name into its own text; targets never carry values.
  expect(JSON.stringify(first.targets)).not.toContain('private-value-marker');
  expect(byName(first, 'Your name')).toMatchObject({
    role: 'textbox',
    required: true,
    filled: true,
  });
  expect(byName(first, 'Size')).toMatchObject({ role: 'combobox' });
  expect(byName(first, 'Newsletter')).toMatchObject({
    role: 'checkbox',
    checked: false,
  });
  expect(byName(first, 'Dark mode')).toMatchObject({
    role: 'switch',
    checked: false,
  });
  expect(byName(first, 'More details')).toMatchObject({ expanded: false });
  expect(byName(first, 'Shadow action')).toBeTruthy();
  expect(byName(first, 'Password')).toBeUndefined();
  const second = await observe(page);
  expect(byName(second, 'Load more').id).toBe(byName(first, 'Load more').id);
  expect(second.targets.some((target) => target.new)).toBe(false);
  // Each result's observation is diffed against the snapshot the action used.
  const open = await act(page, 'ui.click', { target: '@Open dialog' });
  expect(open.code).toBe('VERIFIED');
  const opened = open.observation;
  expect(byName(opened, 'Close dialog').new).toBe(true);
  const close = await act(page, 'ui.click', { target: '@Close dialog' });
  expect(close.observation.removedTargets).toContain(
    byName(opened, 'Close dialog').id,
  );
});

test('typing, selecting and checking use realistic events and verify actual state', async ({
  page,
}) => {
  const typed = await act(page, 'ui.type', {
    target: '@Your name',
    text: 'Ana',
    clear: true,
  });
  expect(validateActionResult(typed).valid).toBe(true);
  expect(typed.code).toBe('VERIFIED');
  expect(typed.evidence).toEqual({ length: 3 });
  await expect(page.locator('#greeting')).toHaveText('Hello, Ana');
  expect(
    (await act(page, 'ui.select', { target: '@Size', option: 'Large' })).code,
  ).toBe('VERIFIED');
  await expect(page.locator('#size')).toHaveValue('l');
  const missing = await act(page, 'ui.select', {
    target: '@Size',
    option: 'Huge',
  });
  expect(missing.code).toBe('OPTION_MISSING');
  expect(missing.message).toContain('Small, Large');
  expect(
    (await act(page, 'ui.check', { target: '@Newsletter', checked: true }))
      .code,
  ).toBe('VERIFIED');
  await expect(page.locator('#newsletter')).toBeChecked();
  expect(
    (await act(page, 'ui.check', { target: '@Dark mode', checked: true })).code,
  ).toBe('VERIFIED');
  await expect(page.locator('#dark-mode')).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('actions wait for network and DOM to settle, and keys, shadow DOM and find work', async ({
  page,
}) => {
  const loaded = await act(page, 'ui.click', { target: '@Load more' });
  expect(loaded.code).toBe('VERIFIED');
  expect(loaded.evidence.responded).toBe(true);
  expect(byName(loaded.observation, 'Open item 3')).toMatchObject({
    new: true,
  });
  await act(page, 'ui.click', { target: '@Open dialog' });
  expect(
    (
      await act(page, 'ui.press_key', {
        target: '@Close dialog',
        key: 'Escape',
      })
    ).code,
  ).toBe('VERIFIED');
  await expect(page.locator('#dialog')).toBeHidden();
  const found = await act(page, 'ui.find', { query: 'shadow', role: '' });
  expect(found.evidence.matches).toEqual([
    expect.objectContaining({ name: 'Shadow action', role: 'button' }),
  ]);
  expect(
    (
      await page.evaluate(async (target) => {
        const { runtime } = window.PageSquire;
        const snapshot = runtime.observe();
        return runtime.execute({
          protocolVersion: '0.1',
          callId: 'shadow-click',
          capabilityId: 'ui.click',
          snapshotId: snapshot.id,
          parameters: { target },
        });
      }, found.evidence.matches[0].id)
    ).code,
  ).toBe('VERIFIED');
  await expect(page.locator('fixture-widget')).toHaveAttribute(
    'data-state',
    'done',
  );
  expect(
    (await act(page, 'ui.wait_for', { text: 'Item 3', state: 'visible' })).code,
  ).toBe('VERIFIED');
  expect((await act(page, 'ui.scroll', { direction: 'bottom' })).status).toBe(
    'success',
  );
});

test('native dialogs stay with the visitor and their question and answer become evidence', async ({
  page,
}) => {
  const asked = [];
  page.on('dialog', async (dialog) => {
    asked.push(dialog.message());
    await dialog.accept();
  });
  const result = await act(page, 'ui.click', { target: '@Reset form' });
  expect(result.code).toBe('VERIFIED');
  expect(result.evidence.dialog).toEqual({
    type: 'confirm',
    message: 'Reset the form?',
    answer: true,
  });
  expect(asked).toEqual(['Reset the form?']);
  expect(
    await page.evaluate(() => window.confirm.toString().includes('native')),
  ).toBe(true);
});

test('guarded mode refuses covered, out-of-region, credential and link targets', async ({
  page,
}) => {
  expect(
    (await act(page, 'ui.click', { target: '@Covered action' })).code,
  ).toBe('TARGET_COVERED');
  expect((await act(page, 'ui.click', { target: '@Footer action' })).code).toBe(
    'TARGET_NOT_ALLOWED',
  );
  expect((await act(page, 'ui.click', { target: '@Sign in' })).code).toBe(
    'TARGET_NOT_ALLOWED',
  );
  expect(
    (
      await act(page, 'ui.type', {
        target: '@User',
        text: 'someone',
        clear: true,
      })
    ).code,
  ).toBe('TARGET_NOT_ALLOWED');
  expect((await act(page, 'ui.click', { target: '@Other page' })).code).toBe(
    'LINK_NAVIGATION',
  );
  await expect(page).toHaveURL(/generic\.html$/);
});

test('submitting a form asks the visitor, and only approval submits it', async ({
  page,
}) => {
  await act(page, 'ui.type', {
    target: '@Your name',
    text: 'Ana',
    clear: true,
  });
  const denied = act(page, 'ui.click', { target: '@Save profile' });
  const prompt = page.getByRole('alertdialog');
  await expect(prompt).toContainText('Save profile');
  await prompt.getByRole('button', { name: 'Deny' }).click();
  expect(await denied).toMatchObject({
    status: 'cancelled',
    code: 'APPROVAL_DENIED',
  });
  await expect(page.locator('#saved')).toBeHidden();
  const approved = act(page, 'ui.click', { target: '@Save profile' });
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Approve' })
    .click();
  expect((await approved).code).toBe('VERIFIED');
  await expect(page.locator('#saved')).toBeVisible();
});
