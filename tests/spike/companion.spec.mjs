// Phase 4D-0 spike: feasibility checks for the companion extension design.
import { expect, percentile, record, test } from './fixtures.mjs';

const host = (url) => new URL(url).host;
const call = (tab, op, args) =>
  tab.evaluate(([op, args]) => window.spikeCall(op, args), [op, args]);
const act = (tab, selector, args) =>
  tab.evaluate(
    async ([selector, args]) =>
      window.spikeCall('act', { ...args, nonce: window.tag(selector) }),
    [selector, args],
  );
const attachWithFrames = async (tab, sites) => {
  const attached = await call(tab, 'attach');
  await expect
    .poll(async () => (await call(tab, 'frames')).map((f) => host(f.url)))
    .toEqual(
      expect.arrayContaining([
        host(sites.urls.partner),
        host(sites.urls.nested),
      ]),
    );
  return attached;
};

test('handshake, attach and recursive frame auto-attach', async ({
  tab,
  sites,
}) => {
  expect(await tab.evaluate(() => window.spikeHello())).toEqual({
    type: 'pagesquire:hello-ack',
    version: 0,
  });
  // Page scripts get no direct channel to the extension.
  expect(
    await tab.evaluate(() => typeof globalThis.chrome?.runtime?.sendMessage),
  ).toBe('undefined');
  const helloMs = await tab.evaluate(async () => {
    const started = performance.now();
    await window.spikeHello();
    return Math.round((performance.now() - started) * 10) / 10;
  });
  const started = Date.now();
  const attached = await attachWithFrames(tab, sites);
  const frames = await call(tab, 'frames');
  await record('attach', {
    helloMs,
    ...attached,
    framesReadyMs: Date.now() - started,
    frames: frames.map((f) => ({
      type: f.type,
      host: host(f.url),
      nested: Boolean(f.parent),
    })),
  });
  // The nested frame is attached through its parent's session.
  const nested = frames.find((f) => host(f.url) === host(sites.urls.nested));
  expect(nested.parent).toBe(
    frames.find((f) => host(f.url) === host(sites.urls.partner)).sessionId,
  );
});

test('trusted click, text and Enter reach the main frame', async ({ tab }) => {
  await call(tab, 'attach');
  expect(await act(tab, '#plain', { kind: 'click' })).toMatchObject({
    ok: true,
  });
  expect(
    await act(tab, '#plain-input', { kind: 'type', text: 'hello' }),
  ).toMatchObject({ ok: true });
  expect(await call(tab, 'act', { kind: 'key', key: 'Enter' })).toMatchObject({
    ok: true,
  });
  const below = await act(tab, '#below', { kind: 'click' });
  expect(below).toMatchObject({ ok: true });
  const log = await tab.evaluate(() => window.spikeLog);
  expect(
    log.map(({ id, type, trusted, value }) => ({ id, type, trusted, value })),
  ).toEqual([
    { id: 'plain', type: 'click', trusted: true, value: '' },
    { id: 'plain-input', type: 'input', trusted: true, value: 'hello' },
    { id: 'plain-input', type: 'keydown', trusted: true, value: 'hello' },
    { id: 'below', type: 'click', trusted: true, value: '' },
  ]);
});

test('React controlled inputs accept trusted text', async ({ tab }) => {
  await call(tab, 'attach');
  expect(
    await act(tab, '#react-input', { kind: 'type', text: 'ada' }),
  ).toMatchObject({ ok: true });
  expect(await act(tab, '#react-button', { kind: 'click' })).toMatchObject({
    ok: true,
  });
  await expect(tab.locator('#react-state')).toHaveText('ADA');
  await expect(tab.locator('#react-input')).toHaveValue('ADA');
  await expect(tab.locator('#react-button')).toHaveText('Clicked 1');
  expect(await tab.evaluate(() => window.reactLog)).toEqual([
    { type: 'change', trusted: true, value: 'ada' },
    { type: 'click', trusted: true },
  ]);
});

test('Vue v-model accepts trusted text', async ({ tab, sites }) => {
  test.skip(!sites.vue, 'Vue is not installed; set SPIKE_VUE_DIR.');
  await call(tab, 'attach');
  expect(
    await act(tab, '#vue-input', { kind: 'type', text: 'ada' }),
  ).toMatchObject({ ok: true });
  expect(await act(tab, '#vue-button', { kind: 'click' })).toMatchObject({
    ok: true,
  });
  await expect(tab.locator('#vue-state')).toHaveText('ada');
  await expect(tab.locator('#vue-button')).toHaveText('Clicked 1');
  expect(await tab.evaluate(() => window.vueLog)).toEqual([
    { type: 'model', value: 'ada' },
    { type: 'input', trusted: true },
    { type: 'click', trusted: true },
  ]);
});

test('covered and sensitive targets are refused before input', async ({
  tab,
}) => {
  await call(tab, 'attach');
  expect(await act(tab, '#covered', { kind: 'click' })).toMatchObject({
    ok: false,
    code: 'OBSCURED',
  });
  for (const selector of ['#secret', '#otp', '#private'])
    expect(await act(tab, selector, { kind: 'type', text: 'x' })).toMatchObject(
      {
        ok: false,
        code: 'TARGET_NOT_ALLOWED',
      },
    );
  expect(await tab.evaluate(() => window.spikeLog)).toEqual([]);
  await expect(tab.locator('#secret')).toHaveValue('');
});

test('cross-origin frames: read and act through child sessions', async ({
  tab,
  sites,
}) => {
  await attachWithFrames(tab, sites);
  const partner = host(sites.urls.partner);
  const nested = host(sites.urls.nested);

  const scripted = await call(tab, 'readFrames');
  const ax = await call(tab, 'axNames', { frame: partner });
  const axNested = await call(tab, 'axNames', { frame: nested });
  await record('frame-reading', {
    scriptingOrigins: scripted.map((f) => f.origin),
    axPartner: ax,
    axNested,
  });
  expect(ax).toEqual(expect.arrayContaining(['button: Frame button']));
  expect(axNested).toEqual(expect.arrayContaining(['button: Nested button']));

  const partnerFrame = tab.frames().find((f) => host(f.url()) === partner);
  const nestedFrame = tab.frames().find((f) => host(f.url()) === nested);
  const frameAct = (frame, args) => call(tab, 'act', { ...args, frame });
  expect(
    await frameAct(partner, { kind: 'click', nonce: 'frame-button' }),
  ).toMatchObject({ ok: true });
  expect(
    await frameAct(partner, { kind: 'type', nonce: 'frame-input', text: 'hi' }),
  ).toMatchObject({ ok: true });
  expect(
    await frameAct(nested, { kind: 'click', nonce: 'nested-button' }),
  ).toMatchObject({ ok: true });
  // Scrolling inside the frame changes its document offset too.
  expect(
    await frameAct(partner, { kind: 'click', nonce: 'frame-below' }),
  ).toMatchObject({ ok: true });
  expect(await partnerFrame.evaluate(() => window.frameLog)).toEqual([
    { id: 'frame-button', type: 'click', trusted: true, value: '' },
    { id: 'frame-input', type: 'input', trusted: true, value: 'hi' },
    { id: 'frame-below', type: 'click', trusted: true, value: '' },
  ]);
  expect(await nestedFrame.evaluate(() => window.frameLog)).toEqual([
    { id: 'nested-button', trusted: true },
  ]);

  // A frame owner covered in the parent must stop the click.
  await tab.evaluate(() => {
    const cover = document.createElement('div');
    const box = document.querySelector('#partner').getBoundingClientRect();
    Object.assign(cover.style, {
      position: 'fixed',
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    document.body.append(cover);
  });
  await partnerFrame.evaluate(() => scrollTo(0, 0));
  expect(
    await frameAct(partner, { kind: 'click', nonce: 'frame-button' }),
  ).toMatchObject({
    ok: false,
    code: 'OBSCURED',
  });
  expect(await partnerFrame.evaluate(() => window.frameLog.length)).toBe(3);
});

test('input latency compared with in-page synthetic clicks', async ({
  tab,
}) => {
  const cold = Date.now();
  await call(tab, 'attach');
  const first = await act(tab, '#plain', { kind: 'click' });
  const coldMs = Date.now() - cold;
  const endToEnd = [];
  const inWorker = [];
  for (let i = 0; i < 30; i++) {
    const result = await tab.evaluate(async () => {
      const started = performance.now();
      const result = await window.spikeCall('act', {
        kind: 'click',
        nonce: window.tag('#plain'),
      });
      return { ...result, total: performance.now() - started };
    });
    expect(result.ok).toBe(true);
    endToEnd.push(result.total);
    inWorker.push(result.timings.dispatch);
  }
  const synthetic = await tab.evaluate(() => {
    const times = [];
    for (let i = 0; i < 30; i++) {
      const started = performance.now();
      document.querySelector('#plain').click();
      times.push(performance.now() - started);
    }
    return times;
  });
  await record('latency', {
    coldAttachAndFirstClickMs: coldMs,
    firstClickTimings: first.timings,
    endToEndMs: {
      p50: percentile(endToEnd, 50),
      p95: percentile(endToEnd, 95),
    },
    workerMs: { p50: percentile(inWorker, 50), p95: percentile(inWorker, 95) },
    syntheticMs: {
      p50: percentile(synthetic, 50),
      p95: percentile(synthetic, 95),
    },
  });
  expect(percentile(endToEnd, 95)).toBeLessThan(500);
});

test('Chrome keeps the debugger attached across out-of-scope navigation', async ({
  tab,
  sw,
  sites,
}) => {
  await call(tab, 'attach');
  const tabId = await sw.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id,
    sites.urls.main,
  );
  await tab.goto(sites.urls.other);
  const attached = await sw.evaluate(
    async (tabId) =>
      (await chrome.debugger.getTargets()).find((t) => t.tabId === tabId)
        ?.attached,
    tabId,
  );
  await record('navigation', { stillAttachedAfterLeavingOrigin: attached });
  // So invariant 1 must be enforced by the extension itself.
  expect(attached).toBe(true);
});
