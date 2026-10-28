import type { ActionProgressEvent } from '@pagesquire/core';
import { en } from './i18n.js';
import type { MessageKey, Messages } from './i18n.js';

const recoveries: Record<string, MessageKey> = {
  CAPABILITY_UNAVAILABLE: 'recovery.unavailable',
  STALE_SNAPSHOT: 'recovery.stale',
  STALE_TARGET: 'recovery.stale',
  TARGET_MISSING: 'recovery.target',
  AMBIGUOUS_TARGET: 'recovery.target',
  UNKNOWN_CAPABILITY: 'recovery.permission',
  TARGET_NOT_ALLOWED: 'recovery.permission',
  URL_NOT_ALLOWED: 'recovery.permission',
  CONFIRMATION_REQUIRED: 'recovery.permission',
  LINK_NAVIGATION: 'recovery.permission',
  INVALID_CALL: 'recovery.rejected',
  INVALID_PARAMETERS: 'recovery.rejected',
  CALL_ID_REUSED: 'recovery.rejected',
  BUSY: 'recovery.busy',
  ACTION_LIMIT: 'recovery.limit',
  NAVIGATION_MISMATCH: 'recovery.navigation',
  NAVIGATION_UNAVAILABLE: 'recovery.navigation',
  INVALID_VERIFICATION: 'recovery.verification',
  APPROVAL_DENIED: 'recovery.approval',
  APPROVAL_TIMEOUT: 'recovery.approval',
  VISITOR_DECLINED: 'recovery.visitor',
  VISITOR_TIMEOUT: 'recovery.visitor',
  VISITOR_UNAVAILABLE: 'recovery.visitor',
  TARGET_HIDDEN: 'recovery.element',
  TARGET_DISABLED: 'recovery.element',
  TARGET_UNSTABLE: 'recovery.element',
  TARGET_COVERED: 'recovery.element',
};

/**
 * Fixed UI copy only. Never render adapter/provider messages as progress.
 * Pass the widget's resolved messages to localize; English by default.
 */
export function describeActionProgress(
  event: Pick<ActionProgressEvent, 'stage' | 'code'>,
  messages: Messages = en,
): { label: string; message: string } {
  if (event.stage === 'failed')
    return {
      label: messages['stage.failed'],
      message:
        messages[
          (event.code ? recoveries[event.code] : undefined) ??
            'recovery.default'
        ],
    };
  const key = `stage.${event.stage}` as MessageKey;
  return {
    label: messages[key],
    message: messages[`${key}.help` as MessageKey],
  };
}
