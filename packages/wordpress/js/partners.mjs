import { api } from './api.mjs';

// PageSquire Link: Link settings, invitations and each partner's approval.
export function setupPartners(config, notice, handle) {
  const form = document.querySelector('#pagesquire-link-form');
  const list = document.querySelector('#pagesquire-link-partners');
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
  const render = () => {
    const { links, settings } = config.state.link;
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
          textContent: `Status: ${link.status}. They accept: ${link.theirs.approved ? link.theirs.accept.join(', ') || 'nothing' : 'not approved yet'}.`,
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
