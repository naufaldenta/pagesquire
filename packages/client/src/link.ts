import type { AssistantClient } from './client.js';
import { resolveMessages } from './i18n.js';
import type { LocaleOptions } from './i18n.js';

export type LinkArrivalOptions = LocaleOptions;

// psq-link: a partner site sent the visitor; psq-agent: an A2A agent did.
const FRAGMENT = /^#psq-(link|agent)=([A-Za-z0-9_-]{22})$/;

/**
 * PageSquire Link arrival: when a partner site sent the visitor here with a
 * `#psq-link=CODE` fragment, or an A2A agent with `#psq-agent=CODE`,
 * removes it from the address bar at once and
 * shows a banner in `host`. Only Continue redeems the code, starting the
 * conversation from the visitor's request; Dismiss discards it. Returns a
 * function that removes the banner, or undefined when there is no code.
 */
export function mountLinkArrival(
  host: HTMLElement,
  client: AssistantClient,
  options: LinkArrivalOptions = {},
): (() => void) | undefined {
  const document = host.ownerDocument;
  const view = document.defaultView;
  const match = FRAGMENT.exec(view?.location.hash ?? '');
  const code = match?.[2];
  if (!view || !code) return undefined;
  const agent = match![1] === 'agent';
  // The code must not linger in history, bookmarks or shared links.
  view.history.replaceState(
    view.history.state,
    '',
    view.location.pathname + view.location.search,
  );
  const t = resolveMessages(options, document);
  const banner = document.createElement('section');
  banner.className = 'pagesquire-visitor pagesquire-link-arrival';
  banner.setAttribute('data-pagesquire-root', '');
  banner.setAttribute('role', 'region');
  const heading = document.createElement('p');
  heading.className = 'pagesquire-visitor-title';
  heading.id = `pagesquire-arrival-${Math.random().toString(36).slice(2)}`;
  heading.textContent = t[agent ? 'link.agentTitle' : 'link.arrivalTitle'];
  banner.setAttribute('aria-labelledby', heading.id);
  const text = document.createElement('p');
  text.textContent = t[agent ? 'link.agentText' : 'link.arrivalText'];
  const actions = document.createElement('div');
  actions.className = 'pagesquire-visitor-actions';
  const proceed = document.createElement('button');
  proceed.type = 'button';
  proceed.textContent = t['link.continue'];
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = t['link.dismiss'];
  actions.append(proceed, dismiss);
  banner.append(heading, text, actions);
  const remove = () => banner.remove();
  proceed.addEventListener(
    'click',
    () => {
      remove();
      // Errors such as an expired code appear in the conversation.
      void client.arrive(code).catch(() => {});
    },
    { once: true },
  );
  dismiss.addEventListener('click', remove, { once: true });
  host.prepend(banner);
  proceed.focus();
  return remove;
}
