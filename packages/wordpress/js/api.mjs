export function route(config, name) {
  const url = new URL(config.rest);
  if (
    url.origin !== config.origin ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error('The REST endpoint must be same-origin.');
  if (url.searchParams.has('rest_route'))
    url.searchParams.set(
      'rest_route',
      url.searchParams.get('rest_route') + name,
    );
  else url.pathname += name;
  return url.href;
}
export async function readText(response, maximum = 262144) {
  if (!response.body) throw Error('The site returned an empty response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum)
        throw Error('The assistant response exceeded its limit.');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function api(config, name, { method = 'GET', body } = {}) {
  const response = await fetch(route(config, name), {
    method,
    credentials: 'same-origin',
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
    headers: {
      'Content-Type': 'application/json',
      ...(config.nonce ? { 'X-WP-Nonce': config.nonce } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await readText(response);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Error('The site returned an invalid JSON response.');
  }
  if (!response.ok)
    throw Error(
      String(
        data.message ??
          data.error?.message ??
          'The site rejected this request.',
      ).slice(0, 300),
    );
  return data;
}
