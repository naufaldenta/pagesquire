// Runs in remote documents of a session: cross-origin frames a site declared
// and the visitor allowed, and other same-origin tabs that joined the session.
// It reads the document for the page's assistant with the same observer the
// page uses, and prepares one input at a time. The service worker decides
// whether this document is in scope and delivers the input itself.
// Built with @pagesquire/core into dist/remote.js (scripts/build-extension.mjs).
// Only the observer and risk tiers: the runtime and its validators stay out.
import { PageObserver } from '../../core/dist/observer.js';
import { defaultRisk } from '../../core/dist/generic.js';

const QUIET_MS = 300;
const SETTLE_MS = 2000;
const TAG = 'data-pagesquire-target';

// Mirrors checkedState and stateOf in packages/core/src/generic.ts.
function checkedState(element) {
  if (
    element.tagName === 'INPUT' &&
    ['checkbox', 'radio'].includes(element.type)
  )
    return element.checked;
  const aria =
    element.getAttribute('aria-checked') ??
    element.getAttribute('aria-pressed');
  if (aria === 'mixed') return 'mixed';
  if (aria === 'true' || aria === 'false') return aria === 'true';
  return undefined;
}

function stateOf(element) {
  return JSON.stringify([
    checkedState(element),
    typeof element.value === 'string' ? element.value.length : null,
    element.getAttribute('aria-expanded'),
    element.getAttribute('aria-selected'),
  ]);
}

function coded(code) {
  return Object.assign(new Error(code), { code });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  if (globalThis.pagesquireRemote) return;
  globalThis.pagesquireRemote = true;
  const ask = (message) =>
    chrome.runtime.sendMessage(message).catch(() => ({ ok: false }));
  // Whether a page of this origin opened this tab, for tabs that join a
  // session because the page opened them (not because the visitor shared).
  let referrer;
  try {
    referrer = document.referrer ? new URL(document.referrer).origin : '';
  } catch {
    referrer = '';
  }
  const hello = () =>
    ask({
      op: 'inner-hello',
      opened: Boolean(window.opener) || referrer === location.origin,
    });
  // The worker answers only for declared, allowed frames and for tabs in a
  // session. Until it does, this script stays idle and only listens for a
  // rejoin (a tab the visitor shares later).
  let observer;
  /** nonce -> one prepared input and what it is watching. */
  const prepared = new Map();
  let snapshot;
  let timer;
  const report = () => {
    try {
      snapshot = observer.observe();
    } catch {
      return;
    }
    ask({
      op: 'inner-snapshot',
      snapshot: {
        // Origin and path only: queries and fragments may carry tokens.
        url: `${location.origin}${location.pathname}`,
        title: snapshot.title,
        text: snapshot.text,
        targets: snapshot.targets,
        truncated: snapshot.truncated,
      },
    });
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(report, 250);
  };
  /** Starts reading once, after the worker accepted this document. */
  const start = () => {
    if (observer) return;
    observer = new PageObserver({
      document,
      observeUrl: () => true,
      allowUrl: () => true,
      // The whole document is in scope; private and sensitive elements stay
      // excluded by the observer, and defaultRisk still guards each action.
      canInteract: () => true,
      maxTextLength: 4000,
      maxTargets: 100,
    });
    new MutationObserver((records) => {
      if (records.some((record) => record.attributeName !== TAG)) schedule();
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    addEventListener('pagehide', () => ask({ op: 'inner-gone' }));
    // Focus inside a frame keeps keys there, so the stop key is watched here too.
    addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && event.isTrusted)
          ask({ op: 'inner-stop' });
      },
      true,
    );
    report();
  };

  const resolve = (target, action) => {
    if (!snapshot) throw coded('TARGET_MISSING');
    return observer.resolveTarget(
      snapshot.id,
      target,
      action === 'type' ? 'fill' : 'click',
    );
  };
  const risk = (element, action) => {
    try {
      return defaultRisk(element, action);
    } catch {
      return 'deny';
    }
  };

  const handlers = {
    /** A tab the visitor shares, now or again, joins its session. */
    async rejoin() {
      const ok = (await hello())?.ok === true;
      if (ok) {
        if (observer) report();
        else start();
      }
      return { ok };
    },
    inspect({ target, action }) {
      const element = resolve(target, action);
      const checked = checkedState(element);
      return {
        ok: true,
        info: {
          risk: risk(element, action),
          label: (
            snapshot.targets.find((entry) => entry.id === target)?.name ||
            element.tagName.toLowerCase()
          ).slice(0, 120),
          link: Boolean(element.closest('a[href]')),
          ...(checked === undefined ? {} : { checked }),
        },
      };
    },
    prepare({ target, action, nonce, clear }) {
      const element = resolve(target, action);
      if (risk(element, action) === 'deny') throw coded('TARGET_NOT_ALLOWED');
      if (!observer.isVisible(element)) throw coded('TARGET_HIDDEN');
      if (
        element.matches(':disabled') ||
        element.getAttribute('aria-disabled') === 'true'
      )
        throw coded('TARGET_DISABLED');
      if (
        action === 'type' &&
        (!element.matches('input, textarea') || element.selectionStart === null)
      )
        throw coded('UNSUPPORTED_TARGET');
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
      if (action === 'type') {
        element.focus({ preventScroll: true });
        if (clear) element.select();
        else
          element.setSelectionRange(element.value.length, element.value.length);
      }
      const watch = {
        element,
        url: location.href,
        focus: document.activeElement,
        state: stateOf(element),
        mutations: 0,
        last: Date.now(),
      };
      watch.observer = new MutationObserver((records) => {
        const changed = records.filter(
          (record) => record.attributeName !== TAG,
        );
        if (!changed.length) return;
        watch.mutations += changed.length;
        watch.last = Date.now();
      });
      watch.observer.observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      element.setAttribute(TAG, nonce);
      prepared.set(nonce, watch);
      return { ok: true };
    },
    async finish({ nonce, text, clear }) {
      const watch = prepared.get(nonce);
      if (!watch) throw coded('TARGET_MISSING');
      const started = Date.now();
      while (
        Date.now() - watch.last < QUIET_MS &&
        Date.now() - started < SETTLE_MS
      )
        await sleep(50);
      handlers.abort({ nonce });
      const { element } = watch;
      const checked = checkedState(element);
      schedule();
      return {
        ok: true,
        effect: {
          mutations: Math.min(watch.mutations, 1000),
          urlChanged: location.href !== watch.url,
          focusChanged: document.activeElement !== watch.focus,
          stateChanged: stateOf(element) !== watch.state,
          ...(checked === undefined ? {} : { checked }),
          // Only whether the text arrived and the length; never the value.
          ...(typeof text === 'string'
            ? {
                typed: clear
                  ? element.value === text
                  : element.value.endsWith(text),
                length: element.value.length,
              }
            : {}),
        },
      };
    },
    abort({ nonce }) {
      const watch = prepared.get(nonce);
      prepared.delete(nonce);
      watch?.observer.disconnect();
      watch?.element.removeAttribute(TAG);
      return { ok: true };
    },
  };

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    const handler = handlers[message?.frameOp];
    if (sender.id !== chrome.runtime.id || sender.tab || !handler) return false;
    if (!observer && message.frameOp !== 'rejoin') return false;
    Promise.resolve()
      .then(() => handler(message))
      .then(reply, (error) =>
        reply({ ok: false, code: error.code ?? 'TARGET_MISSING' }),
      );
    return true;
  });
  if ((await hello())?.ok) start();
})();
