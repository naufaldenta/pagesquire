// Side panel: the visitor's own controls. Grants happen only here.
const t = (name) => chrome.i18n.getMessage(name) || name;
const $ = (id) => document.getElementById(id);
const ask = (op, extra = {}) => chrome.runtime.sendMessage({ op, ...extra });

document.documentElement.lang = chrome.i18n.getUILanguage();
for (const element of document.querySelectorAll('[data-i18n]'))
  element.textContent = t(element.dataset.i18n);

// Tests open the panel as a tab and name the tab it controls.
const fixed = Number(new URLSearchParams(location.search).get('tab'));
let tabId;
let origin;
let inspected = {};

async function currentTab() {
  if (Number.isInteger(fixed) && fixed > 0) return fixed;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function show(id, visible) {
  $(id).hidden = !visible;
}

function renderActivity(entries) {
  const list = $('activity');
  list.replaceChildren(
    ...(entries.length ? entries : [undefined]).map((entry) => {
      const item = document.createElement('li');
      if (!entry) {
        item.textContent = t('noActivity');
        return item;
      }
      const time = new Date(entry.at).toLocaleTimeString();
      const what = entry.key ? `${entry.kind} ${entry.key}` : entry.kind;
      item.textContent = `${time} ${what} ${entry.ok ? '✓' : `✗ ${entry.code ?? ''}`} ${entry.origin}`;
      if (!entry.ok) item.className = 'failed';
      return item;
    }),
  );
}

async function render() {
  tabId = await currentTab();
  const state = await ask('state', { tabId });
  origin = state.origin;
  $('origin').textContent = origin ?? '';
  for (const id of [
    'declaration',
    'errors',
    'allow-help',
    'allow',
    'stop',
    'resume',
    'revoke',
    'stop-help',
    'frames-refused',
    'granted-frames',
    'shared-tabs',
    'share',
    'unshare',
    'screenshots-row',
    'screenshots-help',
  ])
    show(id, false);
  renderActivity(state.audit ?? []);
  if (!origin) {
    $('message').textContent = t('noSite');
    return;
  }
  if (state.grant) {
    $('message').textContent = state.stopped
      ? t('stopped')
      : `${t('allowed')} ${state.acting ? t('acting') : t('idle')}`;
    show('stop', !state.stopped);
    show('stop-help', !state.stopped);
    show('resume', state.stopped);
    show('revoke', true);
    // Tabs: this one may join a session, or already be part of one.
    show('share', Boolean(state.shareable));
    show('unshare', Boolean(state.member));
    if (state.member || state.sharedTabs?.length) {
      $('shared-tabs').textContent = state.member
        ? `${t('memberOf')} ${state.member}`
        : `${t('sharedTabs')} ${state.sharedTabs.join(', ')}`;
      show('shared-tabs', true);
    }
    // Only sites that declare screenshots offer the switch; it starts off.
    if (state.grant.manifest.features?.includes('screenshots')) {
      $('screenshots').checked = state.grant.screenshots === true;
      show('screenshots-row', true);
      show('screenshots-help', true);
    }
    if (state.grant.frames?.length) {
      $('granted-frames').textContent =
        `${t('framesAllowed')} ${state.grant.frames.join(', ')}`;
      show('granted-frames', true);
    }
    return;
  }
  if (inspected.origin !== origin) {
    $('message').textContent = t('checking');
    inspected = { origin, result: await ask('inspect', { tabId }) };
  }
  const result = inspected.result;
  if (result?.valid) {
    $('message').textContent = '';
    $('endpoint').textContent = result.value.endpoint;
    $('features').textContent = result.value.features.join(', ');
    $('frames').textContent = result.frames?.allowed.length
      ? result.frames.allowed.join(', ')
      : t('noFrames');
    if (result.frames?.refused.length) {
      $('frames-refused').textContent =
        `${t('framesRefused')} ${result.frames.refused.join(', ')}`;
      show('frames-refused', true);
    }
    show('declaration', true);
    show('allow-help', true);
    show('allow', true);
  } else {
    $('message').textContent = t('manifestError');
    $('errors').replaceChildren(
      ...(result?.errors ?? []).map((error) => {
        const item = document.createElement('li');
        item.textContent = error;
        return item;
      }),
    );
    show('errors', true);
  }
}

$('allow').addEventListener('click', async () => {
  const result = await ask('grant', { tabId });
  if (!result.ok)
    inspected = {
      origin,
      result: { valid: false, errors: result.errors ?? [] },
    };
  await render();
});
$('revoke').addEventListener('click', async () => {
  await ask('revoke', { origin });
  inspected = {};
  await render();
});
$('screenshots').addEventListener('change', async (event) => {
  await ask('screenshots', { origin, enabled: event.target.checked });
  await render();
});
$('share').addEventListener('click', async () => {
  await ask('share', { tabId });
  await render();
});
$('unshare').addEventListener('click', async () => {
  await ask('unshare', { tabId });
  await render();
});
$('stop').addEventListener('click', async () => {
  await ask('stop', { tabId });
  await render();
});
$('resume').addEventListener('click', async () => {
  await ask('resume', { tabId });
  await render();
});

chrome.tabs.onActivated.addListener(() => render());
chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && change.status === 'complete') render();
});
setInterval(render, 1000);
render();
