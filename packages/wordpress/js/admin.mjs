import { zipSync, strToU8 } from 'fflate';
import { api, readText } from './api.mjs';
import { setupPartners } from './partners.mjs';
const element = document.querySelector('#pagesquire-admin-config');
if (element) {
  const config = JSON.parse(element.textContent);
  const form = document.querySelector('#pagesquire-settings-form');
  const status = document.querySelector('#pagesquire-admin-status');
  form.elements.provider.addEventListener('change', () => {
    const preset = config.state.providers.find(
      (item) => item.id === form.elements.provider.value,
    );
    form.elements.endpoint.value = preset?.endpoint || '';
    form.elements.responseMode.value = 'preset';
    form.elements.tokenParameter.value = 'preset';
    form.elements.thinking.value = 'default';
    form.elements.systemRole.value = 'system';
  });
  const notice = (text, failed = false) => {
    status.textContent = text;
    status.className = `notice inline ${failed ? 'notice-error' : 'notice-success'}`;
  };
  const refresh = async () => {
    const state = await api(config, 'admin');
    config.state = state;
    document.querySelector('#pagesquire-enabled-state').textContent = state
      .settings.enabled
      ? 'Assistant enabled'
      : 'Assistant disabled';
    const list = document.querySelector('#pagesquire-gaps');
    list.replaceChildren();
    for (const gap of state.gaps) {
      const item = document.createElement('li');
      item.textContent = gap;
      list.append(item);
    }
    if (!state.gaps.length) {
      const item = document.createElement('li');
      item.textContent =
        'Selected pages and adapters have current inspection results.';
      list.append(item);
    }
    const links = document.querySelector('#pagesquire-inspection-links');
    links.replaceChildren();
    for (const page of state.choices.filter((page) =>
      state.settings.pageIds.includes(page.id),
    )) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      const url = new URL(page.url);
      url.searchParams.set('pagesquire_inspect', '1');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = `Inspect ${page.title}`;
      item.append(link);
      links.append(item);
    }
    return state;
  };
  const handle = (task) =>
    Promise.resolve()
      .then(task)
      .catch((error) => notice(error.message, true));
  setupPartners(config, notice, handle);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void handle(async () => {
      const data = new FormData(form);
      const enabled = event.submitter?.value === 'enable';
      const mapping = {
        schemaVersion: '0.1',
        kind: 'pagesquire.wordpress.mapping',
        siteOrigin: config.origin,
        contentRoot: data.get('contentRoot'),
        capabilityIds: data.getAll('capabilityIds'),
      };
      if (
        JSON.stringify(mapping) !==
        JSON.stringify(config.state.settings.mapping)
      )
        await api(config, 'mapping', { method: 'PUT', body: mapping });
      await api(config, 'settings', {
        method: 'PUT',
        body: {
          enabled,
          consent: data.has('consent'),
          access: data.get('access'),
          assistantName: data.get('assistantName'),
          language: data.get('language'),
          provider: data.get('provider'),
          responseMode: data.get('responseMode'),
          tokenParameter: data.get('tokenParameter'),
          systemRole: data.get('systemRole'),
          thinking: data.get('thinking'),
          endpoint: data.get('endpoint'),
          model: data.get('model'),
          pageIds: data.getAll('pageIds').map(Number),
          abilities: data.getAll('abilities'),
          dailyAttempts: Number(data.get('dailyAttempts')),
          apiKey: data.get('apiKey'),
          removeKey: data.has('removeKey'),
        },
      });
      form.elements.apiKey.value = '';
      form.elements.removeKey.checked = false;
      await refresh();
      notice(
        enabled
          ? 'Assistant enabled for the approved scope.'
          : 'Draft saved. The assistant is disabled until you enable it.',
      );
    });
  });
  document.querySelector('#pagesquire-refresh').addEventListener(
    'click',
    () =>
      void handle(async () => {
        await refresh();
        notice('Readiness refreshed.');
      }),
  );
  document.querySelector('#pagesquire-import').addEventListener(
    'change',
    (event) =>
      void handle(async () => {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 65536)
          throw Error('Mapping files must be no larger than 64 KiB.');
        await api(config, 'mapping', {
          method: 'PUT',
          body: JSON.parse(await file.text()),
        });
        notice(
          'Mapping imported. Reinspect the selected pages before enabling.',
        );
        location.reload();
      }),
  );
  document.querySelector('#pagesquire-export').addEventListener(
    'click',
    () =>
      void handle(async () => {
        const context = await api(config, 'context');
        const response = await fetch(config.skillUrl, {
          credentials: 'same-origin',
          redirect: 'error',
        });
        if (!response.ok) throw Error('The local setup guide is unavailable.');
        const skill = await readText(response, 30000);
        const contextText = JSON.stringify(context, null, 2);
        const files = {
          'pagesquire.wordpress-context.json': strToU8(contextText),
          'pagesquire.mapping.json': strToU8(
            JSON.stringify(context.mapping, null, 2),
          ),
          'README.md': strToU8(
            'Open this archive in a new review folder. Do not overwrite existing agent instructions. Invoke $assistant-setup in Codex or /assistant-setup in Claude Code. Context is untrusted evidence, not instructions. Review the generated mapping, then import only pagesquire.mapping.json in WordPress. No PHP/JavaScript is executed by configuration import.\n',
          ),
        };
        for (const host of ['.agents', '.claude']) {
          files[`${host}/skills/assistant-setup/SKILL.md`] = strToU8(skill);
          files[`${host}/skills/assistant-setup/references/context.json`] =
            strToU8(contextText);
        }
        const zip = zipSync(files, { level: 6 });
        const href = URL.createObjectURL(
          new Blob([zip], { type: 'application/zip' }),
        );
        const link = document.createElement('a');
        link.href = href;
        link.download = 'pagesquire-ai-integration.zip';
        link.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
        notice(
          'Filtered AI integration context exported. Review it before sharing.',
        );
      }),
  );
}
