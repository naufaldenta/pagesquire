// Relay between the page and the service worker. The real design adds grants
// and signature checks here; the spike only measures the round trip.
window.addEventListener('message', (event) => {
  if (event.source !== window || typeof event.data !== 'object') return;
  const { type, id, op, args } = event.data ?? {};
  if (type === 'pagesquire:hello') {
    window.postMessage({ type: 'pagesquire:hello-ack', version: 0 }, '*');
    return;
  }
  if (type !== 'pagesquire:call') return;
  chrome.runtime.sendMessage({ op, args }).then(
    (result) =>
      window.postMessage({ type: 'pagesquire:result', id, result }, '*'),
    (error) =>
      window.postMessage(
        { type: 'pagesquire:result', id, result: { error: String(error) } },
        '*',
      ),
  );
});
