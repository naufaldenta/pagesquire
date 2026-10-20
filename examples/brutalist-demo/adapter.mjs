import {
  BrowserRuntime,
  CapabilityRegistry,
  PageObserver,
  setControlValue,
} from '../../packages/core/dist/index.js';
import { manifest } from './capabilities.mjs';
import { parameters } from './dist/bindings.js';

// Explicit adapter targets only. Assistant controls are excluded from observation.
export function createOffbeatRuntime(document, onActivityChange) {
  const view = document.defaultView;
  const page = document.getElementById('offbeat-page');
  const controls = {
    'accessibility.set_heading_color': ['heading-color', 'color'],
    'accessibility.set_link_highlight': ['link-highlight', 'enabled'],
    'accessibility.set_font_weight': ['font-weight', 'weight'],
    'accessibility.set_text_size': ['text-size', 'size'],
    'gallery.filter': ['art-style', 'style'],
  };
  const copy = () => [...page.querySelectorAll('[data-reading-copy]')];
  const headings = () => [...page.querySelectorAll('h1, h2, h3')];
  const links = () => [...page.querySelectorAll('a[href]')];
  const allStyled = (elements, property, expected) =>
    elements.length > 0 &&
    elements.every(
      (element) => view.getComputedStyle(element)[property] === expected,
    );
  const checks = {
    'accessibility.set_heading_color': ({ color }) => {
      const sample = document.createElement('span');
      sample.style.color = color;
      return allStyled(headings(), 'color', sample.style.color);
    },
    'accessibility.set_link_highlight': ({ enabled }) =>
      enabled
        ? allStyled(links(), 'backgroundColor', 'rgb(217, 255, 71)') &&
          links().every((element) =>
            view
              .getComputedStyle(element)
              .textDecorationLine.includes('underline'),
          )
        : !page.classList.contains('links-highlighted') &&
          links().every(
            (element) =>
              view.getComputedStyle(element).backgroundColor !==
              'rgb(217, 255, 71)',
          ),
    'accessibility.set_font_weight': ({ weight }) =>
      allStyled(copy(), 'fontWeight', String(weight)),
    'accessibility.set_text_size': ({ size }) =>
      allStyled(copy(), 'fontSize', `${size}px`),
    'gallery.filter': ({ style }) => {
      const cards = [...page.querySelectorAll('[data-art-card]')];
      const expected = cards.filter(
        (card) => style === 'all' || card.dataset.artStyle === style,
      );
      return (
        expected.length > 0 &&
        cards.every((card) => card.hidden === !expected.includes(card))
      );
    },
    'page.scroll_to': ({ section }) => {
      const target = document.getElementById(section);
      return Boolean(
        target && Math.abs(target.getBoundingClientRect().top) < 4,
      );
    },
  };
  const handlers = {};
  const verifiers = {};
  for (const definition of manifest.capabilities) {
    handlers[definition.handler] = async (args, context) => {
      context.signal.throwIfAborted();
      if (definition.id === 'page.scroll_to') {
        document
          .getElementById(args.section)
          .scrollIntoView({ behavior: 'instant', block: 'start' });
      } else {
        const [id, parameter] = controls[definition.id];
        setControlValue(
          document.getElementById(id),
          String(args[parameter]),
          context.signal,
        );
      }
      await context.waitFor(() => checks[definition.id](args));
    };
    verifiers[definition.verification.handler] = (args) => ({
      verified: checks[definition.id](args),
      evidence: { checked: 'rendered DOM and computed styles', ...args },
    });
  }
  return new BrowserRuntime({
    observer: new PageObserver({
      document,
      allowUrl: (url) => url.pathname === '/',
      canInteract: () => false,
    }),
    registry: new CapabilityRegistry(manifest, {
      handlers,
      verifiers,
      parameters,
    }),
    onActivityChange,
    timeoutMs: 5000,
    maxActions: 500,
  });
}
