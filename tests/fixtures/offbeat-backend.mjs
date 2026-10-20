/** Synthetic credentials/provider/store only. Never imported by the deployed function. */
import { setTimeout as delay } from 'node:timers/promises';
import { createBackend } from '../../examples/brutalist-demo/server/backend.mjs';
import { StoreError } from '../../examples/brutalist-demo/server/store.mjs';

export const testConfig = {
  origin: 'http://127.0.0.1:4180',
  secure: false,
  sessionSecret: 'a'.repeat(64),
  accessCode: 'offbeat-test-access-code',
  dailyLimit: 10000,
  ipDailyLimit: 1000,
  trustVercel: false,
};

export class SyntheticStore {
  values = new Map();
  locks = new Set();
  counters = new Map();
  ready = async () => {};
  cleanup = async () => {};
  async consume(id, maximum, seconds) {
    let counter = this.counters.get(id);
    if (!counter || counter.expires <= Date.now())
      counter = { count: 0, expires: Date.now() + seconds * 1000 };
    if (counter.count >= maximum)
      throw new StoreError(
        'RATE_LIMITED',
        'Demo usage limit reached.',
        429,
        seconds,
      );
    counter.count++;
    this.counters.set(id, counter);
  }
  async transaction(key, operation) {
    if (this.locks.has(key)) throw new StoreError('BUSY', 'Busy.', 409);
    this.locks.add(key);
    try {
      return await operation({
        load: async () => structuredClone(this.values.get(key) ?? null),
        save: async (value) => this.values.set(key, structuredClone(value)),
      });
    } finally {
      this.locks.delete(key);
    }
  }
}

export class SyntheticProvider {
  calls = 0;
  async complete(messages) {
    this.calls++;
    await delay(120);
    let message = '';
    let offeredLinks = false;
    const results = [];
    for (const entry of messages) {
      if (entry.role === 'assistant') {
        try {
          if (
            JSON.parse(entry.content).text ===
            'Would you like me to highlight page links?'
          )
            offeredLinks = true;
        } catch {}
        continue;
      }
      if (entry.role !== 'user') continue;
      let data;
      try {
        data = JSON.parse(entry.content);
      } catch {}
      if (!data || typeof data !== 'object') {
        message = entry.content.toLowerCase();
        results.length = 0;
      } else if (data.browserResult) results.push(data.browserResult);
    }
    const queue = [];
    if (message === 'suggest a link action')
      return {
        text: 'Would you like me to highlight page links?',
        emotion: 'idle',
        finished: true,
        toolCalls: [],
      };
    if (message === 'yes make all' && offeredLinks)
      queue.push({
        capabilityId: 'accessibility.set_link_highlight',
        parameters: { enabled: true },
      });
    if (/highlight(?:\s+all)?\s+heading/.test(message))
      queue.push({
        capabilityId: 'accessibility.set_heading_highlight',
        parameters: { enabled: !message.includes('disable') },
      });
    if (message.includes('reset'))
      queue.push({
        capabilityId: 'page.reset',
        parameters: { scope: message.includes('reading') ? 'reading' : 'all' },
      });
    if (
      message.includes('body') &&
      (message.includes('violet') || message.includes('red'))
    )
      queue.push({
        capabilityId: 'accessibility.set_text_color',
        parameters: {
          color: message.includes('violet') ? '#6440d5' : '#c52b28',
        },
      });
    if (message.includes('line spacing'))
      queue.push({
        capabilityId: 'accessibility.set_line_spacing',
        parameters: { spacing: message.includes('double') ? 2 : 1.8 },
      });
    if (message.includes('serif'))
      queue.push({
        capabilityId: 'accessibility.set_reading_font',
        parameters: { font: 'serif' },
      });
    if (message.includes('search art for '))
      queue.push({
        capabilityId: 'gallery.search',
        parameters: { query: message.split('search art for ')[1].slice(0, 80) },
      });
    if (message.includes('clear search'))
      queue.push({ capabilityId: 'gallery.search', parameters: { query: '' } });
    if (message.includes('sort art'))
      queue.push({
        capabilityId: 'gallery.sort',
        parameters: {
          order: message.includes('z to a') ? 'title-desc' : 'title-asc',
        },
      });
    if (message.includes('footer'))
      queue.push({
        capabilityId: 'page.scroll_to',
        parameters: { section: 'footer' },
      });
    if (message.includes('heading') && /red|violet|color/.test(message))
      queue.push({
        capabilityId: 'accessibility.set_heading_color',
        parameters: { color: '#c52b28' },
      });
    if (message.includes('link'))
      queue.push({
        capabilityId: 'accessibility.set_link_highlight',
        parameters: { enabled: true },
      });
    if (message.includes('bold'))
      queue.push({
        capabilityId: 'accessibility.set_font_weight',
        parameters: { weight: 700 },
      });
    if (queue[results.length])
      return {
        text: 'Premature success must be hidden.',
        emotion: 'happy',
        finished: false,
        toolCalls: [queue[results.length]],
      };
    return {
      text: results.length
        ? 'Requested changes verified on this page.'
        : 'Synthetic OFFBEAT response.',
      emotion: results.length ? 'happy' : 'idle',
      finished: true,
      toolCalls: [],
    };
  }
}

export function syntheticBackend() {
  const store = new SyntheticStore();
  const consume = store.consume.bind(store);
  // Parallel browser scenarios share one synthetic loopback IP. Never used in production or unit quota tests.
  store.consume = (id, maximum, seconds) => consume(id, maximum * 100, seconds);
  return createBackend({
    config: testConfig,
    store,
    provider: new SyntheticProvider(),
  });
}
