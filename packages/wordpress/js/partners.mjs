import { api } from './api.mjs';

// PageSquire Link: Link settings, invitations, an overview of who offers
// what, and each partner's approval and counts.
export function setupPartners(config, notice, handle) {
  const form = document.querySelector('#pagesquire-link-form');
  const list = document.querySelector('#pagesquire-link-partners');
  const summary = document.querySelector('#pagesquire-link-overview');
  if (!form || !list) return;
  const element = (tag, properties = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), properties);
    node.append(...children);
    return node;
  };
  const checkbox = (name, value, checked, label) =>
    element('label', { className: 'pagesquire-adapter' }, [
      element('input', { type: 'checkbox', name, value, checked }),
      ` ${label}`,
    ]);
  const partnerNames = (partners) =>
    partners.map((partner) => `${partner.name} (${partner.origin})`).join(', ');
  const services = (title, entries, empty, several) =>
    element('section', { ariaLabel: title }, [
      element('h4', { textContent: title }),
      entries.length
        ? element(
            'ul',
            {},
            entries.map((entry) =>
              element('li', {
                textContent: `${entry.name} (${entry.skill}): ${partnerNames(entry.partners) || 'no partner yet'}${several && entry.partners.length > 1 ? '. Visitors choose between them.' : ''}`,
              }),
            ),
          )
        : element('p', { textContent: empty }),
    ]);
  const renderOverview = () => {
    const { overview } = config.state.link;
    summary?.replaceChildren();
    if (!summary) return;
    if (!overview) {
      summary.append(
        element('p', { textContent: 'Enable Link to see the overview.' }),
      );
      return;
    }
    summary.append(
      element('p', {
        className: 'pagesquire-link-totals',
        textContent: `Partners: ${overview.links.active} active, ${overview.links.pending} pending, ${overview.links.revoked} revoked. Visitors sent: ${overview.totals.sent}, received: ${overview.totals.received}.`,
      }),
      services(
        'Partner services your assistant may offer',
        overview.offered,
        'None yet. Approve a partner skill below.',
        true,
      ),
      services(
        'Our skills partners may hand visitors into',
        overview.accepted,
        'This site lists no skills.',
        false,
      ),
      ...(overview.agents
        ? [
            element('p', {
              className: 'pagesquire-link-agents',
              textContent: `AI agents (A2A) may send requests into: ${overview.agents.skills.join(', ') || 'no skills yet'}. Requests received: ${overview.agents.received}.`,
            }),
          ]
        : []),
    );
  };
  const activity = (stats) => {
    if (!stats) return '';
    const skills = Object.entries(stats.skills ?? {})
      .map(
        ([id, counts]) =>
          `${id} ${counts.sent} sent, ${counts.received} received`,
      )
      .join('; ');
    const last = stats.lastAt
      ? ` Last: ${new Date(stats.lastAt).toISOString().slice(0, 16).replace('T', ' ')} UTC.`
      : '';
    return `${skills ? ` Handoffs per skill: ${skills}.` : ''}${last}`;
  };
  const render = () => {
    const { links, settings } = config.state.link;
    renderOverview();
    list.replaceChildren();
    if (!links.length)
      list.append(element('p', { textContent: 'No partner sites yet.' }));
    for (const link of links) {
      const partner = `${link.partner.name} (${link.partner.origin})`;
      const card = element('section', {
        className: 'pagesquire-partner',
        ariaLabel: partner,
      });
      card.dataset.link = link.id;
      card.append(
        element('h4', { textContent: partner }),
        element('p', {
          className: 'pagesquire-partner-status',
          textContent: `Status: ${link.status}. They accept: ${link.theirs.approved ? link.theirs.accept.join(', ') || 'nothing' : 'not approved yet'}. Visitors sent: ${link.stats?.sent ?? 0}, received: ${link.stats?.received ?? 0}.${activity(link.stats)}`,
        }),
      );
      if (link.status !== 'revoked') {
        const approval = element('form');
        const offer = element('fieldset', {}, [
          element('legend', { textContent: 'Partner skills to offer' }),
        ]);
        for (const skill of link.partner.skills) {
          const offered = link.ours.offer[skill.id];
          offer.append(
            checkbox('offer', skill.id, Boolean(offered), skill.name),
          );
          for (const field of Object.keys(skill.fields))
            offer.append(
              checkbox(
                `field:${skill.id}`,
                field,
                Boolean(offered?.includes(field)),
                `${skill.name}: ${field}`,
              ),
            );
        }
        if (!link.partner.skills.length)
          offer.append(
            element('p', { textContent: 'The partner lists no skills.' }),
          );
        const accept = element('fieldset', {}, [
          element('legend', { textContent: 'Our skills the partner may use' }),
        ]);
        for (const skill of settings.skills)
          accept.append(
            checkbox(
              'accept',
              skill.id,
              link.ours.accept.includes(skill.id),
              skill.name,
            ),
          );
        if (!settings.skills.length)
          accept.append(
            element('p', { textContent: 'This site lists no skills.' }),
          );
        const revoke = element('button', {
          type: 'button',
          className: 'button',
          textContent: `Revoke ${link.partner.name}`,
        });
        approval.append(
          offer,
          accept,
          element('p', {}, [
            element('button', {
              type: 'submit',
              className: 'button button-primary',
              textContent: `Approve ${link.partner.name}`,
            }),
            ' ',
            revoke,
          ]),
        );
        approval.addEventListener('submit', (event) => {
          event.preventDefault();
          void handle(async () => {
            const data = new FormData(approval);
            const scope = {};
            for (const id of data.getAll('offer'))
              scope[id] = data.getAll(`field:${id}`);
            const result = await api(config, 'link/approve', {
              method: 'POST',
              body: {
                link: link.id,
                offer: scope,
                accept: data.getAll('accept'),
              },
            });
            await refresh();
            notice(
              `Approved. Status: ${result.record.status}.${result.notified ? '' : ' The partner could not be reached; approve again later to tell it.'}`,
            );
          });
        });
        revoke.addEventListener(
          'click',
          () =>
            void handle(async () => {
              if (!confirm(`Revoke the link with ${partner}?`)) return;
              await api(config, 'link/revoke', {
                method: 'POST',
                body: { link: link.id },
              });
              await refresh();
              notice('Link revoked.');
            }),
        );
        card.append(approval);
      }
      list.append(card);
    }
  };
  const refresh = async () => {
    config.state.link = await api(config, 'link/admin');
    render();
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void handle(async () => {
      let skills;
      try {
        skills = JSON.parse(form.elements.skills.value || '[]');
      } catch {
        throw Error('Skills must be valid JSON.');
      }
      config.state.link = await api(config, 'link/settings', {
        method: 'PUT',
        body: {
          enabled: form.elements.enabled.checked,
          name: form.elements.name.value,
          skills,
          a2a: {
            enabled: form.elements.a2a.checked,
            skills: form.elements.a2aSkills.value
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean),
          },
        },
      });
      render();
      notice(
        config.state.link.settings.enabled
          ? 'PageSquire Link enabled.'
          : 'Link settings saved. Link is off.',
      );
    });
  });
  document.querySelector('#pagesquire-link-invite').addEventListener(
    'click',
    () =>
      void handle(async () => {
        const invitation = await api(config, 'link/invite', {
          method: 'POST',
          body: {
            hours: Number(document.querySelector('#ps-link-hours').value),
          },
        });
        document.querySelector('#ps-link-code').value = invitation.code;
        notice(
          'Invitation created. Send it to the partner owner over a channel you trust; it works once.',
        );
      }),
  );
  document.querySelector('#pagesquire-link-accept').addEventListener(
    'click',
    () =>
      void handle(async () => {
        const input = document.querySelector('#ps-link-accept-code');
        const link = await api(config, 'link/accept', {
          method: 'POST',
          body: { code: input.value.trim() },
        });
        input.value = '';
        await refresh();
        notice(
          `Paired with ${link.partner.name}. Approve your side to activate the link.`,
        );
      }),
  );
  render();
}
