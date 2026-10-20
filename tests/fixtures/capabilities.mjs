import { navigationCapability } from '../../packages/core/dist/navigation.js';

function capability(
  id,
  description,
  properties,
  required = Object.keys(properties),
) {
  return {
    id,
    description,
    execution: 'browser',
    handler: id,
    inputSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
    risk: 'reversible',
    verification: { handler: `${id}.verify` },
  };
}

export const manifest = {
  schemaVersion: '0.1',
  capabilities: [
    capability(
      'accessibility.set_heading_color',
      'Change the color of headings without changing body text.',
      { color: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' } },
    ),
    capability(
      'accessibility.set_link_highlight',
      'Set whether links are highlighted.',
      { enabled: { type: 'boolean' } },
    ),
    capability('accessibility.set_font_weight', 'Set the page font weight.', {
      weight: { type: 'integer', minimum: 100, maximum: 900, multipleOf: 100 },
    }),
    capability(
      'browser.click',
      'Click an explicitly permitted observed target.',
      { targetId: { type: 'string', pattern: '^target-[0-9]+$' } },
    ),
    capability(
      'browser.fill',
      'Fill an explicitly permitted observed text field.',
      {
        targetId: { type: 'string', pattern: '^target-[0-9]+$' },
        value: { type: 'string', maxLength: 200 },
      },
    ),
    navigationCapability,
    capability('testing.wait', 'Wait cooperatively for a bounded period.', {
      milliseconds: { type: 'integer', minimum: 0, maximum: 10000 },
    }),
    capability(
      'testing.unverified',
      'Exercise an unsuccessful postcondition.',
      {},
    ),
    capability('testing.secret_failure', 'Exercise error redaction.', {}),
    capability('testing.ambiguous', 'Exercise ambiguous adapter targets.', {}),
    {
      ...capability(
        'testing.consequential',
        'Exercise the consequential-action boundary.',
        {},
      ),
      risk: 'consequential',
    },
  ],
};
