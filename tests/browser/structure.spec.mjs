import { test, expect } from '@playwright/test';

// The demo server forbids frames by CSP, so this page and its frame are
// served by the test itself from the same origin.
const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="csrf-token" content="synthetic-structure-csrf-token-0123456789" />
    <title>Structure fixture</title>
    <link rel="stylesheet" href="/dist/embed/pagesquire.css" />
  </head>
  <body>
    <nav aria-label="Main menu"><a href="/structure.html">Home</a></nav>
    <main>
      <h1>Structure fixture</h1>
      <h2>Account</h2>
      <p>Main body text.</p>
      <aside aria-label="Help"><p>Ask for help.</p></aside>
      <form aria-label="Search site"><input aria-label="Query" /></form>
      <form><input aria-label="Unlabelled form field" /></form>
      <iframe title="Embedded help" src="/structure-frame.html"></iframe>
      <iframe title="Sandboxed" sandbox src="/structure-frame.html"></iframe>
      <iframe title="Private" data-pagesquire-private src="/structure-frame.html"></iframe>
    </main>
    <script
      src="/dist/embed/pagesquire.min.js"
      data-endpoint="/pagesquire/chat"
      data-pages="/structure.html"
      data-styles="none"
      data-generic="true"
      data-outline="true"
      data-frames="true"
      defer
    ></script>
  </body>
</html>`;
const frame = `<!doctype html><html><body>
  <p>Frame help text</p>
  <button type="button">Frame button</button>
  <div data-pagesquire-private>Frame secret</div>
</body></html>`;

test.beforeEach(async ({ page: tab }) => {
  await tab.route('**/structure.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: page }),
  );
  await tab.route('**/structure-frame.html', (route) =>
    route.fulfill({ contentType: 'text/html', body: frame }),
  );
  await tab.goto('/structure.html');
  await tab.waitForFunction(() => Boolean(window.PageSquire?.runtime));
  await expect(
    tab
      .frameLocator('iframe[title="Embedded help"]')
      .getByText('Frame help text'),
  ).toBeVisible();
});

test('snapshots lead with an outline and read same-origin frames without exposing their elements', async ({
  page: tab,
}) => {
  const snapshot = await tab.evaluate(() =>
    window.PageSquire.runtime.observe(),
  );
  expect(snapshot.text).toMatch(
    /^\[Outline: navigation "Main menu" \| main \| h1 Structure fixture \| h2 Account \| complementary "Help" \| form "Search site"\] /,
  );
  expect(snapshot.text).not.toContain('Unlabelled');
  expect(snapshot.text).toContain('[Frame "Embedded help"] Frame help text');
  // Sandboxed and private frames stay unread; private parts of a frame too.
  expect(snapshot.text.split('Frame help text')).toHaveLength(2);
  expect(snapshot.text).not.toContain('Frame secret');
  expect(snapshot.targets.map((target) => target.name)).not.toContain(
    'Frame button',
  );
});

test('ui.ask and ui.hand_off wait for the visitor in the widget', async ({
  page: tab,
}) => {
  const run = (capabilityId, parameters) =>
    tab.evaluate(
      ({ capabilityId, parameters }) => {
        const { runtime } = window.PageSquire;
        const snapshot = runtime.observe();
        window.pendingVisitor = runtime.execute({
          protocolVersion: '0.1',
          callId: crypto.randomUUID(),
          capabilityId,
          snapshotId: snapshot.id,
          parameters,
        });
      },
      { capabilityId, parameters },
    );
  const settled = () => tab.evaluate(() => window.pendingVisitor);
  await run('ui.ask', { question: 'Which plan?', options: ['Basic', 'Pro'] });
  const question = tab.getByRole('alertdialog');
  await expect(question).toContainText('Which plan?');
  await expect(question.getByRole('button', { name: 'Basic' })).toBeFocused();
  await question.getByRole('button', { name: 'Pro' }).click();
  expect(await settled()).toMatchObject({
    status: 'success',
    evidence: { answer: 'Pro' },
  });
  await run('ui.hand_off', { instruction: 'Sign in with your account.' });
  const turn = tab.getByRole('region', { name: 'Your turn' });
  await expect(turn).toContainText('Sign in with your account.');
  // The visitor can keep using the page while it waits.
  await tab.getByLabel('Query').fill('help');
  await turn.getByRole('button', { name: "I'm done" }).click();
  expect(await settled()).toMatchObject({
    status: 'success',
    evidence: { visitorFinished: true },
  });
  await run('ui.hand_off', { instruction: 'Enter the code we sent.' });
  await tab
    .getByRole('region', { name: 'Your turn' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  expect(await settled()).toMatchObject({ code: 'VISITOR_DECLINED' });
});
