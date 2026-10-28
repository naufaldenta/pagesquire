// Phase 4D-0 spike: the "started debugging this browser" bar only exists in a
// headed browser. It takes height from every tab's viewport, so the page can
// measure it through innerHeight and resize events. Opt in with SPIKE_HEADED=1.
import { expect, record, test } from './fixtures.mjs';

test.use({ spikeLaunch: { headless: false, viewport: null } });

test('the debugging bar appears on attach and how it affects the page', async ({
  tab,
}) => {
  test.skip(!process.env.SPIKE_HEADED, 'Set SPIKE_HEADED=1 to open a window.');
  await tab.evaluate(() => {
    window.resizes = 0;
    addEventListener('resize', () => window.resizes++);
  });
  const height = () => tab.evaluate(() => innerHeight);
  const before = await height();
  const started = Date.now();
  await tab.evaluate(() => window.spikeCall('attach'));
  await expect.poll(height, { timeout: 5000 }).toBeLessThan(before);
  const barShownMs = Date.now() - started;
  const attached = await height();

  const detachStarted = Date.now();
  await tab.evaluate(() => window.spikeCall('detach'));
  let barHiddenMs = null;
  try {
    await expect.poll(height, { timeout: 8000 }).toBe(before);
    barHiddenMs = Date.now() - detachStarted;
  } catch {}

  // Per-turn attach: several short turns in a row.
  const resizesBefore = await tab.evaluate(() => window.resizes);
  const cycleHeights = [];
  for (let i = 0; i < 4; i++) {
    await tab.evaluate(() => window.spikeCall('attach'));
    await tab.waitForTimeout(400);
    await tab.evaluate(() => window.spikeCall('detach'));
    await tab.waitForTimeout(400);
    cycleHeights.push(await height());
  }
  await tab.waitForTimeout(3000);
  await record('debugging-bar', {
    innerHeight: { before, attached, barHeight: before - attached },
    barShownMs,
    barHiddenMs,
    cycleHeights,
    resizesDuringFourTurns:
      (await tab.evaluate(() => window.resizes)) - resizesBefore,
    finalHeight: await height(),
  });
});
