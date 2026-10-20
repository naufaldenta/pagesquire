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
      'Change only headings/titles, not body text. Colors: original ink=#171717, red=#c52b28, violet/purple=#6440d5.',
      { color: { type: 'string', enum: ['#171717', '#c52b28', '#6440d5'] } },
      ['Make headings red', 'Change title color'],
    ),
    capability(
      'accessibility.set_text_color',
      'Change only reading/body text, NOT headings. original restores each section color; red=#c52b28, violet/purple=#6440d5, ink=#171717.',
      {
        color: {
          type: 'string',
          enum: ['original', '#171717', '#c52b28', '#6440d5'],
        },
      },
      ['Make body text red', 'Restore text colors'],
    ),
    capability(
      'accessibility.set_line_spacing',
      'Set reading-copy line spacing ratio: 1.6 original, 1.8 relaxed, 2 double spacing. Does not affect headings.',
      { spacing: { type: 'number', enum: [1.6, 1.8, 2] } },
      ['Increase line spacing'],
    ),
    capability(
      'accessibility.set_reading_font',
      'Set reading-copy font: sans (original Arial), serif (Georgia), mono (Courier New). Display headings stay unchanged.',
      { font: { type: 'string', enum: ['sans', 'serif', 'mono'] } },
      ['Use a serif reading font'],
    ),
    capability(
      'accessibility.set_heading_highlight',
      'Enable or disable lime background highlighting on ALL headings/titles. Separate from link highlighting; heading text color is preserved.',
      { enabled: { type: 'boolean' } },
      ['Highlight all headings', 'Highlight titles'],
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
      'Set reading-copy size to 16 (original), 18, 20 or 24 pixels.',
      { size: { type: 'integer', enum: [16, 18, 20, 24] } },
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
      'gallery.search',
      'Search art title, label and description. Search combines with the style filter. Empty query clears search; zero matches is a valid visible result.',
      { query: { type: 'string', maxLength: 80 } },
      ['Find character art', 'Clear gallery search'],
    ),
    capability(
      'gallery.sort',
      'Order gallery cards: featured (original), title-asc (A to Z), title-desc (Z to A). Preserves search/style filters.',
      {
        order: {
          type: 'string',
          enum: ['featured', 'title-asc', 'title-desc'],
        },
      },
      ['Sort art alphabetically'],
    ),
    capability(
      'page.reset',
      'Restore reading adjustments with scope=reading; scope=all also clears gallery search/filter/sort. Does NOT clear chat, authentication or quotas.',
      { scope: { type: 'string', enum: ['reading', 'all'] } },
      ['Reset all page changes'],
    ),
    capability(
      'page.scroll_to',
      'Scroll to an existing OFFBEAT page section.',
      {
        section: {
          type: 'string',
          enum: ['hero', 'gallery', 'culture', 'playground', 'footer'],
        },
      },
      ['Explore the gallery'],
    ),
  ],
};
