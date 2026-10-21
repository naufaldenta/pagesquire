import { createPageCapabilities } from '../../packages/core/dist/index.js';

export const controlDefinition = {
  id: 'accessibility.set_heading_color',
  description:
    'Change heading colors only, not paragraph or body colors. The host opens its parent settings panel.',
  execution: 'browser',
  handler: 'headings',
  risk: 'reversible',
  inputSchema: {
    type: 'object',
    properties: { color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } },
    required: ['color'],
    additionalProperties: false,
  },
  verification: { handler: 'verifyHeadings' },
};
export const openDefinition = {
  id: 'content.open',
  description:
    'Open the public article through the registered host control, then read it if the user requested a summary.',
  execution: 'browser',
  handler: 'open',
  risk: 'reversible',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  verification: { handler: 'verifyOpen' },
};
export const drivingManifest = {
  schemaVersion: '0.1',
  capabilities: [
    controlDefinition,
    openDefinition,
    ...createPageCapabilities(['article', 'guide']),
  ],
};
