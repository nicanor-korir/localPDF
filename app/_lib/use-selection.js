'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * Which pages are ticked.
 *
 * Keyed by page id rather than index, so a selection survives a reorder or a deletion — the
 * page you picked stays picked even after you move it. Ids that are no longer in the document
 * are filtered out on read rather than pruned on write, which keeps every callback stable and
 * therefore keeps PageCard's memo intact.
 */
export function usePageSelection(pages) {
  const [selected, setSelected] = useState(() => new Set());
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(pagesRef.current.map((p) => p.id)));
  }, []);

  const selectNone = useCallback(() => setSelected(new Set()), []);

  /** Replace the selection with the given 0-based positions in the current page order. */
  const selectIndices = useCallback((indices) => {
    const list = pagesRef.current;
    setSelected(new Set(indices.map((i) => list[i]?.id).filter(Boolean)));
  }, []);

  // The ticked pages, in document order — which is the order they must be written in, not the
  // order they happened to be clicked.
  const selectedPages = useMemo(() => pages.filter((p) => selected.has(p.id)), [pages, selected]);
  const selectedIndices = useMemo(
    () => pages.map((p, i) => (selected.has(p.id) ? i : -1)).filter((i) => i !== -1),
    [pages, selected],
  );

  return { selected, toggle, selectAll, selectNone, selectIndices, selectedPages, selectedIndices };
}
