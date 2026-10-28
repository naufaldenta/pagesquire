// Relay between a granted page and the service worker. Runs in the main
// frame only. It answers the page's handshake on a private MessagePort, so
// other frames cannot listen in, forwards the contents of granted frames and
// session tabs to the page, and forwards the visitor's Escape as stop.
(() => {
  if (globalThis.pagesquireRelay) return;
  globalThis.pagesquireRelay = true;
  const PROTOCOL = 1;
  const OPS = new Set(['act', 'frame-inspect']);
  const ports = new Set();
  const ask = (message) =>
    chrome.runtime
      .sendMessage(message)
      .catch(() => ({ ok: false, code: 'UNAVAILABLE' }));
  const frames = (port, list) =>
    port.postMessage({
      type: 'pagesquire:frames',
      frames: Array.isArray(list) ? list : [],
    });
  const tabs = (port, list) =>
    port.postMessage({
      type: 'pagesquire:tabs',
      tabs: Array.isArray(list) ? list : [],
    });

  window.addEventListener('message', async (event) => {
    if (
      event.source !== window ||
      event.data?.type !== 'pagesquire:hello' ||
      event.data.version !== PROTOCOL
    )
      return;
    const port = event.ports[0];
    if (!port) return;
    // The worker may take a while to wake; tell the page the relay is here.
    port.postMessage({ type: 'pagesquire:hello-wait' });
    const hello = await ask({ op: 'hello' });
    if (!hello?.ok) {
      port.postMessage({ type: 'pagesquire:hello-nack' });
      port.close();
      return;
    }
    port.onmessage = async ({ data }) => {
      if (typeof data?.id !== 'number' || !OPS.has(data.op)) return;
      const result = await ask({ op: data.op, args: data.args });
      port.postMessage({
        id: data.id,
        ok: result?.ok === true,
        ...(typeof result?.code === 'string' ? { code: result.code } : {}),
        ...(result?.info ? { info: result.info } : {}),
        ...(result?.effect ? { effect: result.effect } : {}),
        ...(result?.screenshot ? { screenshot: result.screenshot } : {}),
      });
    };
    port.postMessage({
      type: 'pagesquire:hello-ack',
      version: hello.version,
      features: hello.features,
    });
    ports.add(port);
    frames(port, (await ask({ op: 'frames' }))?.frames);
    tabs(port, (await ask({ op: 'tabs' }))?.tabs);
  });

  // The worker pushes the latest contents of granted frames and session tabs.
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return;
    if (message?.type === 'pagesquire:frames')
      for (const port of ports) frames(port, message.frames);
    if (message?.type === 'pagesquire:tabs')
      for (const port of ports) tabs(port, message.tabs);
  });

  // Capturing on window from document_start runs before page listeners.
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && event.isTrusted) ask({ op: 'stop' });
    },
    true,
  );

  window.postMessage({ type: 'pagesquire:companion-ready' }, location.origin);
})();
