import { PageSquireError, canonicalJson } from '@pagesquire/core';

export interface ChatNavigationCheckpoint {
  conversationId: string;
  callId: string;
  expectedUrl: string;
  origin: string;
  issuedAt: number;
  remainingRounds: number;
}
/** Opt-in per-tab continuation: no messages, parameters, page content or provider keys are stored. */
export class ChatNavigationStore {
  constructor(
    private readonly storage: Storage,
    private readonly key = 'pagesquire:chat-navigation:0.1',
  ) {}
  save(checkpoint: ChatNavigationCheckpoint): void {
    try {
      this.storage.setItem(this.key, canonicalJson(checkpoint, 4096));
    } catch {
      throw new PageSquireError(
        'NAVIGATION_UNAVAILABLE',
        'Navigation continuation storage is unavailable.',
      );
    }
  }
  clear(): void {
    try {
      this.storage.removeItem(this.key);
    } catch {
      /* Storage may be disabled after navigation. */
    }
  }
  take(origin: string): ChatNavigationCheckpoint | undefined {
    try {
      const raw = this.storage.getItem(this.key);
      this.storage.removeItem(this.key);
      if (!raw || raw.length > 4096) return;
      const value = JSON.parse(raw) as ChatNavigationCheckpoint;
      if (
        !value ||
        Object.keys(value).sort().join(',') !==
          'callId,conversationId,expectedUrl,issuedAt,origin,remainingRounds' ||
        value.origin !== origin ||
        typeof value.expectedUrl !== 'string' ||
        value.expectedUrl.length > 2048 ||
        new URL(value.expectedUrl).origin !== origin ||
        typeof value.callId !== 'string' ||
        typeof value.conversationId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(value.callId) ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(value.conversationId) ||
        !Number.isInteger(value.issuedAt) ||
        value.issuedAt > Date.now() ||
        Date.now() - value.issuedAt > 60000 ||
        !Number.isInteger(value.remainingRounds) ||
        value.remainingRounds < 1 ||
        value.remainingRounds > 40
      )
        return;
      return value;
    } catch {
      return;
    }
  }
}
