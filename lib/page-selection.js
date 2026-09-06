/**
 * Parsing and planning for the tools that pick pages: extract, split and delete.
 *
 * Pure and DOM-free. Page numbers are 1-based on the way in (that is what the user types and
 * what the page labels show) and 0-based on the way out (that is what every other module in
 * this codebase indexes with). The conversion happens here, once, so nothing downstream has to
 * remember which convention it is holding.
 */

/** Thrown with a message written for the user, not for a log. */
export class PageRangeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PageRangeError';
  }
}

const SEPARATORS = /[,;\s]+/;

function parseBound(token, pageCount, whole) {
  if (/^(end|last)$/i.test(token)) return pageCount;
  if (!/^\d+$/.test(token)) {
    throw new PageRangeError(`"${whole}" is not a page number or range.`);
  }
  const n = Number(token);
  if (n < 1) throw new PageRangeError('Page numbers start at 1.');
  if (n > pageCount) {
    throw new PageRangeError(
      `Page ${n} does not exist — this document has ${pageCount} page${pageCount === 1 ? '' : 's'}.`,
    );
  }
  return n;
}

/**
 * Parse a range expression such as `1-3, 5, 9-end` against a document of `pageCount` pages.
 *
 * Returns `{ ranges, indices }`:
 *   - `ranges`  — the groups as written, 0-based and inclusive. Split makes one file per group.
 *   - `indices` — every selected page, de-duplicated, in the order the user wrote them. Extract
 *                 uses this, so `3, 1` extracts page 3 first; that is what someone typing them
 *                 in that order meant.
 *
 * Throws PageRangeError with a message meant to be shown as-is.
 */
export function parsePageRanges(input, pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new PageRangeError('This document has no pages.');
  }

  const text = String(input ?? '').trim();
  if (!text) throw new PageRangeError('Enter the pages you want, for example 1-3, 5.');
  if (/^all$/i.test(text)) {
    return {
      ranges: [{ start: 0, end: pageCount - 1 }],
      indices: Array.from({ length: pageCount }, (_, i) => i),
    };
  }

  const ranges = [];
  for (const token of text.split(SEPARATORS)) {
    if (!token) continue;
    // Split on the LAST hyphen so a stray leading one fails as an unparseable bound rather
    // than silently becoming an open range.
    const hyphen = token.indexOf('-');
    let from;
    let to;
    if (hyphen === -1) {
      from = to = parseBound(token, pageCount, token);
    } else {
      const left = token.slice(0, hyphen);
      const right = token.slice(hyphen + 1);
      from = parseBound(left, pageCount, token);
      // A trailing hyphen means "to the end", which is how people write open ranges.
      to = right === '' ? pageCount : parseBound(right, pageCount, token);
    }
    // Accept a reversed range rather than rejecting it. Someone who wrote 7-3 meant 3 to 7,
    // and refusing it teaches nothing.
    if (from > to) [from, to] = [to, from];
    ranges.push({ start: from - 1, end: to - 1 });
  }

  if (ranges.length === 0) throw new PageRangeError('Enter the pages you want, for example 1-3, 5.');

  const seen = new Set();
  const indices = [];
  for (const { start, end } of ranges) {
    for (let i = start; i <= end; i++) {
      if (seen.has(i)) continue;
      seen.add(i);
      indices.push(i);
    }
  }
  return { ranges, indices };
}

/** Render a 0-based index list back as the shortest 1-based expression that produces it. */
export function formatPageRanges(indices) {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  const parts = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
    start = current;
    prev = current;
  }
  return parts.join(', ');
}

export const SPLIT_MODES = {
  ranges: { id: 'ranges', label: 'By range' },
  every: { id: 'every', label: 'Every N pages' },
  each: { id: 'each', label: 'One file per page' },
};

export const DEFAULT_SPLIT_MODE = 'ranges';

/**
 * Turn a split request into the documents it should produce.
 *
 * Returns `[{ label, indices }]`, where `label` is the range as the user would say it — the
 * caller turns that into a file name. Never returns an empty document, and never returns an
 * empty plan: both throw with a message instead, because a "successful" split that downloads
 * nothing is the worst outcome available.
 */
export function planSplit({ mode, pageCount, ranges = '', every = 1 }) {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new PageRangeError('This document has no pages.');
  }

  if (mode === 'each') {
    return Array.from({ length: pageCount }, (_, i) => ({
      label: `${i + 1}`,
      indices: [i],
    }));
  }

  if (mode === 'every') {
    const size = Number(every);
    if (!Number.isInteger(size) || size < 1) {
      throw new PageRangeError('Split every how many pages? Enter a whole number of 1 or more.');
    }
    if (size >= pageCount) {
      throw new PageRangeError(
        `Splitting every ${size} pages would leave the ${pageCount}-page document whole.`,
      );
    }
    const out = [];
    for (let start = 0; start < pageCount; start += size) {
      const end = Math.min(start + size - 1, pageCount - 1);
      out.push({
        label: start === end ? `${start + 1}` : `${start + 1}-${end + 1}`,
        indices: Array.from({ length: end - start + 1 }, (_, i) => start + i),
      });
    }
    return out;
  }

  if (mode === 'ranges') {
    const { ranges: groups } = parsePageRanges(ranges, pageCount);
    return groups.map(({ start, end }) => ({
      label: start === end ? `${start + 1}` : `${start + 1}-${end + 1}`,
      indices: Array.from({ length: end - start + 1 }, (_, i) => start + i),
    }));
  }

  throw new PageRangeError(`Unknown split mode "${mode}".`);
}

/** `report.pdf` + `2-4` becomes `report-pages-2-4.pdf`. */
export function splitPartName(baseName, label) {
  const stem = String(baseName || 'document').replace(/\.pdf$/i, '') || 'document';
  return `${stem}-pages-${label}.pdf`;
}
