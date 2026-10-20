import { PROTOCOL_VERSION } from '@pagesquire/protocol';
import type { ActionCall, CapabilityDefinition } from '@pagesquire/protocol';
import type { NavigationAdapter } from './types.js';
import { canonicalJson } from './json.js';

export const navigationCapability: CapabilityDefinition = {
  id: 'browser.navigate',
  description: 'Navigate to a registered same-origin page.',
  execution: 'browser',
  handler: 'browser.navigate',
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string', minLength: 1, maxLength: 2048 } },
    required: ['url'],
    additionalProperties: false,
  },
  risk: 'reversible',
  verification: { handler: 'browser.verifyNavigation' },
};

export function documentNavigation(document: Document): NavigationAdapter {
  return {
    mode: 'document',
    navigate(url, signal) {
      signal.throwIfAborted();
      document.defaultView!.location.assign(url.href);
    },
  };
}

interface NavigationCheckpoint {
  protocolVersion: typeof PROTOCOL_VERSION;
  callId: string;
  expectedUrl: string;
  origin: string;
  issuedAt: number;
}

export class NavigationStore {
  constructor(
    private readonly storage: Storage,
    private readonly key = 'pagesquire:navigation:0.1',
    private readonly ttlMs = 60000,
  ) {}

  save(call: ActionCall, destination: URL): void {
    const checkpoint: NavigationCheckpoint = {
      protocolVersion: PROTOCOL_VERSION,
      callId: call.callId,
      expectedUrl: destination.href,
      origin: destination.origin,
      issuedAt: Date.now(),
    };
    this.storage.setItem(this.key, canonicalJson(checkpoint));
  }

  take(origin: string): NavigationCheckpoint | undefined {
    const serialized = this.storage.getItem(this.key);
    this.storage.removeItem(this.key);
    if (!serialized || serialized.length > 4096) return undefined;
    try {
      const value: unknown = JSON.parse(serialized);
      if (!value || typeof value !== 'object') return undefined;
      const data = value as Record<string, unknown>;
      if (
        Object.keys(data).sort().join(',') !==
          'callId,expectedUrl,issuedAt,origin,protocolVersion' ||
        data.protocolVersion !== PROTOCOL_VERSION ||
        data.origin !== origin ||
        typeof data.callId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(data.callId) ||
        typeof data.expectedUrl !== 'string' ||
        data.expectedUrl.length > 2048 ||
        typeof data.issuedAt !== 'number' ||
        data.issuedAt > Date.now() ||
        Date.now() - data.issuedAt > this.ttlMs
      )
        return undefined;
      return data as unknown as NavigationCheckpoint;
    } catch {
      return undefined;
    }
  }

  clear(): void {
    this.storage.removeItem(this.key);
  }
}
