import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ConversationEngine,
  createChatHandler,
  FileConversationStore,
} from '@pagesquire/server';
import { manifest } from '../../tests/fixtures/capabilities.mjs';
import { DemoProvider } from '../node-chat/provider.mjs';

// Development-only session map and storage lifecycle; not a production authentication service.
const shared = (globalThis.__pagesquireNextFixture ??= {
  sessions: new Map(),
  directory: mkdtemp(join(tmpdir(), 'pagesquire-next-demo-')),
});
const origin = 'http://127.0.0.1:4176';
const lookup = (request) =>
  /(?:^|; )pagesquire_next=([a-f0-9]{48})(?:;|$)/.exec(
    request.headers.get('cookie') ?? '',
  )?.[1];
export function session(request) {
  let id = lookup(request);
  if (!shared.sessions.has(id)) {
    id = randomBytes(24).toString('hex');
    shared.sessions.set(id, randomBytes(24).toString('hex'));
  }
  return Response.json(
    { csrfToken: shared.sessions.get(id) },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Set-Cookie': `pagesquire_next=${id}; HttpOnly; SameSite=Strict; Path=/`,
      },
    },
  );
}
const provider = new DemoProvider();
const original = provider.complete.bind(provider);
provider.complete = async (...args) => {
  const result = await original(...args);
  if (result.toolCalls[0]?.capabilityId === 'browser.navigate')
    result.toolCalls[0].parameters.url = '/destination';
  return result;
};
export async function chat(request) {
  return createChatHandler({
    origin,
    engine: new ConversationEngine({ provider, manifest }),
    store: new FileConversationStore(await shared.directory),
    authorize: async (request) => {
      const key = lookup(request);
      const csrfToken = shared.sessions.get(key);
      return csrfToken
        ? {
            key,
            principal: 'fixture-guest',
            csrfToken,
            capabilityIds: [
              'browser.navigate',
              'accessibility.set_heading_color',
            ],
          }
        : null;
    },
  })(request);
}
