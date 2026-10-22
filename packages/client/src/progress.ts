import type { ActionProgressEvent } from '@pagesquire/core';

/** Fixed UI copy only. Never render adapter/provider messages as progress. */
export function describeActionProgress(
  event: Pick<ActionProgressEvent, 'stage' | 'code'>,
): { label: string; message: string } {
  switch (event.stage) {
    case 'checking':
      return {
        label: 'Checking',
        message: 'Checking the registered action, parameters and current page.',
      };
    case 'executing':
      return {
        label: 'Executing',
        message:
          'Running the registered action. Completion is not yet verified.',
      };
    case 'verifying':
      return {
        label: 'Verifying',
        message:
          'Checking the actual result against the registered postcondition.',
      };
    case 'navigation_pending':
      return {
        label: 'Awaiting destination',
        message:
          'Navigation started, not verified. Destination verification requires the configured continuation.',
      };
    case 'verified':
      return {
        label: 'Verified',
        message:
          'The registered postcondition passed. This is not proof of every part of your request.',
      };
    case 'unverified':
      return {
        label: 'Not verified',
        message:
          'The postcondition did not pass. Check the page before making a new request; changes are not rolled back.',
      };
    case 'cancelled':
      return {
        label: 'Stopped',
        message:
          'Stopped waiting. Existing or in-flight changes are not rolled back. Check the page before trying again.',
      };
    case 'timed_out':
      return {
        label: 'Timed out',
        message:
          'The time limit expired. An in-flight handler may still finish. Check the page before trying again.',
      };
    case 'replayed':
      return {
        label: 'Cached result',
        message:
          'Reused a recorded result; the action was not run or verified again.',
      };
    case 'failed': {
      const recovery = (() => {
        switch (event.code) {
          case 'CAPABILITY_UNAVAILABLE':
            return 'This action is unavailable in the current app state. Finish loading or update the required selection, then make a new request.';
          case 'STALE_SNAPSHOT':
          case 'STALE_TARGET':
            return 'The page changed. Check its current state, then make a new request.';
          case 'TARGET_MISSING':
          case 'AMBIGUOUS_TARGET':
            return 'A unique public target could not be found. Open the relevant section or ask the site owner to review the binding.';
          case 'UNKNOWN_CAPABILITY':
          case 'TARGET_NOT_ALLOWED':
          case 'URL_NOT_ALLOWED':
          case 'CONFIRMATION_REQUIRED':
            return 'The registered permissions do not allow this action. Ask for a supported action; the assistant cannot grant itself access.';
          case 'INVALID_CALL':
          case 'INVALID_PARAMETERS':
          case 'CALL_ID_REUSED':
            return 'The action request was rejected. Make a new request; repeated failures need an integration review.';
          case 'BUSY':
            return 'Another action is active. Wait for it to finish or stop it before making a new request.';
          case 'ACTION_LIMIT':
            return 'The browser session action limit was reached. Contact the site owner; no automatic retry was made.';
          case 'NAVIGATION_MISMATCH':
          case 'NAVIGATION_UNAVAILABLE':
            return 'The destination could not be verified safely. Check the page and start a new conversation.';
          case 'INVALID_VERIFICATION':
            return 'The verifier returned an invalid result. Check the page and ask the site owner to review the integration.';
          default:
            return 'The registered action or verifier failed. Check the page before trying again; no automatic retry or rollback was performed.';
        }
      })();
      return { label: 'Failed', message: recovery };
    }
  }
}
