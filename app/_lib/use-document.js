'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
  isBlank,
  moveFileBlock,
  movePage,
  reconcilePages,
  removePage,
  renderKey,
  rotatePage,
} from '../../lib/pages';
import * as store from './document-store';
import { MAX_CACHED_RASTERS, PREVIEW_SCALE, loadPdfjs } from './pdf-render';

/**
 * The document session, as a React binding over the store in ./document-store.js.
 *
 * Every tool works on the same model — `pages[]`, where an entry is one page of the *output*
 * holding a pointer back to a source plus the transforms applied to it. Merge, extract, split
 * and organise differ only in what they do with that array at the end, which is why they share
 * this hook rather than each growing their own copy of it.
 *
 * The state lives outside React so it survives moving between tools: switching from Organise
 * to Split unmounts one route and mounts another, and the files must not go with it.
 *
 * Transient interaction state — which page is being cropped, what is being dragged — stays in
 * the component, because it genuinely should reset when the tool changes.
 */
export function useDocumentSession() {
  const { files, pages, overlays, historyDepth, countsVersion } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const [toast, setToast] = useState(null);
  const [liveMessage, setLiveMessage] = useState('');
  const [croppingId, setCroppingId] = useState(null);
  const [draggedId, setDraggedId] = useState(null);
  const [dragTargetId, setDragTargetId] = useState(null);

  // Arranging fifty pages and then closing the tab loses all of it — there is no server-side
  // copy to come back to, by design, and nothing is written to disk.
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

  const toastTimer = useRef(null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

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
      let changed = false;

      for (const entry of files) {
        if (store.docs.has(entry.id)) continue;
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
            store.docs.set(entry.id, { pdf, task, pageCount: pdf.numPages });
          } else {
            store.docs.set(entry.id, { pdf: null, task: null, pageCount: 1 });
          }
        } catch (err) {
          console.error('Could not read file:', entry.name, err);
          store.docs.set(entry.id, { pdf: null, task: null, pageCount: 0, failed: true });
        }
        changed = true;
      }

      if (!cancelled && changed) store.bumpCounts();
    })();

    return () => {
      cancelled = true;
    };
  }, [files]);

  // -- Keep the page list in step with the sources --

  useEffect(() => {
    const known = files
      .filter((f) => store.docs.has(f.id))
      .map((f) => ({ fileId: f.id, pageCount: store.docs.get(f.id).pageCount }));

    const next = reconcilePages(store.getPages(), known, store.seen);
    for (const source of known) {
      if (source.pageCount > 0) store.seen.add(source.fileId);
    }
    // Adding or removing a document changes which pages exist at all, so earlier arrangements
    // refer to pages that may be gone. Undoing into one would be incoherent, so resetPages
    // clears the history.
    store.resetPages(next);
  }, [files, countsVersion]);

  // -- Rendering --

  const getBitmap = useCallback(async (page) => {
    const key = renderKey(page);
    if (store.rasters.has(key)) return store.rasters.get(key);

    let bitmap;
    if (isBlank(page)) {
      // A4 proportions, because that is what a blank page comes out as unless the page before
      // it says otherwise — and one white raster serves every blank page in the document.
      const canvas = document.createElement('canvas');
      canvas.width = 595;
      canvas.height = 842;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      bitmap = await createImageBitmap(canvas);
      store.rasters.set(key, bitmap);
      return bitmap;
    }

    const source = store.getFiles().find((f) => f.id === page.fileId);
    if (!source) throw new Error('Source file is no longer available');

    if (source.type === 'application/pdf') {
      const pdf = store.docs.get(page.fileId)?.pdf;
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

    store.rasters.set(key, bitmap);
    // Evicted entries are dropped rather than close()d: a component may still hold one, and
    // drawing a closed bitmap throws.
    while (store.rasters.size > MAX_CACHED_RASTERS) {
      store.rasters.delete(store.rasters.keys().next().value);
    }
    return bitmap;
  }, []);

  // -- Add / remove sources --

  const addFiles = useCallback(
    (fileList) => {
      const current = store.getFiles();
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
        if (current.some((f) => f.name === file.name && f.size === file.size)) {
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
        const next = [...current, ...newEntries];
        store.setFiles(next);
        const totalBytes = next.reduce((sum, f) => sum + f.size, 0);
        if (next.length > LARGE_FILE_COUNT || totalBytes > LARGE_TOTAL_BYTES) {
          showToast('Large selection - this may take a while or use a lot of memory.', true);
        }
      }
    },
    [showToast],
  );

  const removeFile = useCallback(
    (id) => {
      const entry = store.getFiles().find((f) => f.id === id);
      if (!entry) return;
      store.forget(entry);
      announce(`Removed ${entry.name}`);
      store.setFiles(store.getFiles().filter((f) => f.id !== id));
    },
    [announce],
  );

  const clearAll = useCallback(() => {
    const current = store.getFiles();
    if (current.length === 0) return;
    // Guard against accidental loss of the whole queue.
    if (typeof window !== 'undefined' && !window.confirm(`Remove all ${current.length} files?`)) {
      return;
    }
    setCroppingId(null);
    store.clearAll();
    announce('Cleared all files');
  }, [announce]);

  // -- Page operations --

  const grouped = useMemo(() => arePagesGroupedByFile(pages), [pages]);

  const mutate = useCallback(
    (fn, message) => {
      if (store.mutatePages(fn) && message) announce(message);
    },
    [announce],
  );

  /** Apply an overlay operation, on the same undo terms as a page operation. */
  const editOverlays = useCallback(
    (fn, message) => {
      if (store.mutateOverlays(fn) && message) announce(message);
    },
    [announce],
  );

  const undo = useCallback(() => {
    setCroppingId(null);
    if (store.undoPages()) announce('Undid the last change');
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
      const entry = store.getFiles().find((f) => f.id === fileId);
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
      const index = store.getPages().findIndex((p) => p.id === id);
      setCroppingId((current) => (current === id ? null : current));
      mutate((prev) => removePage(prev, id), `Removed page ${index + 1}. Press Control or Command Z to undo.`);
    },
    [mutate],
  );

  const onMovePage = useCallback(
    (id, direction) => {
      const list = store.getPages();
      const from = list.findIndex((p) => p.id === id);
      const to = from + direction;
      if (to < 0 || to >= list.length) return;
      mutate((prev) => movePage(prev, id, to), `Moved page to position ${to + 1} of ${list.length}`);
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
    () => store.getFiles().map((f) => ({ fileId: f.id, name: f.name, type: f.type, file: f.file })),
    [],
  );

  return {
    files,
    pages,
    overlays,
    editOverlays,
    totalPages: pages.length,
    docs: store.docs,
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
