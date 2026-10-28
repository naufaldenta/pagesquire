import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGenericBindings } from '../../packages/core/dist/index.js';

/** A driver whose frame reports what each test sets. */
function frameDriver(info, effect) {
  const calls = [];
  return {
    calls,
    async frameTarget(frame, target, action) {
      calls.push(['inspect', frame, target, action]);
      return info;
    },
    async frameAct(request) {
      calls.push(['act', request]);
      return effect;
    },
  };
}
const effect = {
  mutations: 2,
  urlChanged: false,
  focusChanged: false,
  stateChanged: true,
};
let next = 0;
const context = (approvals = []) => ({
  call: { callId: `call-${++next}` },
  requestApproval: async (label) => approvals.push(label),
});

test('frame targets go to the driver with the frame and its target ID', async () => {
  const driver = frameDriver(
    { risk: 'allow', label: 'Book', link: false },
    effect,
  );
  const { handlers, verifiers } = createGenericBindings({ driver });
  const ctx = context();
  await handlers['ui.click']({ target: 'frame2-target-7' }, ctx);
  assert.deepEqual(driver.calls, [
    ['inspect', 'frame2', 'target-7', 'click'],
    ['act', { frame: 'frame2', target: 'target-7', action: 'click' }],
  ]);
  assert.deepEqual(verifiers['ui.click.verify']({}, ctx), {
    verified: true,
    evidence: { responded: true, mutations: 2, urlChanged: false },
  });
});

test('frame typing and checks are verified from what the frame reports', async () => {
  const typing = frameDriver(
    { risk: 'allow', label: 'Note', link: false },
    { ...effect, typed: true, length: 3 },
  );
  const typed = createGenericBindings({ driver: typing });
  const ctx = context();
  const parameters = { target: 'frame1-target-2', text: 'Ada', clear: true };
  await typed.handlers['ui.type'](parameters, ctx);
  assert.deepEqual(typing.calls[1][1], {
    frame: 'frame1',
    target: 'target-2',
    action: 'type',
    text: 'Ada',
    clear: true,
  });
  assert.deepEqual(typed.verifiers['ui.type.verify'](parameters, ctx), {
    verified: true,
    evidence: { length: 3 },
  });

  const checking = frameDriver(
    { risk: 'allow', label: 'Remind me', link: false, checked: false },
    { ...effect, checked: true },
  );
  const checked = createGenericBindings({ driver: checking });
  const checkCtx = context();
  await checked.handlers['ui.check'](
    { target: 'frame1-target-4', checked: true },
    checkCtx,
  );
  assert.equal(
    checked.verifiers['ui.check.verify'](
      { target: 'frame1-target-4', checked: true },
      checkCtx,
    ).verified,
    true,
  );
  // Already in the wanted state: verified without acting.
  const unchanged = frameDriver(
    { risk: 'allow', label: 'Remind me', link: false, checked: true },
    effect,
  );
  const still = createGenericBindings({ driver: unchanged });
  const stillCtx = context();
  await still.handlers['ui.check'](
    { target: 'frame1-target-4', checked: true },
    stillCtx,
  );
  assert.equal(unchanged.calls.length, 1);
  assert.equal(
    still.verifiers['ui.check.verify'](
      { target: 'frame1-target-4', checked: true },
      stillCtx,
    ).verified,
    true,
  );
});

test('risk tiers judged in the frame still decide, and some actions never reach frames', async () => {
  const approvals = [];
  const approve = frameDriver(
    { risk: 'approve', label: 'Pay now', link: false },
    effect,
  );
  await createGenericBindings({ driver: approve }).handlers['ui.click'](
    { target: 'frame1-target-1' },
    context(approvals),
  );
  assert.deepEqual(approvals, ['Click "Pay now"']);

  const refusals = [
    [
      { risk: 'deny', label: 'x', link: false },
      'ui.click',
      {},
      'TARGET_NOT_ALLOWED',
    ],
    [
      { risk: 'allow', label: 'x', link: true },
      'ui.click',
      {},
      'LINK_NAVIGATION',
    ],
    [
      { risk: 'allow', label: 'x', link: false },
      'ui.check',
      { checked: true },
      'UNSUPPORTED_TARGET',
    ],
    [
      { risk: 'allow', label: 'x', link: false },
      'ui.press_key',
      { key: 'Escape' },
      'UNSUPPORTED_TARGET',
    ],
    [
      { risk: 'allow', label: 'x', link: false },
      'ui.hover',
      {},
      'UNSUPPORTED_TARGET',
    ],
    [
      { risk: 'allow', label: 'x', link: false },
      'ui.select',
      { option: 'a' },
      'UNSUPPORTED_TARGET',
    ],
  ];
  for (const [info, tool, extra, code] of refusals) {
    const driver = frameDriver(info, effect);
    await assert.rejects(
      createGenericBindings({ driver }).handlers[tool](
        { target: 'frame1-target-1', ...extra },
        context(),
      ),
      { code },
      `${tool} ${code}`,
    );
    assert.equal(
      driver.calls.some(([kind]) => kind === 'act'),
      false,
      `${tool} acted`,
    );
  }
  await assert.rejects(
    createGenericBindings().handlers['ui.click'](
      { target: 'frame1-target-1' },
      context(),
    ),
    { code: 'TARGET_MISSING' },
  );
});

test('tab targets use the frame path and ui.switch_tab needs the extension', async () => {
  const driver = {
    ...frameDriver({ risk: 'allow', label: 'Book', link: false }, effect),
    switched: [],
    async switchTab(tab) {
      this.switched.push(tab);
      return true;
    },
  };
  const { handlers, verifiers } = createGenericBindings({ driver });
  await handlers['ui.click']({ target: 'tab2-target-5' }, context());
  assert.deepEqual(driver.calls[0], ['inspect', 'tab2', 'target-5', 'click']);
  const ctx = context();
  await handlers['ui.switch_tab']({ tab: 'tab1' }, ctx);
  assert.deepEqual(driver.switched, ['tab1']);
  assert.deepEqual(verifiers['ui.switch_tab.verify']({ tab: 'tab1' }, ctx), {
    verified: true,
    evidence: { tab: 'tab1' },
  });
  await assert.rejects(
    createGenericBindings().handlers['ui.switch_tab'](
      { tab: 'tab2' },
      context(),
    ),
    { code: 'UNSUPPORTED_TARGET' },
  );
  await assert.rejects(
    createGenericBindings({ driver }).handlers['ui.hover'](
      { target: 'tab2-target-1' },
      context(),
    ),
    { code: 'UNSUPPORTED_TARGET' },
  );
});
