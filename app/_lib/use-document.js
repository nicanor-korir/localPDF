'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  generateId,
  isAcceptedFile,
  LARGE_FILE_COUNT,
  LARGE_TOTAL_BYTES,
  resolveType,
} from '../../lib/file-types';
import {
  arePagesGroupedByFile,
  cropPage,
  moveFileBlock,
  movePage,
  reconcilePages,
  removePage,
  renderKey,
  rotatePage,
} from '../../lib/pages';
import { MAX_CACHED_RASTERS, PREVIEW_SCALE, loadPdfjs } from './pdf-render';

// Undo depth. Deep enough to walk back a run of mistaken edits, bounded so a long session
// cannot retain thousands of page arrays.
const HISTORY_LIMIT = 50;

/**
 * The document session: the sources the user added, the pages of the output, the rendered
 * rasters, and the undo stack over all of it.
 *
 * Every tool in the app works on the same model — `pages[]`, where an entry is one page of the
 * *output* holding a pointer back to a source plus the transforms applied to it. Merge, extract,
 * split and organise differ only in what they do with that array at the end, which is why they
 * can share this hook rather than each growing their own copy of it.
 */
export function useDocumentSession() {
  const [files, setFiles] = useState([]);
  const [pages, setPages] = useState([]);
  const [toast, setToast] = useState(null);
  const [liveMessage, setLiveMessage] = useState('');
  const [croppingId, setCroppingId] = useState(null);
  const [draggedId, setDraggedId] = useState(null);
  const [dragTargetId, setDragTargetId] = useState(null);
  // Bumped when a source's page count becomes known, to trigger reconciliation.
  const [countsVersion, setCountsVersion] = useState(0);
  const [historyDepth, setHistoryDepth] = useState(0);

  const toastTimer = useRef(null);
  // Mirrors, so effects and callbacks can read current values without re-subscribing.
  const filesRef = useRef(files);
  filesRef.current = files;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  // fileId -> { pdf, task, pageCount, failed }. Each source is parsed once and kept open while
  // it is in the list, so rendering page 40 does not re-read the file.
  const docsRef = useRef(new Map());
  // renderKey -> ImageBitmap. Survives reorder, rotation, crop, and deletion of other pages.
  const rasterRef = useRef(new Map());
  // Sources whose pages have been generated once, so a document the user has emptied page by
  // page does not silently refill itself.
  const seenRef = useRef(new Set());
  // Previous page arrays, newest last. The page model is immutable, so an undo stack is just
  // a list of the arrays we replaced — no inverse operations to write and get wrong.
  const historyRef = useRef([]);

  useEffect(() => {
    const docs = docsRef.current;
    const rasters = rasterRef.current;
    return () => {
      filesRef.current.forEach((f) => {
        if (f.thumbUrl) URL.revokeObjectURL(f.thumbUrl);
      });
      docs.forEach((entry) => entry.task?.destroy?.());
      docs.clear();
      rasters.clear();
    };
  }, []);

  // Arranging fifty pages and then closing the tab loses all of it — there is no server-side
  // copy to come back to, by design.
  useEffect(() => {
    if (pages.length === 0) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pages.length]);

  // -- Toast / announcements --

  const showToast = useCallback((msg, isError = false) => {
    setToast({ message: msg, isError });
    clearTimeout(toastTimer.current);
    // Errors linger a little longer so they can be read.
    toastTimer.current = setTimeout(() => setToast(null), isError ? 6000 : 2500);
  }, []);

  // A leading zero-width space forces the live region to change even when the same message
  // repeats (e.g. rotating twice), so it is re-announced.
  const announce = useCallback((msg) => {
    setLiveMessage((prev) => (prev === msg ? `​${msg}` : msg));
  }, []);

  // -- Open each source once, and learn how many pages it has --

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const docs = docsRef.current;
      let changed = false;

      for (const entry of files) {
        if (docs.has(entry.id)) continue;
        try {
          if (entry.type === 'application/pdf') {
            const lib = await loadPdfjs();
            const buffer = await entry.file.arrayBuffer();
            // Previews render untrusted, user-supplied PDFs. CVE-2024-4367 (arbitrary JS
            // execution from a crafted PDF via font handling) was fixed upstream in pdf.js
            // 4.2.67, and the `isEvalSupported: false` workaround this used to pass has been
            // removed from the API entirely as of v6 — keeping pdf.js current is the defence.
            const task = lib.getDocument({ data: new Uint8Array(buffer) });
            const pdf = await task.promise;
            if (cancelled) {
              task.destroy();
              return;
            }
            docs.set(entry.id, { pdf, task, pageCount: pdf.numPages });
          } else {
            docs.set(entry.id, { pdf: null, task: null, pageCount: 1 });
          }
        } catch (err) {
          console.error('Could not read file:', entry.name, err);
          docs.set(entry.id, { pdf: null, task: null, pageCount: 0, failed: true });
        }
        changed = true;
      }

      if (!cancelled && changed) setCountsVersion((v) => v + 1);
    })();

    return () => {
      cancelled = true;
    };
  }, [files]);

  // -- Keep the page list in step with the sources --

  useEffect(() => {
    const docs = docsRef.current;
    const known = files
      .filter((f) => docs.has(f.id))
      .map((f) => ({ fileId: f.id, pageCount: docs.get(f.id).pageCount }));

    const next = reconcilePages(pagesRef.current, known, seenRef.current);
    for (const source of known) {
      if (source.pageCount > 0) seenRef.current.add(source.fileId);
    }
    if (next !== pagesRef.current) {
      // Adding or removing a document changes which pages exist at all, so earlier
      // arrangements refer to pages that may be gone. Undoing into one would be incoherent.
      historyRef.current = [];
      setHistoryDepth(0);
      setPages(next);
    }
  }, [files, countsVersion]);

  // -- Rendering --

  const getBitmap = useCallback(async (page) => {
    const key = renderKey(page);
    const cache = rasterRef.current;
    if (cache.has(key)) return cache.get(key);

    const source = filesRef.current.find((f) => f.id === page.fileId);
    if (!source) throw new Error('Source file is no longer available');

    let bitmap;
    if (source.type === 'application/pdf') {
      const pdf = docsRef.current.get(page.fileId)?.pdf;
      if (!pdf) throw new Error('Document is not open');
      const pdfPage = await pdf.getPage(page.sourceIndex + 1);
      const viewport = pdfPage.getViewport({ scale: PREVIEW_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      // v6 takes the canvas itself as well as the context.
      await pdfPage.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      bitmap = await createImageBitmap(canvas);
      pdfPage.cleanup();
    } else {
      bitmap = await createImageBitmap(source.file);
    }

    cache.set(key, bitmap);
    while (cache.size > MAX_CACHED_RASTERS) {
      cache.delete(cache.keys().next().value);
    }
    return bitmap;
  }, []);

  // -- Add / remove sources --

  const addFiles = useCallback(
    (fileList) => {
      const newEntries = [];
      let skippedUnsupported = 0;
      let skippedEmpty = 0;
      let duplicates = 0;

      for (const file of fileList) {
        if (!isAcceptedFile(file)) {
          skippedUnsupported++;
          continue;
        }
        if (file.size === 0) {
          skippedEmpty++;
          continue;
        }
        // Added anyway — someone may genuinely want the same document twice — but say so,
        // because dropping a folder twice is the more common reason to see this.
        if (filesRef.current.some((f) => f.name === file.name && f.size === file.size)) {
          duplicates++;
        }
        const type = resolveType(file);
        newEntries.push({
          id: generateId(),
          file,
          name: file.name,
          size: file.size,
          type,
          thumbUrl: type.startsWith('image/') ? URL.createObjectURL(file) : null,
        });
      }

      if (skippedUnsupported > 0) {
        showToast(
          `${skippedUnsupported} file${skippedUnsupported > 1 ? 's' : ''} skipped (unsupported format)`,
        );
      } else if (skippedEmpty > 0) {
        showToast(`${skippedEmpty} empty file${skippedEmpty > 1 ? 's' : ''} skipped`);
      } else if (duplicates > 0) {
        showToast(`Added ${duplicates} file${duplicates > 1 ? 's' : ''} you already had`);
      }

      if (newEntries.length > 0) {
        const next = [...filesRef.current, ...newEntries];
        setFiles(next);
        const totalBytes = next.reduce((sum, f) => sum + f.size, 0);
        if (next.length > LARGE_FILE_COUNT || totalBytes > LARGE_TOTAL_BYTES) {
          showToast('Large selection - this may take a while or use a lot of memory.', true);
        }
      }
    },
    [showToast],
  );

  const forgetFile = useCallback((entry) => {
    if (entry.thumbUrl) URL.revokeObjectURL(entry.thumbUrl);
    docsRef.current.get(entry.id)?.task?.destroy?.();
    docsRef.current.delete(entry.id);
    seenRef.current.delete(entry.id);
    for (const key of [...rasterRef.current.keys()]) {
      if (key.startsWith(`${entry.id}:`)) rasterRef.current.delete(key);
    }
  }, []);

  const removeFile = useCallback(
    (id) => {
      const entry = filesRef.current.find((f) => f.id === id);
      if (!entry) return;
      forgetFile(entry);
      announce(`Removed ${entry.name}`);
      setFiles((prev) => prev.filter((f) => f.id !== id));
    },
    [announce, forgetFile],
  );

  const clearAll = useCallback(() => {
    const current = filesRef.current;
    if (current.length === 0) return;
    // Guard against accidental loss of the whole queue.
    if (typeof window !== 'undefined' && !window.confirm(`Remove all ${current.length} files?`)) {
      return;
    }
    current.forEach(forgetFile);
    announce('Cleared all files');
    setCroppingId(null);
    historyRef.current = [];
    setHistoryDepth(0);
    setPages([]);
    setFiles([]);
  }, [announce, forgetFile]);

  // -- Page operations --

  const grouped = useMemo(() => arePagesGroupedByFile(pages), [pages]);

  /**
   * Apply a page operation, remembering the previous arrangement so it can be undone.
   *
   * Every user-facing page edit goes through here. Operations that change nothing (moving the
   * first page up, cropping to the full page) return the same array and are not recorded, so
   * undo never appears to do nothing.
   */
  const mutate = useCallback(
    (fn, message) => {
      const prev = pagesRef.current;
      const next = fn(prev);
      if (next === prev) return;
      historyRef.current = [...historyRef.current, prev].slice(-HISTORY_LIMIT);
      setHistoryDepth(historyRef.current.length);
      setPages(next);
      if (message) announce(message);
    },
    [announce],
  );

  const undo = useCallback(() => {
    const past = historyRef.current;
    if (past.length === 0) return;
    const restored = past[past.length - 1];
    historyRef.current = past.slice(0, -1);
    setHistoryDepth(historyRef.current.length);
    setCroppingId(null);
    setPages(restored);
    announce('Undid the last change');
  }, [announce]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z' || event.shiftKey) return;
      // Leave the browser's own undo alone while the user is typing a file name.
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
      event.preventDefault();
      undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo]);

  const moveDocument = useCallback(
    (fileId, direction) => {
      const entry = filesRef.current.find((f) => f.id === fileId);
      mutate(
        (prev) => moveFileBlock(prev, fileId, direction),
        `Moved ${entry?.name ?? 'document'} ${direction < 0 ? 'earlier' : 'later'}`,
      );
    },
    [mutate],
  );

  const onRotate = useCallback(
    (id, delta) => {
      mutate((prev) => rotatePage(prev, id, delta), delta < 0 ? 'Rotated page left' : 'Rotated page right');
    },
    [mutate],
  );

  const onDeletePage = useCallback(
    (id) => {
      const index = pagesRef.current.findIndex((p) => p.id === id);
      setCroppingId((current) => (current === id ? null : current));
      mutate((prev) => removePage(prev, id), `Removed page ${index + 1}. Press Control or Command Z to undo.`);
    },
    [mutate],
  );

  const onMovePage = useCallback(
    (id, direction) => {
      const from = pagesRef.current.findIndex((p) => p.id === id);
      const to = from + direction;
      if (to < 0 || to >= pagesRef.current.length) return;
      mutate((prev) => movePage(prev, id, to), `Moved page to position ${to + 1} of ${pagesRef.current.length}`);
    },
    [mutate],
  );

  const onStartCrop = useCallback((id) => setCroppingId(id), []);
  const onCancelCrop = useCallback(() => setCroppingId(null), []);

  const onApplyCrop = useCallback(
    (id, rect) => {
      setCroppingId(null);
      mutate((prev) => cropPage(prev, id, rect), rect ? 'Crop applied' : 'Crop cleared');
    },
    [mutate],
  );

  // -- Drag to reorder pages --

  const onDragStart = useCallback((id) => setDraggedId(id), []);
  const onDragOver = useCallback(
    (e, id) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (id !== draggedId) setDragTargetId(id);
    },
    [draggedId],
  );
  const onDragLeave = useCallback(() => setDragTargetId(null), []);
  const onDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragTargetId(null);
  }, []);

  const onItemDrop = useCallback(
    (targetId) => {
      setDragTargetId(null);
      if (!draggedId || targetId === draggedId) return;
      mutate((prev) => {
        const to = prev.findIndex((p) => p.id === targetId);
        return to === -1 ? prev : movePage(prev, draggedId, to);
      }, 'Reordered pages');
      setDraggedId(null);
    },
    [draggedId, mutate],
  );

  const pageCountsByFile = useMemo(() => {
    const counts = new Map();
    for (const page of pages) counts.set(page.fileId, (counts.get(page.fileId) ?? 0) + 1);
    return counts;
  }, [pages]);

  /** The sources in the shape the merge worker wants: no React state, no object URLs. */
  const asSources = useCallback(
    () => filesRef.current.map((f) => ({ fileId: f.id, name: f.name, type: f.type, file: f.file })),
    [],
  );

  return {
    files,
    pages,
    totalPages: pages.length,
    docsRef,
    grouped,
    pageCountsByFile,
    asSources,

    toast,
    liveMessage,
    showToast,
    announce,

    addFiles,
    removeFile,
    clearAll,
    getBitmap,

    mutate,
    undo,
    historyDepth,
    moveDocument,
    onRotate,
    onDeletePage,
    onMovePage,

    croppingId,
    onStartCrop,
    onCancelCrop,
    onApplyCrop,

    draggedId,
    dragTargetId,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDragEnd,
    onItemDrop,
  };
}
