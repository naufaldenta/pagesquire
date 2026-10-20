import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConversationEngine,
  createChatHandler,
  FileConversationStore,
} from '@pagesquire/server';
import { DemoProvider } from './provider.mjs';

const origin = 'http://127.0.0.1:4175';
const sessions = new Map(); // Local fixture only: production must use the host's real session/auth service.
const directory = await realpath(
  await mkdtemp(join(await realpath(tmpdir()), 'pagesquire-node-demo-')),
);
const manifest = JSON.parse(
  await readFile('tests/fixtures/dist/manifest.json', 'utf8'),
);
const handler = createChatHandler({
  engine: new ConversationEngine({ provider: new DemoProvider(), manifest }),
  store: new FileConversationStore(directory),
  origin,
  authorize: async (request) => {
    const id = /(?:^|; )pagesquire_node=([a-f0-9]{48})(?:;|$)/.exec(
      request.headers.get('cookie') ?? '',
    )?.[1];
    const csrfToken = sessions.get(id);
    return csrfToken
      ? {
          key: id,
          principal: 'demo-guest',
          csrfToken,
          capabilityIds: manifest.capabilities.map((entry) => entry.id),
        }
      : null;
  },
});
const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/next.html', ['index.html', 'text/html']],
  ['/demo.css', ['demo.css', 'text/css']],
  ['/dist/demo.js', ['dist/demo.js', 'text/javascript']],
  ['/dist/widget.css', ['dist/widget.css', 'text/css']],
]);
const server = createServer(async (incoming, outgoing) => {
  outgoing.setHeader('Cache-Control', 'no-store');
  outgoing.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  );
  try {
    const path = new URL(incoming.url, origin).pathname;
    if (path === '/chat') {
      const request = new Request(new URL(path, origin), {
        method: incoming.method,
        headers: incoming.headers,
        ...(incoming.method !== 'GET' && incoming.method !== 'HEAD'
          ? { body: Readable.toWeb(incoming), duplex: 'half' }
          : {}),
      });
      const response = await handler(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
      return;
    }
    if (incoming.method !== 'GET' || !files.has(path)) {
      outgoing.writeHead(404).end();
      return;
    }
    const [file, type] = files.get(path);
    let data = await readFile(join('examples/plain-html', file));
    if (type === 'text/html') {
      let id = /(?:^|; )pagesquire_node=([a-f0-9]{48})(?:;|$)/.exec(
        incoming.headers.cookie ?? '',
      )?.[1];
      if (!sessions.has(id)) {
        id = randomBytes(24).toString('hex');
        sessions.set(id, randomBytes(24).toString('hex'));
        outgoing.setHeader(
          'Set-Cookie',
          `pagesquire_node=${id}; HttpOnly; SameSite=Strict; Path=/`,
        );
      }
      data = data
        .toString()
        .replace(
          '</head>',
          `<meta name="pagesquire-endpoint" content="/chat"><meta name="csrf-token" content="${sessions.get(id)}"></head>`,
        );
    }
    outgoing.writeHead(200, { 'Content-Type': type });
    outgoing.end(data);
  } catch {
    outgoing.writeHead(500).end('The demo is unavailable.');
  }
});
server.listen(4175, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => server.close());
