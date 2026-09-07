import { generateId } from './file-types.js';
import { isCropMeaningful, normalizeRotation } from './pdf-geometry.js';

// A page entry is one page of the *output* document. It never holds pixels or bytes — only a
// pointer back to a source file plus the transforms the user applied. That is what makes
// reordering, rotating and cropping cheap: none of them invalidate a rendered preview.
export function makePage(fileId, sourceIndex) {
  return { id: generateId(), fileId, sourceIndex, rotation: 0, crop: null };
}

/**
 * A page backed by nothing.
 *
 * The only kind of page entry with no source behind it, which is why it needs saying in the
 * type rather than being inferred from a missing `fileId`: every other part of the model asks
 * "which file is this from", and the honest answer here is "none".
 */
export function makeBlankPage() {
  return { id: generateId(), blank: true, fileId: null, sourceIndex: 0, rotation: 0, crop: null };
}

export const isBlank = (page) => page?.blank === true;

/** Insert a blank page after `index`; pass -1 to put one at the very start. */
export function insertBlankPage(pages, index) {
  const at = Math.max(0, Math.min(pages.length, index + 1));
  return [...pages.slice(0, at), makeBlankPage(), ...pages.slice(at)];
}

// The cache key for a rendered preview. Deliberately excludes rotation and crop: both are
// applied as CSS over the rendered bitmap, so neither needs a re-render.
export function renderKey(page) {
  // Every blank page looks the same, so they can all share one cached raster.
  if (isBlank(page)) return 'blank';
  return `${page.fileId}:${page.sourceIndex}`;
}

/**
 * Reconcile the page list against the current sources.
 *
 * Pages of a file that is still present keep their position and their transforms. Pages of a
 * removed file drop out. A file whose pages have never been generated appends all of them at
 * the end — `seenFileIds` is what stops a file the user has emptied page by page from
 * silently resurrecting itself.
 *
 * @param {Array} pages current page entries
 * @param {Array<{fileId: string, pageCount: number}>} sources
 * @param {Set<string>} seenFileIds files whose pages have already been added at least once
 */
export function reconcilePages(pages, sources, seenFileIds) {
  const counts = new Map(sources.map((s) => [s.fileId, s.pageCount]));

  const kept = pages.filter((page) => {
    // A blank page belongs to no file, so removing one document cannot take it away — but
    // removing the *last* one empties the document, and leaving orphan blanks behind would
    // hide them until the next file was added and then bring them back unexplained.
    if (isBlank(page)) return sources.length > 0;
    const count = counts.get(page.fileId);
    return count !== undefined && page.sourceIndex < count;
  });

  const added = [];
  for (const source of sources) {
    if (seenFileIds.has(source.fileId)) continue;
    for (let i = 0; i < source.pageCount; i++) added.push(makePage(source.fileId, i));
  }

  return kept.length === pages.length && added.length === 0 ? pages : [...kept, ...added];
}

// Every operation below returns the *same array* when it would change nothing. The undo stack
// records whatever array an operation replaced, so an operation that quietly returned an
// equivalent-but-new array would push a history entry that undoes to an identical state — an
// Undo button that visibly does nothing.

export function rotatePage(pages, id, delta) {
  const turn = normalizeRotation(delta);
  if (turn === 0 || !pages.some((p) => p.id === id)) return pages;
  return pages.map((p) =>
    p.id === id ? { ...p, rotation: normalizeRotation(p.rotation + turn) } : p,
  );
}

function sameCrop(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function cropPage(pages, id, crop) {
  const next = isCropMeaningful(crop) ? crop : null;
  const target = pages.find((p) => p.id === id);
  if (!target || sameCrop(target.crop, next)) return pages;
  return pages.map((p) => (p.id === id ? { ...p, crop: next } : p));
}

export function removePage(pages, id) {
  if (!pages.some((p) => p.id === id)) return pages;
  return pages.filter((p) => p.id !== id);
}

// Move a page to a new absolute position, clamped. Used by both the arrow buttons and drop.
export function movePage(pages, id, toIndex) {
  const from = pages.findIndex((p) => p.id === id);
  if (from === -1) return pages;
  const to = Math.max(0, Math.min(pages.length - 1, toIndex));
  if (to === from) return pages;
  const copy = [...pages];
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}

// True when a page still shows its source unaltered — used to label the page in the UI.
export function isPristine(page) {
  return page.rotation === 0 && !isCropMeaningful(page.crop);
}

// True when every file's pages sit in one contiguous run. That is the normal state, and the
// only one in which "move this document" has an unambiguous meaning — once a user has
// interleaved pages by hand, there is no block left to move.
export function arePagesGroupedByFile(pages) {
  // A blank page belongs to no document, so there is no unambiguous place for it to go when a
  // whole document moves past it. Rather than guess, the arrows disable — the same answer this
  // gives once pages have been interleaved by hand.
  if (pages.some(isBlank)) return false;

  const seen = new Set();
  let current = null;
  for (const page of pages) {
    if (page.fileId === current) continue;
    if (seen.has(page.fileId)) return false;
    seen.add(page.fileId);
    current = page.fileId;
  }
  return true;
}

// Move a whole document's pages one slot earlier or later among the other documents, keeping
// each document's internal page order intact.
export function moveFileBlock(pages, fileId, direction) {
  if (!arePagesGroupedByFile(pages)) return pages;

  const order = [];
  for (const page of pages) if (!order.includes(page.fileId)) order.push(page.fileId);

  const from = order.indexOf(fileId);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= order.length) return pages;
  [order[from], order[to]] = [order[to], order[from]];

  const byFile = new Map(order.map((id) => [id, []]));
  for (const page of pages) byFile.get(page.fileId).push(page);
  return order.flatMap((id) => byFile.get(id));
}
