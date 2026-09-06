/**
 * Turning pdf.js text items back into something that reads like a document.
 *
 * A PDF does not contain paragraphs. It contains glyphs at coordinates, and any structure a
 * reader perceives is an accident of where those glyphs sit. Everything here is therefore a
 * heuristic over geometry: lines are runs at a similar height, paragraphs are separated by a
 * larger vertical gap than usual, and a heading is a line whose type is noticeably bigger than
 * the body text around it.
 *
 * Heuristics are honest right up until they are presented as certainties, so the Convert page
 * says plainly that this recovers the words and a rough shape, not the layout. Anything that
 * needs the layout should be converted to images instead.
 *
 * Pure and DOM-free: the input is the plain shape of a pdf.js text item, so the whole thing is
 * unit-tested in Node against synthetic pages.
 */

/**
 * Normalise pdf.js items into plain geometry.
 *
 * `transform` is a 2D matrix [a, b, c, d, e, f]; `e` and `f` are the position and `d` is the
 * vertical scale, which for ordinary horizontal text is the font size. Items with no text —
 * pdf.js emits them for line breaks — carry no geometry worth keeping.
 */
export function normalizeItems(items) {
  const out = [];
  for (const item of items || []) {
    const text = item.str ?? '';
    if (text === '') continue;
    const transform = item.transform || [1, 0, 0, 1, 0, 0];
    const size = Math.abs(transform[3]) || item.height || 10;
    out.push({
      text,
      x: transform[4],
      y: transform[5],
      width: item.width ?? 0,
      size,
      // Font names are opaque ids, but the same id means the same font, which is enough to
      // notice that a line is set differently from the one below it.
      font: item.fontName ?? '',
    });
  }
  return out;
}

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Group items into lines.
 *
 * Two items belong to the same line when their baselines are within a fraction of the type
 * size. A fraction rather than a fixed number of points, because a footnote and a headline
 * cannot share a tolerance.
 */
export function groupLines(items, { tolerance = 0.5 } = {}) {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  let current = null;

  for (const item of sorted) {
    const limit = Math.max(1, item.size * tolerance);
    if (current && Math.abs(current.y - item.y) <= limit) {
      current.items.push(item);
      // The baseline of a mixed-size line is the one most of it sits on.
      current.y = (current.y * (current.items.length - 1) + item.y) / current.items.length;
    } else {
      current = { y: item.y, items: [item] };
      lines.push(current);
    }
  }

  return lines.map((line) => {
    const ordered = [...line.items].sort((a, b) => a.x - b.x);
    return {
      y: line.y,
      x: ordered[0].x,
      size: median(ordered.map((item) => item.size)),
      font: ordered[0].font,
      text: joinRun(ordered),
    };
  });
}

/**
 * Join the items of one line, inserting a space only where the gap says there was one.
 *
 * PDF text is often emitted a few glyphs at a time for kerning, so joining with spaces would
 * shatter every word; joining with nothing would run separate words together. The gap between
 * where an item ends and the next begins is what tells them apart.
 */
function joinRun(items) {
  let text = '';
  let previousEnd = null;

  for (const item of items) {
    if (previousEnd !== null) {
      const gap = item.x - previousEnd;
      // A quarter of the type size is comfortably wider than kerning and narrower than a space.
      if (gap > item.size * 0.25 && !/\s$/.test(text) && !/^\s/.test(item.text)) text += ' ';
    }
    text += item.text;
    previousEnd = item.x + item.width;
  }

  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Turn lines into blocks: headings, paragraphs and list items.
 *
 * The body size is the median line size on the page, so a page that is entirely large type has
 * no headings — which is right, because a heading is only a heading relative to something.
 */
export function groupBlocks(lines, { headingRatio = 1.18 } = {}) {
  if (lines.length === 0) return [];

  const bodySize = median(lines.map((line) => line.size)) || lines[0].size;
  const gaps = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1].y - lines[i].y);
  const positive = gaps.filter((gap) => gap > 0);
  // Use the page's own rhythm when there is enough of it to be a rhythm. On a sparse page —
  // a heading and one line under it — the median gap *is* the paragraph break, and comparing
  // it against itself would mean nothing on that page could ever be one. Below three gaps,
  // fall back to ordinary leading instead: 1.35 times the type size, which sits between the
  // tight and loose ends of what typesetting actually uses.
  const lineGap = positive.length >= 3 ? median(positive) : bodySize * 1.35;

  const blocks = [];
  let paragraph = null;

  const flush = () => {
    if (paragraph && paragraph.text.trim()) blocks.push(paragraph);
    paragraph = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.text) continue;

    const bullet = line.text.match(/^([•·▪◦‣*-]|\d{1,3}[.)])\s+(.*)$/);
    const isHeading = line.size >= bodySize * headingRatio && line.text.length < 120;

    if (isHeading) {
      flush();
      // Two levels is as much as type size can honestly distinguish.
      const level = line.size >= bodySize * headingRatio * 1.35 ? 1 : 2;
      blocks.push({ type: 'heading', level, text: line.text, size: line.size });
      continue;
    }

    if (bullet) {
      flush();
      blocks.push({ type: 'list-item', text: bullet[2], marker: bullet[1], size: line.size });
      continue;
    }

    // A gap noticeably larger than the usual line spacing is a paragraph break.
    const previous = lines[i - 1];
    const broke = !previous || previous.y - line.y > lineGap * 1.5;
    if (broke || !paragraph) {
      flush();
      paragraph = { type: 'paragraph', text: line.text, size: line.size };
    } else {
      // A line ending in a hyphen was almost certainly broken mid-word.
      paragraph.text = /-$/.test(paragraph.text)
        ? paragraph.text.slice(0, -1) + line.text
        : `${paragraph.text} ${line.text}`;
    }
  }

  flush();
  return blocks;
}

/** Everything above, for one page's worth of pdf.js items. */
export function blocksFromItems(items, options) {
  return groupBlocks(groupLines(normalizeItems(items), options), options);
}

const escapeMarkdown = (text) => text.replace(/([\\`*_[\]<>])/g, '\\$1');

/**
 * Render pages of blocks as Markdown.
 *
 * Page breaks become a horizontal rule rather than being dropped: in a converted document the
 * reader usually wants to know where a page ended, and a rule is the least intrusive way of
 * saying so.
 */
export function toMarkdown(pages, { pageBreaks = true } = {}) {
  const parts = [];

  pages.forEach((blocks, index) => {
    if (pageBreaks && index > 0) parts.push('---');
    for (const block of blocks) {
      if (block.type === 'heading') parts.push(`${'#'.repeat(block.level)} ${escapeMarkdown(block.text)}`);
      else if (block.type === 'list-item') parts.push(`- ${escapeMarkdown(block.text)}`);
      else parts.push(escapeMarkdown(block.text));
    }
  });

  return `${parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** Render pages of blocks as plain text, with a blank line between blocks. */
export function toPlainText(pages, { pageBreaks = true } = {}) {
  const parts = [];
  pages.forEach((blocks, index) => {
    if (pageBreaks && index > 0) parts.push('—'.repeat(20));
    for (const block of blocks) {
      parts.push(block.type === 'list-item' ? `• ${block.text}` : block.text);
    }
  });
  return `${parts.join('\n\n').trim()}\n`;
}
