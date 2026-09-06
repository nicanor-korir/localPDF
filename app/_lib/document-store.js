'use client';

/**
 * The document session, held outside React so it survives moving between tools.
 *
 * Someone who has just spent a minute arranging forty pages in Organise and then clicks Split
 * has not asked to start again. Each tool is its own route, so its component unmounts on the
 * way out — which means the state cannot live in that component if it is to outlive it.
 *
 * **In memory only, deliberately.** Nothing here is written to disk: no IndexedDB, no
 * sessionStorage. That keeps the guarantee exactly as strong as it was — the files are read
 * from disk into this tab and never leave it — and it is why the `beforeunload` guard still
 * exists. A reload is still a fresh start, which is the honest behaviour for a tool that
 * promises to keep nothing.
 *
 * Undo history travels with the pages, because it describes the same document.
 */

// Undo depth. Deep enough to walk back a run of mistaken edits, bounded so a long session
// cannot retain thousands of page arrays.
const HISTORY_LIMIT = 50;

// fileId -> { pdf, task, pageCount, failed }. Each source is parsed once and kept open while
// it is in the list, so rendering page 40 does not re-read the file — and so switching tools
// does not re-parse every document.
export const docs = new Map();
// renderKey -> ImageBitmap. Survives reorder, rotation, crop, deletion of other pages, and now
// a change of tool: the previews are already decoded, and throwing them away on navigation
// would make every switch look slow for no reason.
export const rasters = new Map();
// Sources whose pages have been generated once, so a document the user has emptied page by
// page does not silently refill itself.
export const seen = new Set();

let history = [];
let state = { files: [], pages: [], historyDepth: 0, countsVersion: 0 };

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot() {
  return state;
}

// Static prerender has no session. A stable object keeps useSyncExternalStore from looping.
const SERVER_SNAPSHOT = { files: [], pages: [], historyDepth: 0, countsVersion: 0 };
export function getServerSnapshot() {
  return SERVER_SNAPSHOT;
}

function commit(next) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export const getFiles = () => state.files;
export const getPages = () => state.pages;

export function setFiles(files) {
  if (files === state.files) return;
  commit({ files });
}

export function bumpCounts() {
  commit({ countsVersion: state.countsVersion + 1 });
}

/** Replace the pages without recording an undo step — used by reconciliation. */
export function resetPages(pages) {
  if (pages === state.pages) return;
  history = [];
  commit({ pages, historyDepth: 0 });
}

/**
 * Apply a page operation, remembering the previous arrangement so it can be undone.
 *
 * Operations that change nothing return the same array and are not recorded, so Undo never
 * appears and then visibly does nothing. Every operation in lib/pages.js upholds that; there
 * are tests pinning it.
 */
export function mutatePages(fn) {
  const prev = state.pages;
  const next = fn(prev);
  if (next === prev) return false;
  history = [...history, prev].slice(-HISTORY_LIMIT);
  commit({ pages: next, historyDepth: history.length });
  return true;
}

export function undoPages() {
  if (history.length === 0) return false;
  const restored = history[history.length - 1];
  history = history.slice(0, -1);
  commit({ pages: restored, historyDepth: history.length });
  return true;
}

export function clearHistory() {
  if (history.length === 0) return;
  history = [];
  commit({ historyDepth: 0 });
}

/** Drop everything, releasing the object URLs and pdf.js documents as it goes. */
export function clearAll() {
  for (const entry of state.files) {
    if (entry.thumbUrl) URL.revokeObjectURL(entry.thumbUrl);
    docs.get(entry.id)?.task?.destroy?.();
  }
  docs.clear();
  rasters.clear();
  seen.clear();
  history = [];
  commit({ files: [], pages: [], historyDepth: 0 });
}

export function forget(entry) {
  if (entry.thumbUrl) URL.revokeObjectURL(entry.thumbUrl);
  docs.get(entry.id)?.task?.destroy?.();
  docs.delete(entry.id);
  seen.delete(entry.id);
  for (const key of [...rasters.keys()]) {
    if (key.startsWith(`${entry.id}:`)) rasters.delete(key);
  }
}
