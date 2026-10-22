import { BrowserRuntime } from '@pagesquire/core';
import type { RuntimeOptions, ActionProgressEvent } from '@pagesquire/core';
import { describeActionProgress } from '@pagesquire/client';
import type { ChatState } from '@pagesquire/client';

export function connectProgress(
  options: RuntimeOptions,
  state: ChatState,
): string[] {
  const runtime = new BrowserRuntime({
    ...options,
    onActionProgress: (event) => {
      const title = describeActionProgress(event).label;
      // @ts-expect-error Runtime progress does not expose input values.
      event.parameters;
      // @ts-expect-error Progress metadata is immutable to observers.
      event.stage = 'verified';
      return title;
    },
  });
  void runtime;
  return state.actionProgress.map(
    (entry) => describeActionProgress(entry).message,
  );
}
const invalid: ActionProgressEvent = {
  callId: 'x',
  capabilityId: 'app.toggle',
  // @ts-expect-error Model thinking is not an action lifecycle stage.
  stage: 'thinking',
};
void invalid;
