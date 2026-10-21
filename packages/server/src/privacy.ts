import type { ConversationStore } from './store.js';

function fail(code: string, message: string, status = 422): never {
  throw Object.assign(new Error(message), {
    name: 'ConversationPrivacyError',
    code,
    status,
  });
}

/** Host-authorized transcript erasure; not a public endpoint or quota reset. */
export async function forgetConversation(
  store: ConversationStore,
  key: string,
  principal: string,
): Promise<boolean> {
  if (
    typeof key !== 'string' ||
    !key ||
    key.length > 2048 ||
    typeof principal !== 'string' ||
    !principal ||
    principal.length > 2048
  )
    fail('INVALID_SESSION', 'Use a trusted session key and principal.');
  return store.transaction(key, async (transaction) => {
    const stored = await transaction.load();
    if (stored === null) return false;
    if (stored.principal !== principal)
      fail('ACCESS_DENIED', 'This conversation is not authorized.', 403);
    if (
      !stored.rate ||
      !Number.isSafeInteger(stored.rate.since) ||
      stored.rate.since < 0 ||
      !Number.isSafeInteger(stored.rate.count) ||
      stored.rate.count < 0 ||
      !Object.hasOwn(stored, 'state')
    )
      fail('INVALID_STORE', 'Assistant storage requires operator review.', 500);
    if (stored.state === null) return false;
    await transaction.save({ ...stored, state: null });
    return true;
  });
}
