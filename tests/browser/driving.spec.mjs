import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/driving.html');
  await page.waitForFunction(() => Boolean(window.pagesquireDriving));
});
const action = (page, id, parameters) =>
  page.evaluate(
    ({ id, parameters }) => window.pagesquireDriving.call(id, parameters),
    { id, parameters },
  );

test('driving: open article, scan, read and summarize in order with actual verified public text', async ({
  page,
}) => {
  await page.locator('#open-summary').click();
  await expect(page.locator('.pagesquire-driving')).toBeVisible();
  await page.waitForFunction(() =>
    window.pagesquireDriving.client.state.messages.some((message) =>
      message.text.includes('Synthetic summary'),
    ),
  );
  const state = await page.evaluate(() => ({
    results: window.pagesquireDriving.results,
    opens: window.pagesquireDriving.opens,
    requests: window.pagesquireDriving.requests,
    emotions: window.pagesquireDriving.emotions,
  }));
  expect(state.results.map((result) => result.capabilityId)).toEqual([
    'content.open',
    'page.read',
  ]);
  expect(state.results.every((result) => result.status === 'success')).toBe(
    true,
  );
  expect(state.results[1].evidence.text).toContain('more shaded seating');
  expect(JSON.stringify(state.results)).not.toMatch(
    /private-article-secret|private-form-value|private-textarea-secret/,
  );
  expect(state.opens).toBe(1);
  expect(state.requests).toBe(3);
  expect(state.emotions).toContain('thinking');
  expect(state.emotions.at(-1)).toBe('happy');
  await expect(page.locator('.pagesquire-driving')).toHaveCount(0);
});

test('driving: control preparation opens the actual parent and desired state is idempotent', async ({
  page,
}) => {
  const before = await page
    .locator('#guide p')
    .evaluate((element) => getComputedStyle(element).color);
  await page.evaluate(() => {
    window.inputCount = 0;
    document
      .querySelector('#driver-heading-color')
      .addEventListener('input', () => window.inputCount++);
  });
  for (let index = 0; index < 2; index++)
    expect(
      (
        await action(page, 'accessibility.set_heading_color', {
          color: '#c52b28',
        })
      ).status,
    ).toBe('success');
  await expect(page.locator('#settings')).toHaveAttribute('open', '');
  await expect(page.locator('#guide h2')).toHaveCSS(
    'color',
    'rgb(197, 43, 40)',
  );
  await expect(page.locator('#guide p')).toHaveCSS('color', before);
  expect(await page.evaluate(() => window.inputCount)).toBe(1);
});

test('driving: invalid parameters or hidden content never start presentation or reading', async ({
  page,
}) => {
  expect(
    (await action(page, 'accessibility.set_heading_color', { color: 'red' }))
      .code,
  ).toBe('INVALID_PARAMETERS');
  expect(
    (
      await action(page, 'page.read', {
        scope: 'article',
        mode: 'summary',
        offset: 0,
      })
    ).code,
  ).toBe('TARGET_MISSING');
  expect(
    (
      await action(page, 'page.read', {
        scope: '#private',
        mode: 'summary',
        offset: 0,
      })
    ).code,
  ).toBe('INVALID_PARAMETERS');
  await expect(page.locator('#settings')).not.toHaveAttribute('open', '');
  await expect(page.locator('.pagesquire-driving')).toHaveCount(0);
});

test('driving: reading reports truncation and supports bounded explicit continuation without private text', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.textContent = 'Public chunk. '.repeat(1600);
    document.querySelector('#guide').append(p);
  });
  const first = await action(page, 'page.read', {
    scope: 'guide',
    mode: 'summary',
    offset: 0,
  });
  expect(first.evidence.truncated).toBe(true);
  expect(first.evidence.complete).toBe(false);
  expect(first.evidence.nextOffset).toBe(12000);
  const second = await action(page, 'page.read', {
    scope: 'guide',
    mode: 'summary',
    offset: 12000,
  });
  expect(second.evidence.truncated).toBe(false);
  expect(second.evidence.nextOffset).toBeNull();
  expect(second.evidence.complete).toBe(false);
  const full = await page.evaluate(() =>
    window.pagesquireDriving.observer.readContent(
      document.querySelector('#guide'),
      24000,
    ),
  );
  expect(first.evidence.text + second.evidence.text).toBe(full.text);
});

test('driving: stop during cursor movement prevents the host click and clears overlays', async ({
  page,
}) => {
  await page.locator('#open-summary').click();
  await expect(page.locator('.pagesquire-driving')).toBeVisible();
  await page.locator('#cancel-driving').click();
  await page.waitForFunction(() => !window.pagesquireDriving.client.state.busy);
  await expect(page.locator('.pagesquire-driving')).toHaveCount(0);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.pagesquireDriving.opens)).toBe(0);
  await expect(page.locator('#driving-article')).toBeHidden();
});

test('driving: reduced motion avoids animations and scan movement but still verifies the action', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    window.animationCount = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      window.animationCount++;
      return animate.apply(this, args);
    };
  });
  await page.locator('#open-summary').click();
  await page.waitForFunction(
    () =>
      window.pagesquireDriving.results.length === 2 &&
      !window.pagesquireDriving.client.state.busy,
  );
  expect(await page.evaluate(() => window.animationCount)).toBe(0);
  expect(await page.evaluate(() => window.pagesquireDriving.opens)).toBe(1);
});

test('driving: scan restores scroll and registered end scrolling reaches the real content boundary', async ({
  page,
}) => {
  await action(page, 'content.open', {});
  await page.evaluate(() => window.scrollTo(0, 80));
  const before = await page.evaluate(() => scrollY);
  expect(
    (
      await action(page, 'page.read', {
        scope: 'article',
        mode: 'full',
        offset: 0,
      })
    ).status,
  ).toBe('success');
  expect(await page.evaluate(() => scrollY)).toBe(before);
  expect(
    (
      await action(page, 'page.scroll_to', {
        scope: 'article',
        position: 'end',
      })
    ).status,
  ).toBe('success');
  expect(
    await page
      .locator('#article-end')
      .evaluate((element) => element.getBoundingClientRect().top < innerHeight),
  ).toBe(true);
});

test('driving: highlighting never clicks, generic targets remain default-deny and overlays are excluded', async ({
  page,
}) => {
  const result = await action(page, 'page.highlight', { scope: 'guide' });
  expect(result.status).toBe('success');
  expect(await page.evaluate(() => window.pagesquireDriving.opens)).toBe(0);
  const snapshot = await page.evaluate(() =>
    window.pagesquireDriving.runtime.observe(),
  );
  expect(snapshot.targets.every((target) => !target.actionable)).toBe(true);
  expect(JSON.stringify(snapshot)).not.toContain('PageSquire guided tour');
});

test('driving: decorative aria-hidden presentation requires a visible outline, not just an attached overlay', async ({
  page,
}) => {
  const states = await page.evaluate(async () => {
    const driver = window.pagesquireDriving.driver;
    const target = document.querySelector('#guide');
    await driver.present(target, new AbortController().signal);
    const overlay = document.querySelector('.pagesquire-driving');
    const ring = overlay.querySelector('.pagesquire-driving__target');
    const results = [
      overlay.getAttribute('aria-hidden'),
      driver.isPresenting(target),
    ];
    for (const [element, property, value] of [
      [overlay, 'display', 'none'],
      [overlay, 'visibility', 'hidden'],
      [overlay, 'opacity', '0'],
      [ring, 'outlineStyle', 'none'],
      [ring, 'outlineColor', 'transparent'],
      [ring, 'width', '0px'],
    ]) {
      const previous = element.style[property];
      element.style[property] = value;
      results.push(driver.isPresenting(target));
      element.style[property] = previous;
    }
    results.push(driver.isPresenting(target));
    driver.clear();
    results.push(driver.isPresenting(target));
    return results;
  });
  expect(states).toEqual([
    'true',
    true,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    false,
  ]);
});

test('driving: nested scroll containers reveal the actual public target', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const outer = document.createElement('div');
    Object.assign(outer.style, { height: '140px', overflow: 'auto' });
    const spacer = document.createElement('div');
    spacer.style.height = '900px';
    const target = document.createElement('button');
    target.textContent = 'Nested target';
    outer.append(spacer, target);
    document.querySelector('main').append(outer);
    await window.pagesquireDriving.driver.scrollTo(
      target,
      new AbortController().signal,
    );
    return {
      top: outer.scrollTop,
      inside:
        target.getBoundingClientRect().top >=
          outer.getBoundingClientRect().top &&
        target.getBoundingClientRect().bottom <=
          outer.getBoundingClientRect().bottom,
    };
  });
  expect(result.top).toBeGreaterThan(0);
  expect(result.inside).toBe(true);
});

test('driving: private or detached presentation targets are refused without a click', async ({
  page,
}) => {
  await action(page, 'content.open', {});
  const results = await page.evaluate(async () => {
    const driver = window.pagesquireDriving.driver;
    const detached = document.createElement('button');
    const codes = [];
    for (const target of [
      detached,
      document.querySelector('[data-pagesquire-private] button'),
    ]) {
      try {
        await driver.present(target, new AbortController().signal, 'click');
      } catch (error) {
        codes.push(error.code);
      }
    }
    return codes;
  });
  expect(results).toEqual(['TARGET_MISSING', 'TARGET_MISSING']);
});

test('driving: guided tour has keyboard stop, previous/next, literal text, no clicks and focus cleanup', async ({
  page,
}) => {
  await page.locator('#start-tour').click();
  const tour = page.getByRole('region', { name: 'PageSquire guided tour' });
  await expect(
    tour.getByRole('button', { name: 'Next', exact: true }),
  ).toBeEnabled();
  await tour.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(tour.getByRole('button', { name: 'Finish' })).toBeEnabled();
  await tour.getByRole('button', { name: 'Previous' }).click();
  await expect(
    tour.getByRole('button', { name: 'Next', exact: true }),
  ).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
  await expect(page.locator('.pagesquire-driving')).toHaveCount(0);
  await expect(page.locator('#start-tour')).toBeFocused();
  expect(await page.evaluate(() => window.pagesquireDriving.opens)).toBe(0);
});

test('driving: speech is opt-in/local-first, completes or cancels without any provider call', async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    let calls = 0,
      local = false,
      cancel = 0;
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class {
        constructor(text) {
          this.text = text;
        }
      },
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speaking: false,
        getVoices: () => [{ localService: local, lang: 'en-US' }],
        speak(utterance) {
          calls++;
          queueMicrotask(() => utterance.onend?.(new Event('end')));
        },
        cancel() {
          cancel++;
        },
      },
    });
    const speech = window.pagesquireDriving.speech;
    const disabled = await speech.speak('A final answer.');
    speech.setEnabled(true);
    const remoteOnly = await speech.speak('A final answer.');
    local = true;
    const completed = await speech.speak('A final answer.');
    speech.dispose();
    return {
      disabled,
      remoteOnly,
      completed,
      calls,
      cancel,
      requests: window.pagesquireDriving.requests,
    };
  });
  expect(results).toEqual({
    disabled: false,
    remoteOnly: false,
    completed: true,
    calls: 1,
    cancel: 0,
    requests: 0,
  });
});

test('driving: mobile tours do not overflow or intercept ordinary website controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.locator('#start-tour').click();
  const tour = page.getByRole('region', { name: 'PageSquire guided tour' });
  await expect(
    tour.getByRole('button', { name: 'Next', exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: test.info().outputPath('driving-mobile.png') });
  await tour.getByRole('button', { name: 'Stop tour' }).click();
  await page.locator('#open-article').click();
  await expect(page.locator('#driving-article')).toBeVisible();
});

test('driving: a control detached during cursor movement is missing and its replacement is not written', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.pendingControl = window.pagesquireDriving.call(
      'accessibility.set_heading_color',
      { color: '#c52b28' },
    );
  });
  await page.waitForFunction(() =>
    window.pagesquireDriving.driver.isPresenting(
      document.querySelector('#driver-heading-color'),
    ),
  );
  await page.evaluate(() => {
    const old = document.querySelector('#driver-heading-color');
    old.replaceWith(old.cloneNode(true));
  });
  const result = await page.evaluate(() => window.pendingControl);
  expect(result.code).toBe('TARGET_MISSING');
  await expect(page.locator('#guide h2')).not.toHaveCSS(
    'color',
    'rgb(197, 43, 40)',
  );
  await expect(page.locator('.pagesquire-driving')).toHaveCount(0);
});

test('driving: stop settles an uncooperative tour preparation and ignores its late resolution', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.tourOutcome = 'pending';
    void window.pagesquireDriving.tour
      .start([
        {
          target: () => document.querySelector('#guide'),
          text: '<img src=x onerror=alert(1)>',
          prepare: () =>
            new Promise((resolve) => {
              window.releaseTourPreparation = resolve;
            }),
        },
      ])
      .then((value) => {
        window.tourOutcome = value;
      });
  });
  const tour = page.getByRole('region', { name: 'PageSquire guided tour' });
  await tour.getByRole('button', { name: 'Stop tour' }).click();
  await page.waitForFunction(() => window.tourOutcome === 'cancelled');
  await expect(tour).toHaveCount(0);
  await page.evaluate(() => window.releaseTourPreparation());
  await expect(page.locator('.pagesquire-driving')).toHaveCount(0);
});

test('driving: reading leaves the active snapshot intact and rejects unbounded offset/length', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const observer = window.pagesquireDriving.observer;
    const snapshot = observer.observe();
    const root = document.querySelector('#guide');
    observer.readContent(root, 10, 0);
    const id = observer.requireSnapshot(snapshot.id).id;
    const codes = [];
    for (const [length, offset] of [
      [24001, 0],
      [10, 40001],
      [10, -1],
    ]) {
      try {
        observer.readContent(root, length, offset);
      } catch (error) {
        codes.push(error.code);
      }
    }
    return { unchanged: id === snapshot.id, codes };
  });
  expect(result.unchanged).toBe(true);
  expect(result.codes).toEqual([
    'INVALID_OPTIONS',
    'INVALID_OPTIONS',
    'INVALID_OPTIONS',
  ]);
});

test('driving: speech abort settles and cancels only an active owned utterance', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    let cancellations = 0;
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class {
        constructor(text) {
          this.text = text;
        }
      },
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speaking: false,
        getVoices: () => [{ lang: 'en-US', localService: true }],
        speak() {},
        cancel() {
          cancellations++;
        },
      },
    });
    const speech = window.pagesquireDriving.speech;
    speech.setEnabled(true);
    const controller = new AbortController();
    const pending = speech.speak('A final answer.', controller.signal);
    controller.abort();
    const completed = await pending;
    speech.dispose();
    return {
      completed,
      cancellations,
      requests: window.pagesquireDriving.requests,
    };
  });
  expect(result).toEqual({ completed: false, cancellations: 1, requests: 0 });
});
