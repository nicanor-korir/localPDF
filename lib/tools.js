/**
 * The tool registry.
 *
 * One entry per thing the app can do. This is plain data with no JSX, so it stays DOM-free and
 * unit-testable, and so the tool row, the routes and the roadmap cannot drift apart: a tool
 * that is not here does not exist, and a tool that is here has a route.
 *
 * Icons are stored as raw SVG path data on a 24x24 grid, drawn stroked with `currentColor` to
 * match every other icon in the app.
 *
 * `status`:
 *   'ready'   — built and routed; appears in the tool row.
 *   'planned' — on the roadmap, deliberately not shown. Keeping it here means the roadmap lives
 *               next to the code rather than only in a document that quietly goes stale.
 */

export const TOOLS = [
  {
    id: 'merge',
    href: '/',
    label: 'Merge',
    blurb: 'Combine PDFs and images into one document.',
    status: 'ready',
    icon: ['M9 3H5a2 2 0 0 0-2 2v10', 'M9 8h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z'],
  },
  {
    id: 'organise',
    href: '/organise',
    label: 'Organise',
    blurb: 'Reorder, rotate, crop and delete pages.',
    status: 'ready',
    icon: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M17 14v6', 'M14 17h6'],
  },
  {
    id: 'extract',
    href: '/extract',
    label: 'Extract',
    blurb: 'Make a new PDF from the pages you pick.',
    status: 'ready',
    icon: ['M8 3h8l4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'M16 3v4h4', 'M3 8v11a2 2 0 0 0 2 2h1'],
  },
  {
    id: 'split',
    href: '/split',
    label: 'Split',
    blurb: 'Break one PDF into several files.',
    status: 'ready',
    icon: ['M12 3v18', 'M5 8H3v8h2', 'M19 8h2v8h-2', 'M8 8h3v8H8z', 'M13 8h3v8h-3z'],
  },
  {
    id: 'unlock',
    href: '/unlock',
    label: 'Unlock',
    blurb: 'Remove a password or restrictions from a PDF.',
    status: 'ready',
    icon: ['M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z', 'M8 11V7a4 4 0 0 1 7.5-2'],
  },
  {
    id: 'protect',
    href: '/protect',
    label: 'Protect',
    blurb: 'Add a password and restrict what a PDF allows.',
    status: 'ready',
    icon: ['M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  },
  {
    id: 'compress',
    href: '/compress',
    label: 'Compress',
    blurb: 'Make a PDF smaller without wrecking it.',
    status: 'ready',
    icon: ['M12 3v6', 'M9 6l3 3 3-3', 'M12 21v-6', 'M9 18l3-3 3 3', 'M4 12h16'],
  },
  {
    id: 'convert',
    href: '/convert',
    label: 'Convert',
    blurb: 'Turn a PDF into images, text or Word.',
    status: 'ready',
    icon: ['M4 7h11', 'M11 4l3 3-3 3', 'M20 17H9', 'M13 20l-3-3 3-3'],
  },
  {
    id: 'edit',
    href: '/edit',
    label: 'Edit',
    blurb: 'Add text and images to a page.',
    status: 'ready',
    icon: ['M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4Z', 'M13.5 6.5l4 4'],
  },
  {
    id: 'redact',
    href: '/redact',
    label: 'Redact',
    blurb: 'Remove sensitive content for good.',
    status: 'planned',
    icon: ['M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z', 'M8 10h8', 'M8 14h5'],
  },
];

/** The tools that actually exist, in tool-row order. */
export const READY_TOOLS = TOOLS.filter((tool) => tool.status === 'ready');

export function getTool(id) {
  return TOOLS.find((tool) => tool.id === id) || null;
}
