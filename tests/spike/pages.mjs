// Fixture pages and loopback servers for the Phase 4D-0 spike. Three hosts give
// three sites, so Chromium's site isolation puts each frame in its own process:
// the page on 127.0.0.1, a partner frame on localhost and a nested frame on [::1].
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '../..');

const reactSource = `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
window.reactLog = [];
function App() {
  const [name, setName] = useState('');
  const [count, setCount] = useState(0);
  return (
    <form onSubmit={(e) => { e.preventDefault(); window.reactLog.push({ type: 'submit', name }); }}>
      <input id="react-input" aria-label="React name" value={name} onChange={(e) => {
        window.reactLog.push({ type: 'change', trusted: e.nativeEvent.isTrusted, value: e.target.value });
        setName(e.target.value.toUpperCase());
      }} />
      <button type="button" id="react-button" onClick={(e) => {
        window.reactLog.push({ type: 'click', trusted: e.nativeEvent.isTrusted });
        setCount((c) => c + 1);
      }}>Clicked {count}</button>
      <output id="react-state">{name}</output>
    </form>
  );
}
createRoot(document.getElementById('react-root')).render(<App />);
`;

const vueSource = `
import { createApp, ref, h, withDirectives, vModelText } from 'vue';
window.vueLog = [];
createApp({
  setup() {
    const name = ref('');
    const count = ref(0);
    return () => [
      withDirectives(h('input', {
        id: 'vue-input',
        'aria-label': 'Vue name',
        'onUpdate:modelValue': (value) => { window.vueLog.push({ type: 'model', value }); name.value = value; },
        onInput: (e) => window.vueLog.push({ type: 'input', trusted: e.isTrusted }),
      }), [[vModelText, name.value]]),
      h('button', { id: 'vue-button', type: 'button', onClick: (e) => {
        window.vueLog.push({ type: 'click', trusted: e.isTrusted });
        count.value++;
      } }, 'Clicked ' + count.value),
      h('output', { id: 'vue-state' }, name.value),
    ];
  },
}).mount('#vue-root');
`;

/** Vue is not a workspace dependency; point SPIKE_VUE_DIR at an install. */
export function vueDirectory() {
  const candidates = [process.env.SPIKE_VUE_DIR, root].filter(Boolean);
  for (const directory of candidates)
    try {
      createRequire(path.join(directory, 'noop.js')).resolve('vue');
      return path.join(directory, 'node_modules');
    } catch {}
  return undefined;
}

async function bundle(contents, nodePaths = []) {
  const result = await build({
    stdin: { contents, loader: 'jsx', resolveDir: root },
    bundle: true,
    write: false,
    format: 'iife',
    jsx: 'automatic',
    minify: true,
    nodePaths,
    logLevel: 'silent',
    define: {
      'process.env.NODE_ENV': '"production"',
      __VUE_OPTIONS_API__: 'false',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
  });
  return result.outputFiles[0].text;
}

const mainPage = (frameUrl, scripts) => `<!doctype html>
<html><head><title>Companion spike</title>
<style>
  body { font: 16px sans-serif; margin: 0; padding: 16px; }
  #cover-wrap { position: relative; display: inline-block; }
  #cover { position: absolute; inset: 0; background: rgb(0 0 0 / 0.2); }
  iframe { display: block; width: 520px; height: 260px; border: 2px solid #444; margin-top: 12px; }
  .spacer { height: 1200px; }
</style></head>
<body>
<h1>Companion spike</h1>
<button id="plain">Plain button</button>
<input id="plain-input" aria-label="Plain input">
<span id="cover-wrap"><button id="covered">Covered</button><span id="cover"></span></span>
<input id="secret" type="password" aria-label="Password">
<input id="otp" autocomplete="one-time-code" aria-label="Code">
<div data-pagesquire-private><input id="private" aria-label="Private"></div>
<div id="react-root"></div>
<div id="vue-root"></div>
<iframe id="partner" title="Partner" src="${frameUrl}"></iframe>
<div class="spacer"></div>
<button id="below">Below the fold</button>
<script>
  window.spikeLog = [];
  const record = (e) => spikeLog.push({ id: e.target.id, type: e.type, trusted: e.isTrusted, value: e.target.value ?? null, at: performance.now() });
  for (const id of ['plain', 'covered', 'below']) document.getElementById(id).addEventListener('click', record);
  const input = document.getElementById('plain-input');
  input.addEventListener('input', record);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && record(e));
  let sequence = 0;
  const pending = new Map();
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.type === 'pagesquire:hello-ack') pending.get('hello')?.(e.data);
    if (e.data?.type === 'pagesquire:result') { pending.get(e.data.id)?.(e.data.result); pending.delete(e.data.id); }
  });
  window.spikeHello = (timeout = 500) => new Promise((resolve) => {
    pending.set('hello', resolve);
    setTimeout(() => resolve(null), timeout);
    postMessage({ type: 'pagesquire:hello' }, '*');
  });
  window.spikeCall = (op, args = {}) => new Promise((resolve) => {
    const id = ++sequence;
    pending.set(id, resolve);
    postMessage({ type: 'pagesquire:call', id, op, args }, '*');
  });
  /** The page tags one element per call; the extension resolves only the nonce. */
  window.tag = (selector) => {
    const nonce = crypto.randomUUID();
    document.querySelector(selector).setAttribute('data-pagesquire-target', nonce);
    return nonce;
  };
  // Lifetime probe: read the worker's boot ID, optionally attach, stay idle,
  // then read it again. A new ID means Chrome stopped the worker in between.
  const lifetime = new URLSearchParams(location.search);
  if (lifetime.has('lifetime')) (async () => {
    const mode = lifetime.get('lifetime');
    const idleMs = Number(lifetime.get('idle'));
    if (!(await spikeHello(5000))) {
      await fetch('/report', { method: 'POST', body: JSON.stringify({ mode, error: 'no extension' }) });
      return;
    }
    const first = await spikeCall('status');
    if (mode === 'attached') await spikeCall('attach');
    await new Promise((resolve) => setTimeout(resolve, idleMs));
    const second = await spikeCall('status');
    await fetch('/report', { method: 'POST', body: JSON.stringify({
      mode, idleMs, restarted: first.bootId !== second.bootId, attachedTabs: second.attachedTabs,
    }) });
  })();
</script>
${scripts.map((src) => `<script src="${src}"></script>`).join('\n')}
</body></html>`;

const partnerPage = (nestedUrl) => `<!doctype html>
<html><head><title>Partner</title></head>
<body style="font: 14px sans-serif">
<p>Partner frame text</p>
<button id="frame-button" data-pagesquire-target="frame-button">Frame button</button>
<input id="frame-input" data-pagesquire-target="frame-input" aria-label="Frame input">
<iframe title="Nested" src="${nestedUrl}" style="display: block; width: 300px; height: 90px; margin-top: 8px"></iframe>
<div style="height: 600px"></div>
<button id="frame-below" data-pagesquire-target="frame-below">Frame below</button>
<script>
  window.frameLog = [];
  const record = (e) => frameLog.push({ id: e.target.id, type: e.type, trusted: e.isTrusted, value: e.target.value ?? null });
  document.getElementById('frame-button').addEventListener('click', record);
  document.getElementById('frame-input').addEventListener('input', record);
  document.getElementById('frame-below').addEventListener('click', record);
</script>
</body></html>`;

const nestedPage = `<!doctype html>
<html><head><title>Nested</title></head>
<body style="font: 14px sans-serif">
<button id="nested-button" data-pagesquire-target="nested-button">Nested button</button>
<script>
  window.frameLog = [];
  document.getElementById('nested-button').addEventListener('click', (e) => frameLog.push({ id: e.target.id, trusted: e.isTrusted }));
</script>
</body></html>`;

function listen(host, routes) {
  const server = createServer((request, response) => {
    const route = routes()[new URL(request.url, 'http://x').pathname];
    if (!route) {
      response.writeHead(404).end();
      return;
    }
    if (typeof route === 'function') {
      route(request, response);
      return;
    }
    response.writeHead(200, {
      'content-type': route.type,
      'cache-control': 'no-store',
    });
    response.end(route.body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve(server));
  });
}

/** Starts the three sites. Lifetime probes POST their results to /report. */
export async function startSites() {
  const reports = [];
  const report = (request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      reports.push(JSON.parse(body));
      response.writeHead(204).end();
    });
  };
  const vue = vueDirectory();
  const scripts = { '/react.js': await bundle(reactSource) };
  if (vue) scripts['/vue.js'] = await bundle(vueSource, [vue]);
  const urls = {};
  const html = (body) => ({ type: 'text/html; charset=utf-8', body });
  const nested = await listen('::1', () => ({
    '/nested.html': html(nestedPage),
  }));
  urls.nested = `http://[::1]:${nested.address().port}/nested.html`;
  const partner = await listen('127.0.0.1', () => ({
    '/partner.html': html(partnerPage(urls.nested)),
  }));
  urls.partner = `http://localhost:${partner.address().port}/partner.html`;
  const main = await listen('127.0.0.1', () => ({
    '/': html(mainPage(urls.partner, Object.keys(scripts))),
    ...Object.fromEntries(
      Object.entries(scripts).map(([name, body]) => [
        name,
        { type: 'text/javascript', body },
      ]),
    ),
    '/report': report,
  }));
  urls.main = `http://127.0.0.1:${main.address().port}/`;
  urls.other = `http://localhost:${partner.address().port}/partner.html`;
  return {
    urls,
    vue: Boolean(vue),
    reports,
    close: () => {
      for (const server of [main, partner, nested]) {
        server.closeAllConnections();
        server.close();
      }
    },
  };
}
