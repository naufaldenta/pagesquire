import { navigationCapability, createPageCapabilities } from '@pagesquire/core';
const capability = (id, description, properties) => ({
  id,
  description,
  execution: 'browser',
  handler: id,
  risk: 'reversible',
  inputSchema: {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
  verification: { handler: `${id}.verify` },
});
export const manifest = {
  schemaVersion: '0.1',
  capabilities: [
    capability(
      'accessibility.set_heading_color',
      'Set the color of public content headings only, without changing body text.',
      { color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' } },
    ),
    capability(
      'accessibility.set_link_highlight',
      'Set highlighting on visible public content links.',
      { enabled: { type: 'boolean' } },
    ),
    capability(
      'accessibility.set_font_weight',
      'Set the approved public content root font weight. Theme-specific descendant weights may override inheritance; this does not save theme preferences.',
      {
        weight: {
          type: 'integer',
          minimum: 100,
          maximum: 900,
          multipleOf: 100,
        },
      },
    ),
    navigationCapability,
    ...createPageCapabilities(['content']),
  ],
};
