const capability = (id, description, properties, aliases = []) => ({
  id,
  description,
  execution: 'browser',
  handler: id,
  inputSchema: {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
  risk: 'reversible',
  verification: { handler: `${id}.verify` },
  aliases,
});

export const manifest = {
  schemaVersion: '0.1',
  capabilities: [
    capability(
      'accessibility.set_heading_color',
      'Change only OFFBEAT headings to a selected color, without changing body text.',
      { color: { type: 'string', enum: ['#171717', '#c52b28', '#6440d5'] } },
      ['Make headings red', 'Change title color'],
    ),
    capability(
      'accessibility.set_link_highlight',
      'Enable or disable a lime highlight and underline on page links.',
      { enabled: { type: 'boolean' } },
      ['Highlight links'],
    ),
    capability(
      'accessibility.set_font_weight',
      'Change reading-copy font weight without changing display type.',
      { weight: { type: 'integer', enum: [400, 700] } },
      ['Make body text bold'],
    ),
    capability(
      'accessibility.set_text_size',
      'Set reading-copy size to 16 or 20 pixels.',
      { size: { type: 'integer', enum: [16, 20] } },
      ['Make text larger'],
    ),
    capability(
      'gallery.filter',
      'Show all art or filter the gallery by 3D, illustration, or graphic style.',
      {
        style: {
          type: 'string',
          enum: ['all', '3d', 'illustration', 'graphic'],
        },
      },
      ['Show 3D art'],
    ),
    capability(
      'page.scroll_to',
      'Scroll to an existing OFFBEAT page section.',
      {
        section: { type: 'string', enum: ['gallery', 'culture', 'playground'] },
      },
      ['Explore the gallery'],
    ),
  ],
};
