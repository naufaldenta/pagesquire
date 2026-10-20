import { test, expect } from '@playwright/test';
import { validateActionResult, validateSnapshot } from '@pagesquire/protocol';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.pagesquireDemo));
});

async function action(page, capabilityId, parameters = {}) {
  return page.evaluate(
    ({ capabilityId, parameters }) =>
      window.pagesquireDemo.call(capabilityId, parameters),
    { capabilityId, parameters },
  );
}

test('heading color affects headings only and opens its hidden parent panel', async ({
  page,
}) => {
  const bodyColor = await page
    .locator('#body-copy')
    .evaluate((element) => getComputedStyle(element).color);
  await expect(page.locator('#accessibility-panel')).toBeHidden();
  const result = await action(page, 'accessibility.set_heading_color', {
    color: '#ff0000',
  });
  expect(result.status).toBe('success');
  expect(validateActionResult(result).valid).toBe(true);
  await expect(page.locator('main h1')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(page.locator('#body-copy')).toHaveCSS('color', bodyColor);
  await expect(page.locator('#accessibility-panel')).toBeVisible();
  await action(page, 'accessibility.set_heading_color', { color: '#0000ff' });
  await expect(page.locator('main h1')).toHaveCSS('color', 'rgb(0, 0, 255)');
});

test('repeated highlighting is idempotent and font weight uses the registered control', async ({
  page,
}) => {
  for (let index = 0; index < 2; index++) {
    expect(
      (
        await action(page, 'accessibility.set_link_highlight', {
          enabled: true,
        })
      ).status,
    ).toBe('success');
    await expect(page.locator('main')).toHaveClass('links-highlighted');
  }
  expect(
    (await action(page, 'accessibility.set_font_weight', { weight: 700 }))
      .status,
  ).toBe('success');
  await expect(page.locator('body')).toHaveCSS('font-weight', '700');
  await action(page, 'accessibility.set_link_highlight', { enabled: false });
  await expect(page.locator('main')).not.toHaveClass('links-highlighted');
});

test('invalid capability parameters cannot open a panel or mutate styles', async ({
  page,
}) => {
  const result = await action(page, 'accessibility.set_heading_color', {
    color: 'red',
  });
  expect(result.code).toBe('INVALID_PARAMETERS');
  await expect(page.locator('#accessibility-panel')).toBeHidden();
  await expect(page.locator('main h1')).not.toHaveCSS(
    'color',
    'rgb(255, 0, 0)',
  );
});

test('observation excludes secrets, field values, hidden content, and assistant UI', async ({
  page,
}) => {
  await page.locator('#search').fill('typed-secret');
  const snapshot = await page.evaluate(() =>
    window.pagesquireDemo.runtime.observe(),
  );
  expect(validateSnapshot(snapshot).valid).toBe(true);
  const serialized = JSON.stringify(snapshot);
  for (const secret of [
    'private-section-secret',
    'password-secret',
    'textarea-secret',
    'typed-secret',
    'hidden-text-secret',
    'Private control',
    'Make headings red',
  ]) {
    expect(serialized).not.toContain(secret);
  }
  expect(
    snapshot.targets.find((target) => target.name === 'Unregistered action')
      .actionable,
  ).toBe(false);
  expect(
    snapshot.targets.find((target) => target.name === 'External reference')
      .href,
  ).toBeUndefined();
});

test('observation reports truncation and defaults to denying interactions', async ({
  page,
}) => {
  const snapshot = await page.evaluate(() => {
    const Observer = window.pagesquireDemo.observer.constructor;
    return new Observer({
      document,
      maxTextLength: 30,
      maxTargets: 2,
    }).observe();
  });
  expect(snapshot.text.length).toBeLessThanOrEqual(30);
  expect(snapshot.targets).toHaveLength(2);
  expect(snapshot.truncated).toEqual({ text: true, targets: true });
  expect(snapshot.targets.every((target) => target.actionable === false)).toBe(
    true,
  );
});

test('a permitted click produces an observable event and replay executes only once', async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const demo = window.pagesquireDemo;
    const snapshot = demo.runtime.observe();
    const target = snapshot.targets.find(
      (item) => item.name === 'Count an interaction',
    );
    const call = {
      protocolVersion: '0.1',
      callId: 'click-once',
      capabilityId: 'browser.click',
      snapshotId: snapshot.id,
      parameters: { targetId: target.id },
    };
    return Promise.all([
      demo.runtime.execute(call),
      demo.runtime.execute(call),
    ]);
  });
  expect(results.every((result) => result.status === 'success')).toBe(true);
  await expect(page.locator('#click-count')).toHaveText('1');
});

test('reusing a call ID for a different action is rejected', async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const demo = window.pagesquireDemo;
    const call = demo.makeCall(
      'accessibility.set_link_highlight',
      { enabled: true },
      'same-id',
    );
    const first = await demo.runtime.execute(call);
    const second = await demo.runtime.execute({
      ...call,
      parameters: { enabled: false },
    });
    return [first, second];
  });
  expect(results[0].status).toBe('success');
  expect(results[1].code).toBe('CALL_ID_REUSED');
  await expect(page.locator('main')).toHaveClass('links-highlighted');
});

test('unregistered and disabled controls never gain permission from being visible', async ({
  page,
}) => {
  for (const name of ['Unregistered action', 'Disabled action']) {
    const result = await page.evaluate(async (name) => {
      const demo = window.pagesquireDemo;
      const snapshot = demo.runtime.observe();
      const target = snapshot.targets.find((item) => item.name === name);
      return demo.runtime.execute({
        protocolVersion: '0.1',
        callId: crypto.randomUUID(),
        capabilityId: 'browser.click',
        snapshotId: snapshot.id,
        parameters: { targetId: target.id },
      });
    }, name);
    expect(result.code).toBe('TARGET_NOT_ALLOWED');
  }
  await expect(page.locator('#click-count')).toHaveText('0');
});

test('filling a permitted input dispatches an actual input event without returning its value', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const demo = window.pagesquireDemo;
    const snapshot = demo.runtime.observe();
    const target = snapshot.targets.find(
      (item) => item.name === 'Search this example',
    );
    return demo.runtime.execute({
      protocolVersion: '0.1',
      callId: 'fill-once',
      capabilityId: 'browser.fill',
      snapshotId: snapshot.id,
      parameters: { targetId: target.id, value: 'private-query-value' },
    });
  });
  expect(result.status).toBe('success');
  expect(JSON.stringify(result)).not.toContain('private-query-value');
  await expect(page.locator('#search')).toHaveValue('private-query-value');
  await expect(page.locator('#input-events')).toHaveText('1');
});

test('stale snapshots and detached targets require a fresh observation', async ({
  page,
}) => {
  const staleSnapshot = await page.evaluate(async () => {
    const demo = window.pagesquireDemo;
    const call = demo.makeCall('accessibility.set_link_highlight', {
      enabled: true,
    });
    demo.runtime.observe();
    return demo.runtime.execute(call);
  });
  expect(staleSnapshot.code).toBe('STALE_SNAPSHOT');
  const detached = await page.evaluate(async () => {
    const demo = window.pagesquireDemo;
    const snapshot = demo.runtime.observe();
    const target = snapshot.targets.find(
      (item) => item.name === 'Count an interaction',
    );
    const element = document.querySelector('#allowed-button');
    element.replaceWith(element.cloneNode(true));
    return demo.runtime.execute({
      protocolVersion: '0.1',
      callId: 'stale-target',
      capabilityId: 'browser.click',
      snapshotId: snapshot.id,
      parameters: { targetId: target.id },
    });
  });
  expect(detached.code).toBe('STALE_TARGET');
  await expect(page.locator('#click-count')).toHaveText('0');
});

test('changed target names and ambiguous adapter selectors are rejected', async ({
  page,
}) => {
  const changed = await page.evaluate(async () => {
    const demo = window.pagesquireDemo;
    const snapshot = demo.runtime.observe();
    const target = snapshot.targets.find(
      (item) => item.name === 'Count an interaction',
    );
    document.querySelector('#allowed-button').textContent =
      'Different operation';
    return demo.runtime.execute({
      protocolVersion: '0.1',
      callId: 'changed-target',
      capabilityId: 'browser.click',
      snapshotId: snapshot.id,
      parameters: { targetId: target.id },
    });
  });
  expect(changed.code).toBe('STALE_TARGET');
  expect((await action(page, 'testing.ambiguous')).code).toBe(
    'AMBIGUOUS_TARGET',
  );
});

test('unknown and consequential capabilities are rejected before their handlers run', async ({
  page,
}) => {
  expect((await action(page, 'not.available')).code).toBe('UNKNOWN_CAPABILITY');
  expect((await action(page, 'testing.consequential')).code).toBe(
    'CONFIRMATION_REQUIRED',
  );
  expect(
    await page.locator('body').getAttribute('data-unexpected-mutation'),
  ).toBeNull();
});

test('failed postconditions are unverified and unexpected handler errors are redacted', async ({
  page,
}) => {
  const unverified = await action(page, 'testing.unverified');
  expect(unverified.status).toBe('unverified');
  expect(unverified.code).toBe('POSTCONDITION_FAILED');
  const failed = await action(page, 'testing.secret_failure');
  expect(failed.code).toBe('HANDLER_FAILED');
  expect(JSON.stringify(failed)).not.toContain('super-secret-provider-key');
});

test('cancellation ends a cooperative action and restores idle activity', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const demo = window.pagesquireDemo;
    const call = demo.makeCall('testing.wait', { milliseconds: 1000 });
    const pending = demo.runtime.execute(call);
    const started = demo.runtime.activity;
    setTimeout(() => demo.runtime.cancel(), 10);
    return {
      started,
      result: await pending,
      ended: demo.runtime.activity,
      activities: demo.activities,
    };
  });
  expect(result.started).toBe('thinking');
  expect(result.result.status).toBe('cancelled');
  expect(result.ended).toBe('idle');
  expect(result.activities).toContain('thinking');
});

test('external abort signals and timeouts return distinct bounded results', async ({
  page,
}) => {
  const cancelled = await page.evaluate(async () => {
    const demo = window.pagesquireDemo;
    const call = demo.makeCall('testing.wait', { milliseconds: 1000 });
    const controller = new AbortController();
    controller.abort();
    return demo.runtime.execute(call, { signal: controller.signal });
  });
  expect(cancelled.status).toBe('cancelled');
  await page.evaluate(() => window.pagesquireDemo.configure({ timeoutMs: 20 }));
  const timedOut = await action(page, 'testing.wait', { milliseconds: 1000 });
  expect(timedOut.status).toBe('failed');
  expect(timedOut.code).toBe('TIMEOUT');
});

test('busy requests do not invalidate the active snapshot and action limits are enforced', async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const demo = window.pagesquireDemo;
    const call = demo.makeCall('testing.wait', { milliseconds: 40 }, 'first');
    const pending = demo.runtime.execute(call);
    const busy = await demo.runtime.execute({ ...call, callId: 'second' });
    const snapshotIntact =
      demo.observer.requireSnapshot(call.snapshotId).id === call.snapshotId;
    return { first: await pending, busy, snapshotIntact };
  });
  expect(results.busy.code).toBe('BUSY');
  expect(results.busy.observation).toBeUndefined();
  expect(results.snapshotIntact).toBe(true);
  expect(results.first.status).toBe('success');
  await page.evaluate(() => window.pagesquireDemo.configure({ maxActions: 1 }));
  expect((await action(page, 'testing.wait', { milliseconds: 0 })).status).toBe(
    'success',
  );
  expect((await action(page, 'testing.wait', { milliseconds: 0 })).code).toBe(
    'ACTION_LIMIT',
  );
});

test('navigation rejects foreign origins, schemes, private query keys, and disallowed paths', async ({
  page,
}) => {
  for (const url of [
    'https://example.net/',
    'javascript:alert(1)',
    '/admin',
    '/next.html?token=secret',
    '/next.html#access_token=secret',
    '/next.html#/%61ccess_token=secret',
  ]) {
    expect((await action(page, 'browser.navigate', { url })).code).toBe(
      'URL_NOT_ALLOWED',
    );
  }
  expect(new URL(page.url()).pathname).toBe('/');
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('pagesquire:navigation:0.1'),
    ),
  ).toBeNull();
});

test('sensitive fragments block observation before a snapshot can be sent to a provider', async ({
  page,
}) => {
  const blocked = await page.evaluate(() => {
    history.replaceState({}, '', '/#access_token=synthetic-secret');
    let constructorBlocked = false;
    try {
      new window.pagesquireDemo.observer.constructor({ document });
    } catch (error) {
      constructorBlocked = error.code === 'URL_NOT_ALLOWED';
    }
    try {
      window.pagesquireDemo.observer.observe();
      return false;
    } catch (error) {
      return constructorBlocked && error.code === 'URL_NOT_ALLOWED';
    } finally {
      history.replaceState({}, '', '/');
    }
  });
  expect(blocked).toBe(true);
  const safe = await page.evaluate(() => {
    history.replaceState({}, '', '/#section');
    return window.pagesquireDemo.observer.observe().url;
  });
  expect(safe).toContain('#section');
});

test('full document navigation resumes verification exactly once without executing navigation again', async ({
  page,
}) => {
  await Promise.all([
    page.waitForURL('**/next.html'),
    page.getByRole('button', { name: 'Navigate and resume' }).click(),
  ]);
  await page.waitForFunction(() => Boolean(window.pagesquireDemo));
  const resumed = await page.evaluate(() => window.pagesquireDemo.resumed);
  expect(resumed.status).toBe('success');
  expect(validateActionResult(resumed).valid).toBe(true);
  await expect(page.locator('#destination')).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('pagesquire:navigation:0.1'),
    ),
  ).toBeNull();
  await page.reload();
  await page.waitForFunction(() => Boolean(window.pagesquireDemo));
  expect(
    await page.evaluate(() => window.pagesquireDemo.resumed),
  ).toBeUndefined();
});

test('a mismatched navigation checkpoint is consumed without redirecting or reporting success', async ({
  page,
}) => {
  await page.evaluate(() =>
    sessionStorage.setItem(
      'pagesquire:navigation:0.1',
      JSON.stringify({
        protocolVersion: '0.1',
        callId: 'pending',
        expectedUrl: `${location.origin}/next.html`,
        origin: location.origin,
        issuedAt: Date.now(),
      }),
    ),
  );
  await page.reload();
  await page.waitForFunction(() => Boolean(window.pagesquireDemo));
  const resumed = await page.evaluate(() => window.pagesquireDemo.resumed);
  expect(resumed.status).toBe('failed');
  expect(resumed.code).toBe('NAVIGATION_MISMATCH');
  expect(new URL(page.url()).pathname).toBe('/');
});

test('a host-supplied SPA adapter waits for the destination state without a storage checkpoint', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const demo = window.pagesquireDemo;
    const Runtime = demo.runtime.constructor;
    const runtime = new Runtime({
      observer: demo.observer,
      registry: demo.registry,
      navigation: {
        mode: 'spa',
        navigate: async (url, signal) => {
          signal.throwIfAborted();
          history.pushState({}, '', url.href);
          await new Promise(requestAnimationFrame);
          document.querySelector('#destination').hidden = false;
        },
      },
    });
    const snapshot = runtime.observe();
    return runtime.execute({
      protocolVersion: '0.1',
      callId: 'spa-navigation',
      capabilityId: 'browser.navigate',
      snapshotId: snapshot.id,
      parameters: { url: '/next.html' },
    });
  });
  expect(result.status).toBe('success');
  await expect(page.locator('#destination')).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('pagesquire:navigation:0.1'),
    ),
  ).toBeNull();
});

test('the bundled runtime works under CSP without unsafe-eval or external scripts', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.reload();
  await page.waitForFunction(() => Boolean(window.pagesquireDemo));
  const csp = response.headers()['content-security-policy'];
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain('unsafe-eval');
  expect(
    (
      await action(page, 'accessibility.set_heading_color', {
        color: '#ff0000',
      })
    ).status,
  ).toBe('success');
  expect(errors).toEqual([]);
});
