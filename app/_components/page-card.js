'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { isPristine } from '../../lib/pages';
import { drawPage } from '../_lib/pdf-render';

// -- One output page --

// Memoised, and every callback it takes is stable. Without this each progress tick during a
// merge re-renders every card in the document — with a few hundred pages that is the single
// biggest main-thread cost in the app, and moving the merge into a worker made it worse by
// letting progress messages arrive far more often.
export const PageCard = memo(function PageCard({
  page,
  index,
  total,
  source,
  getBitmap,
  cropping,
  onStartCrop,
  onCancelCrop,
  onApplyCrop,
  onRotate,
  onDelete,
  onMove,
  isDragging,
  isDragTarget,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  // Selection is opt-in: merge and organise have no use for it, extract and split are built
  // around it. Both extra props are primitives or stable callbacks, so the memo still holds.
  selectable = false,
  selected = false,
  onToggleSelect,
}) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const [bitmap, setBitmap] = useState(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState(null);

  const label = `Page ${index + 1}`;
  const sourceLabel = page.blank
    ? 'Blank page'
    : source
      ? `${source.name} (p.${page.sourceIndex + 1})`
      : 'Unknown source';

  // Render only once the page is near the viewport: a 400-page document should not rasterise
  // 400 pages before the user has scrolled.
  useEffect(() => {
    if (visible) return undefined;
    const el = hostRef.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    let alive = true;
    getBitmap(page)
      .then((bm) => {
        if (alive) setBitmap(bm);
      })
      .catch((err) => {
        console.error('Preview failed:', sourceLabel, err);
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
    // Only the source identity matters: rotation and crop are applied over the bitmap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, page.fileId, page.sourceIndex, getBitmap]);

  useEffect(() => {
    if (!bitmap || !canvasRef.current) return;
    // While cropping, show the whole page so there is something to drag a box over.
    drawPage(canvasRef.current, bitmap, page.rotation, cropping ? null : page.crop);
  }, [bitmap, page.rotation, page.crop, cropping]);

  useEffect(() => {
    if (!cropping) setDraft(null);
  }, [cropping]);

  return (
    <div
      ref={hostRef}
      className={`preview-page${isDragging ? ' dragging' : ''}${isDragTarget ? ' drag-target' : ''}${cropping ? ' cropping' : ''}${selectable && selected ? ' selected' : ''}`}
      draggable={!cropping}
      onDragStart={() => onDragStart(page.id)}
      onDragOver={(e) => onDragOver(e, page.id)}
      onDragLeave={onDragLeave}
      onDrop={() => onDrop(page.id)}
      onDragEnd={onDragEnd}
    >
      <div className="preview-page-inner">
        {failed ? (
          <div className="preview-error">Could not render this page</div>
        ) : (
          <>
            <canvas ref={canvasRef} className="preview-canvas" role="img" aria-label={page.blank ? `${label}, blank` : `${label} of ${sourceLabel}`} />
            {!bitmap && (
              <div className="preview-loading">
                <div className="spinner-sm" aria-hidden="true" />
                <span className="preview-loading-text">Rendering...</span>
              </div>
            )}
            {cropping && bitmap && <CropLayer draft={draft} onDraft={setDraft} />}
          </>
        )}
      </div>

      {cropping ? (
        <div className="crop-actions">
          <span className="crop-hint">{draft ? 'Drag again to redraw' : 'Drag a box over the page'}</span>
          {page.crop && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onApplyCrop(page.id, null)}>
              Clear crop
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancelCrop}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!draft} onClick={() => onApplyCrop(page.id, draft)}>
            Apply crop
          </button>
        </div>
      ) : (
        <div className="page-bar">
          {selectable && (
            <label className="page-select">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggleSelect(page.id)}
              />
              <span className="sr-only">{`Include ${label} of ${sourceLabel}`}</span>
            </label>
          )}
          <span className="preview-page-num">
            {label}
            {!isPristine(page) && (
              <span className="page-edited" title="This page has been rotated or cropped">
                {' '}
                &middot; edited
              </span>
            )}
          </span>

          <div className="page-controls">
            <button type="button" className="page-btn" aria-label={`Rotate ${label} left`} onClick={() => onRotate(page.id, -90)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
                <path d="M3 12a9 9 0 1 0 3-6.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="page-btn" aria-label={`Rotate ${label} right`} onClick={() => onRotate(page.id, 90)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
                <path d="M21 12a9 9 0 1 1-3-6.7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M21 3v5h-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="page-btn" aria-label={`Crop ${label}`} onClick={() => onStartCrop(page.id)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
                <path d="M6 2v14a2 2 0 0 0 2 2h14" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M18 22V8a2 2 0 0 0-2-2H2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="page-btn" aria-label={`Move ${label} up`} onClick={() => onMove(page.id, -1)} disabled={index === 0}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
                <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="page-btn" aria-label={`Move ${label} down`} onClick={() => onMove(page.id, 1)} disabled={index === total - 1}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button type="button" className="page-btn page-btn-danger" aria-label={`Remove ${label}`} onClick={() => onDelete(page.id)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <span className="preview-page-source" title={sourceLabel}>
            {sourceLabel}
          </span>
        </div>
      )}
    </div>
  );
});

// -- Crop rectangle --

// Drag a box over the page. Coordinates are kept as 0..1 fractions of the displayed page, so
// they mean the same thing whatever the preview is scaled to - and the same thing to the
// merge, which applies them to the full-resolution source.
function CropLayer({ draft, onDraft }) {
  const layerRef = useRef(null);
  const startRef = useRef(null);

  const pointFrom = (event) => {
    const rect = layerRef.current.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const onPointerDown = (event) => {
    event.preventDefault();
    // Capture keeps the drag alive if the pointer leaves the page box. It is an enhancement,
    // not a requirement — never let its absence break cropping.
    try {
      layerRef.current.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture unavailable */
    }
    startRef.current = pointFrom(event);
    onDraft(null);
  };

  const onPointerMove = (event) => {
    if (!startRef.current) return;
    const start = startRef.current;
    const now = pointFrom(event);
    onDraft({
      x: Math.min(start.x, now.x),
      y: Math.min(start.y, now.y),
      width: Math.abs(now.x - start.x),
      height: Math.abs(now.y - start.y),
    });
  };

  const onPointerUp = (event) => {
    if (!startRef.current) return;
    startRef.current = null;
    try {
      layerRef.current.releasePointerCapture(event.pointerId);
    } catch {
      /* never captured */
    }
    // Ignore an accidental click: too small a box would crop the page to nothing.
    if (draft && (draft.width < 0.02 || draft.height < 0.02)) onDraft(null);
  };

  const style = draft
    ? {
        left: `${draft.x * 100}%`,
        top: `${draft.y * 100}%`,
        width: `${draft.width * 100}%`,
        height: `${draft.height * 100}%`,
      }
    : null;

  return (
    <div
      ref={layerRef}
      className="crop-layer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {style && <div className="crop-rect" style={style} />}
    </div>
  );
}
