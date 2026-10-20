import {
  BrowserRuntime,
  CapabilityRegistry,
  PageObserver,
  setControlValue,
} from '../../packages/core/dist/index.js';
import { manifest } from './capabilities.mjs';
import { parameters } from './dist/bindings.js';
import { galleryView, readingFonts } from './art.mjs';

// Explicit adapter targets only. Assistant controls are excluded from observation.
export function createOffbeatRuntime(document, onActivityChange, resetPage) {
  const view = document.defaultView;
  const page = document.getElementById('offbeat-page');
  const controls = {
    'accessibility.set_heading_color': ['heading-color', 'color'],
    'accessibility.set_link_highlight': ['link-highlight', 'enabled'],
    'accessibility.set_heading_highlight': ['heading-highlight', 'enabled'],
    'accessibility.set_font_weight': ['font-weight', 'weight'],
    'accessibility.set_text_size': ['text-size', 'size'],
    'accessibility.set_text_color': ['text-color', 'color'],
    'accessibility.set_line_spacing': ['line-spacing', 'spacing'],
    'accessibility.set_reading_font': ['reading-font', 'font'],
    'gallery.filter': ['art-style', 'style'],
    'gallery.search': ['art-query', 'query'],
    'gallery.sort': ['art-order', 'order'],
  };
  const copy = () => [...page.querySelectorAll('[data-reading-copy]')];
  const headings = () => [...page.querySelectorAll('h1, h2, h3')];
  const links = () => [...page.querySelectorAll('a[href]')];
  const originalCopyColors = new Map(
    copy().map((element) => [element, view.getComputedStyle(element).color]),
  );
  const originalHeadingBackgrounds = new Map(
    headings().map((element) => [
      element,
      view.getComputedStyle(element).backgroundColor,
    ]),
  );
  const originalLinks = new Map(
    links().map((element) => {
      const style = view.getComputedStyle(element);
      return [
        element,
        {
          background: style.backgroundColor,
          decoration: style.textDecorationLine,
        },
      ];
    }),
  );
  const allStyled = (elements, property, expected) =>
    elements.length > 0 &&
    elements.every(
      (element) => view.getComputedStyle(element)[property] === expected,
    );
  const checks = {
    'accessibility.set_heading_highlight': ({ enabled }) =>
      headings().length > 0 &&
      headings().every((element) =>
        enabled
          ? view.getComputedStyle(element).backgroundColor ===
            'rgb(217, 255, 71)'
          : view.getComputedStyle(element).backgroundColor ===
            originalHeadingBackgrounds.get(element),
      ),
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
              view.getComputedStyle(element).backgroundColor ===
                originalLinks.get(element).background &&
              view.getComputedStyle(element).textDecorationLine ===
                originalLinks.get(element).decoration,
          ),
    'accessibility.set_font_weight': ({ weight }) =>
      allStyled(copy(), 'fontWeight', String(weight)),
    'accessibility.set_text_size': ({ size }) =>
      allStyled(copy(), 'fontSize', `${size}px`),
    'accessibility.set_text_color': ({ color }) => {
      const sample = document.createElement('span');
      sample.style.color = color === 'original' ? '#171717' : color;
      return (
        copy().length > 0 &&
        copy().every(
          (element) =>
            view.getComputedStyle(element).color ===
            (color === 'original'
              ? originalCopyColors.get(element)
              : sample.style.color),
        )
      );
    },
    'accessibility.set_line_spacing': ({ spacing }) =>
      copy().length > 0 &&
      copy().every((element) => {
        const style = view.getComputedStyle(element);
        return (
          Math.abs(
            parseFloat(style.lineHeight) - parseFloat(style.fontSize) * spacing,
          ) < 0.2
        );
      }),
    'accessibility.set_reading_font': ({ font }) =>
      copy().length > 0 &&
      copy().every((element) =>
        view
          .getComputedStyle(element)
          .fontFamily.startsWith(readingFonts[font].split(',')[0]),
      ),
    'gallery.filter': ({ style }) => {
      return (
        document.getElementById('art-style').value === style &&
        galleryVerified()
      );
    },
    'gallery.search': ({ query }) =>
      document.getElementById('art-query').value === query && galleryVerified(),
    'gallery.sort': ({ order }) =>
      document.getElementById('art-order').value === order && galleryVerified(),
    'page.reset': ({ scope }) =>
      readingRestored() &&
      (scope === 'reading' ||
        (document.getElementById('art-style').value === 'all' &&
          document.getElementById('art-query').value === '' &&
          document.getElementById('art-order').value === 'featured' &&
          galleryVerified())),
    'page.scroll_to': ({ section }) => {
      const target = document.getElementById(section);
      if (!target) return false;
      const expected = Math.min(
        target.getBoundingClientRect().top + view.scrollY,
        document.documentElement.scrollHeight - view.innerHeight,
      );
      return Math.abs(view.scrollY - Math.max(0, expected)) < 4;
    },
  };
  function galleryVerified() {
    const expected = galleryView(
      document.getElementById('art-style').value,
      document.getElementById('art-query').value,
      document.getElementById('art-order').value,
    );
    const cards = [...page.querySelectorAll('[data-art-card]')];
    return (
      cards.length === expected.length &&
      cards.every(
        (card, index) =>
          card.dataset.artId === expected[index].id &&
          card.hidden === !expected[index].visible,
      )
    );
  }
  function readingRestored() {
    return (
      checks['accessibility.set_heading_color']({ color: '#171717' }) &&
      checks['accessibility.set_text_color']({ color: 'original' }) &&
      checks['accessibility.set_link_highlight']({ enabled: false }) &&
      checks['accessibility.set_heading_highlight']({ enabled: false }) &&
      checks['accessibility.set_font_weight']({ weight: 400 }) &&
      checks['accessibility.set_text_size']({ size: 16 }) &&
      checks['accessibility.set_line_spacing']({ spacing: 1.6 }) &&
      checks['accessibility.set_reading_font']({ font: 'sans' })
    );
  }
  const handlers = {};
  const verifiers = {};
  for (const definition of manifest.capabilities) {
    handlers[definition.handler] = async (args, context) => {
      context.signal.throwIfAborted();
      if (definition.id === 'page.reset') {
        if (typeof resetPage !== 'function')
          throw Error('Reset binding is unavailable.');
        resetPage(args.scope);
      } else if (definition.id === 'page.scroll_to') {
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
