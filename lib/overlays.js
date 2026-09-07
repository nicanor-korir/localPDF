/**
 * Things the user has added on top of a page: a line of text, or an image.
 *
 * An overlay belongs to a page of the *output*, and its geometry is in **display space** — the
 * same convention as `crop`: origin top-left, y down, 0..1 fractions of the page as the user
 * sees it. That is the space a box is dragged in, so it is the space the model stores, and the
 * one conversion to PDF content space happens once, in `pdf-geometry.js`.
 *
 * ```javascript
 * { id, pageId, type: 'text', x, y, width, height, text, size, colour, align }
 * { id, pageId, type: 'image', x, y, width, height, fileId }
 * ```
 *
 * Every operation returns the **same array** when it would change nothing, exactly as
 * `pages.js` does. `mutate()` skips recording an undo step when the array comes back
 * identical, so Undo never appears and then visibly does nothing.
 *
 * Pure and DOM-free.
 */

import { generateId } from './file-types.js';

export const MIN_SIZE = 0.02;
export const DEFAULT_TEXT_SIZE = 14;
export const TEXT_COLOURS = [
  { id: 'black', label: 'Black', rgb: [0, 0, 0] },
  { id: 'red', label: 'Red', rgb: [0.8, 0.1, 0.1] },
  { id: 'blue', label: 'Blue', rgb: [0.15, 0.28, 0.85] },
  { id: 'white', label: 'White', rgb: [1, 1, 1] },
];
export const DEFAULT_TEXT_COLOUR = 'black';

export const colourOf = (id) => TEXT_COLOURS.find((c) => c.id === id) || TEXT_COLOURS[0];

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/** Keep a box inside the page, and never let it collapse to nothing. */
export function clampBox({ x, y, width, height }) {
  const w = Math.min(1, Math.max(MIN_SIZE, width));
  const h = Math.min(1, Math.max(MIN_SIZE, height));
  return {
    x: clamp01(Math.min(x, 1 - w)),
    y: clamp01(Math.min(y, 1 - h)),
    width: w,
    height: h,
  };
}

export function addText(overlays, pageId, box, { text = '', size = DEFAULT_TEXT_SIZE, colour = DEFAULT_TEXT_COLOUR } = {}) {
  return [
    ...overlays,
    { id: generateId(), pageId, type: 'text', ...clampBox(box), text, size, colour },
  ];
}

export function addImage(overlays, pageId, box, fileId) {
  return [...overlays, { id: generateId(), pageId, type: 'image', ...clampBox(box), fileId }];
}

/** Move or resize one overlay. Returns the same array when the box is unchanged. */
export function setBox(overlays, id, box) {
  const next = clampBox(box);
  const current = overlays.find((o) => o.id === id);
  if (!current) return overlays;
  if (
    current.x === next.x && current.y === next.y &&
    current.width === next.width && current.height === next.height
  ) {
    return overlays;
  }
  return overlays.map((o) => (o.id === id ? { ...o, ...next } : o));
}

/** Change the content or styling of one overlay. Returns the same array when nothing differs. */
export function updateOverlay(overlays, id, changes) {
  const current = overlays.find((o) => o.id === id);
  if (!current) return overlays;
  const keys = Object.keys(changes);
  if (keys.every((key) => current[key] === changes[key])) return overlays;
  return overlays.map((o) => (o.id === id ? { ...o, ...changes } : o));
}

export function removeOverlay(overlays, id) {
  if (!overlays.some((o) => o.id === id)) return overlays;
  return overlays.filter((o) => o.id !== id);
}

/**
 * Drop overlays whose page has gone.
 *
 * Deleting a page must take what was written on it; leaving them behind would either lose them
 * silently on the next export or, worse, reattach them to whatever page inherits the id.
 */
export function reconcileOverlays(overlays, pages) {
  const live = new Set(pages.map((page) => page.id));
  if (overlays.every((o) => live.has(o.pageId))) return overlays;
  return overlays.filter((o) => live.has(o.pageId));
}

export function overlaysForPage(overlays, pageId) {
  return overlays.filter((o) => o.pageId === pageId);
}

/**
 * Group overlays by page id, so the merge can look them up without scanning per page.
 *
 * An empty map for a document with no overlays means the whole feature costs the merge
 * nothing when nobody has used it.
 */
export function groupOverlays(overlays) {
  const byPage = new Map();
  for (const overlay of overlays) {
    if (!byPage.has(overlay.pageId)) byPage.set(overlay.pageId, []);
    byPage.get(overlay.pageId).push(overlay);
  }
  return byPage;
}

// --- What the built-in fonts can actually write --------------------------------------------

/**
 * The characters WinAnsi can encode.
 *
 * The PDF standard fonts — the ones that need no embedding and add no bytes — are limited to
 * WinAnsi. Embedding a font that could write anything else means shipping one, which for a
 * text box on a page is a poor trade.
 *
 * So the limit is real and the UI has to say so plainly. Silently dropping the characters it
 * cannot write would put a document in someone's hands with words missing from it.
 */
const WIN_ANSI_EXTRAS = new Set([
  '€', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰',
  'Š', '‹', 'Œ', 'Ž', '‘', '’', '“', '”', '•',
  '–', '—', '˜', '™', 'š', '›', 'œ', 'ž', 'Ÿ',
]);

export function isEncodable(character) {
  const code = character.codePointAt(0);
  // Tab and newline are handled before drawing; everything else below space is a control code.
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return WIN_ANSI_EXTRAS.has(character);
}

/** The distinct characters in `text` the built-in fonts cannot write, in the order they appear. */
export function unwritableCharacters(text) {
  const found = [];
  const seen = new Set();
  for (const character of String(text ?? '')) {
    if (isEncodable(character) || seen.has(character)) continue;
    seen.add(character);
    found.push(character);
  }
  return found;
}

/** Replace what cannot be written with '?', so a failed encode never loses the whole page. */
export function toWritableText(text) {
  return [...String(text ?? '')].map((character) => (isEncodable(character) ? character : '?')).join('');
}
