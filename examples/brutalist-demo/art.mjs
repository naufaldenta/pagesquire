export const art = [
  {
    id: 'odd-company',
    title: 'Odd company',
    style: '3d',
    label: '3D / CHARACTER WORLD',
    color: 'violet',
    visual: 'creatures',
    description:
      'Three eyes. Zero interest in fitting in. A candy-colored cast of imaginary internet friends, made for the beautifully strange corner of your feed.',
  },
  {
    id: 'brain-on-airplane-mode',
    title: 'Brain on airplane mode',
    style: 'graphic',
    label: 'GRAPHIC / DIGITAL DETOX',
    color: 'lime',
    visual: 'poster',
    description:
      'A tiny manifesto for logging off without losing your spark. Close a tab, open a sketchbook, and let the perfectly unproductive ideas happen.',
  },
  {
    id: 'little-menace',
    title: 'Little menace energy',
    style: 'illustration',
    label: 'ILLUSTRATION / DOODLE CLUB',
    color: 'pink',
    visual: 'doodle',
    description:
      'An original wobbly little character with very big main-character energy. Equal parts notebook margin, rubber-hose cartoon, and Friday afternoon.',
  },
  {
    id: 'stay-unrendered',
    title: 'Stay unrendered',
    style: 'graphic',
    label: 'TYPE / CREATIVE PROCESS',
    color: 'orange',
    visual: 'type',
    description:
      'Not everything needs a final_final_v7. This typographic poster celebrates unfinished experiments, bad first drafts, and making something just because.',
  },
];

export const styles = [
  ['all', 'Everything'],
  ['3d', '3D worlds'],
  ['illustration', 'Illustration'],
  ['graphic', 'Graphic play'],
];

export const readingFonts = {
  sans: 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Courier New", monospace',
};

export function galleryView(style, query, order) {
  const needle = query.trim().toLowerCase();
  const ordered = [...art];
  if (order !== 'featured')
    ordered.sort(
      (a, b) =>
        (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) *
        (order === 'title-desc' ? -1 : 1),
    );
  return ordered.map((item) => ({
    ...item,
    visible:
      (style === 'all' || item.style === style) &&
      `${item.title} ${item.label} ${item.description}`
        .toLowerCase()
        .includes(needle),
  }));
}
