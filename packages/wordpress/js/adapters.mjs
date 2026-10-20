import {
  BrowserRuntime,
  CapabilityRegistry,
  NavigationStore,
  PageObserver,
} from '@pagesquire/core';
import { manifest } from './capabilities.mjs';
import { parameters } from '../dist/generated/bindings.mjs';

export function createRuntime(config, document) {
  const visible = (element) =>
    observer.isVisible(element) && !observer.isExcluded(element);
  const root = () => observer.findUnique(config.mapping.contentRoot);
  const headings = () =>
    [...root().querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible);
  const links = () => [...root().querySelectorAll('a[href]')].filter(visible);
  const local = {
    ...manifest,
    capabilities: manifest.capabilities.filter((entry) =>
      config.mapping.capabilityIds.includes(entry.id),
    ),
  };
  const allowed = (value) => {
    const url = new URL(value);
    if (config.inspect) url.searchParams.delete('pagesquire_inspect');
    return config.pages.some((page) => new URL(page.url).href === url.href);
  };
  const observer = new PageObserver({ document, allowUrl: allowed });
  const normalizedColor = (color) => {
    const element = document.createElement('span');
    element.style.color = color;
    return element.style.color;
  };
  const handlers = {
    'accessibility.set_heading_color': (args, context) => {
      context.signal.throwIfAborted();
      const targets = headings();
      if (!targets.length) throw Error('No public headings');
      targets.forEach((element) => {
        element.style.color = args.color;
      });
    },
    'accessibility.set_link_highlight': (args, context) => {
      context.signal.throwIfAborted();
      const targets = links();
      if (!targets.length) throw Error('No public links');
      targets.forEach((element) =>
        element.classList.toggle('pagesquire-link-highlight', args.enabled),
      );
    },
    'accessibility.set_font_weight': (args, context) => {
      context.signal.throwIfAborted();
      root().style.fontWeight = String(args.weight);
    },
    'browser.navigate': (args, context) => context.navigate(args.url),
  };
  const verifiers = {
    'accessibility.set_heading_color.verify': (args) => ({
      verified:
        headings().length > 0 &&
        headings().every(
          (element) =>
            document.defaultView.getComputedStyle(element).color ===
            normalizedColor(args.color),
        ),
      evidence: { headings: headings().length },
    }),
    'accessibility.set_link_highlight.verify': (args) => ({
      verified:
        links().length > 0 &&
        links().every((element) => {
          const style = document.defaultView.getComputedStyle(element);
          return (
            element.classList.contains('pagesquire-link-highlight') ===
              args.enabled &&
            (!args.enabled ||
              (style.outlineStyle === 'solid' && style.outlineWidth === '2px'))
          );
        }),
      evidence: { links: links().length },
    }),
    'accessibility.set_font_weight.verify': (args) => ({
      verified:
        document.defaultView.getComputedStyle(root()).fontWeight ===
        String(args.weight),
    }),
    'browser.verifyNavigation': (args) => ({
      verified:
        document.URL === new URL(args.url, document.URL).href &&
        allowed(document.URL) &&
        Boolean(root()),
      evidence: { ready: true },
    }),
  };
  const registry = new CapabilityRegistry(local, {
    handlers,
    verifiers,
    parameters,
  });
  let navigationStore;
  try {
    navigationStore = new NavigationStore(
      document.defaultView.sessionStorage,
      config.inspect
        ? 'pagesquire:wp-inspection:0.1'
        : 'pagesquire:wp-navigation:0.1',
    );
  } catch {}
  return {
    observer,
    runtime: new BrowserRuntime({
      observer,
      registry,
      timeoutMs: 5000,
      ...(navigationStore ? { navigationStore } : {}),
    }),
    root,
    headings,
    links,
  };
}
