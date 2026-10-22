import { CapabilityInspector } from '@pagesquire/core';
import { AppContext } from '@pagesquire/core';
import type { CapabilityInspectorOptions } from '@pagesquire/core';
import { mountInspector } from '@pagesquire/client';

export function connectInspector(
  container: HTMLElement,
  options: CapabilityInspectorOptions,
): () => void {
  const inspector = new CapabilityInspector(options);
  const report = inspector.inspect();
  // @ts-expect-error Inspection reports cannot authorize execution.
  report.authorization = 'allowed';
  return mountInspector(container, inspector);
}

const invalid: CapabilityInspectorOptions['probes'] = {
  'app.example': {
    // @ts-expect-error Probes must be synchronous, not async preparations.
    resolve: async () => null,
  },
};
void invalid;

export function connectContext(
  options: CapabilityInspectorOptions,
): AppContext {
  return new AppContext({
    registry: options.registry,
    fields: {
      view: {
        public: true,
        type: 'enum',
        values: ['gallery', 'article'],
        read: () => 'gallery',
      },
      count: { public: true, type: 'number', min: 0, max: 100, read: () => 3 },
      private_store: {
        public: true,
        type: 'string',
        // @ts-expect-error Whole stores cannot be registered as a string field.
        read: () => ({ secret: 'not allowed' }),
      },
      // @ts-expect-error Public sharing consent is mandatory.
      implicit: { type: 'boolean', read: () => false },
    },
  });
}
