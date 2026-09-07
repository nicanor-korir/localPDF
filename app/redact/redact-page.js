'use client';

import { memo, useCallback, useRef, useState } from 'react';
import { fractionOf, usePageRaster } from '../_lib/use-page-raster';

const EMPTY = [];
// A drag shorter than this is a click, not an attempt to draw a box.
const MIN_DRAG = 0.01;

/**
 * One page in the redaction tool: the page, with the regions marked for removal on top of it.
 *
 * Dragging on the page draws a new region; dragging a region moves it; the corner resizes it.
 * As in the editor, a drag is held in local state and committed on release — a store write per
 * pointermove would re-render every page and record an undo step per pixel.
 */
export const RedactPage = memo(function RedactPage({
  page,
  index,
  source,
  getBitmap,
  redactions = EMPTY,
  selectedId,
  onSelect,
  onDraw,
  onChangeBox,
  onRemove,
}) {
  const { hostRef, canvasRef, bitmap, failed } = usePageRaster(page, getBitmap);
  const layerRef = useRef(null);
  const [draft, setDraft] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const dragRef = useRef(null);

  const startDraw = useCallback(
    (event) => {
      // Only a drag on the page itself starts a new region; a drag on an existing one moves it.
      if (event.target !== layerRef.current) return;
      event.preventDefault();
      onSelect(null);
      const at = fractionOf(layerRef.current, event);
      layerRef.current.setPointerCapture?.(event.pointerId);
      dragRef.current = { mode: 'draw', from: at };
      setDrawing({ x: at.x, y: at.y, width: 0, height: 0 });
    },
    [onSelect],
  );

  const startBox = useCallback(
    (event, region, mode) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect(region.id);
      const at = fractionOf(layerRef.current, event);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragRef.current = { mode, id: region.id, from: at, box: { ...region } };
      setDraft({ id: region.id, box: { ...region } });
    },
    [onSelect],
  );

  const onPointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || !layerRef.current) return;
    const at = fractionOf(layerRef.current, event);

    if (drag.mode === 'draw') {
      setDrawing({
        x: Math.min(drag.from.x, at.x),
        y: Math.min(drag.from.y, at.y),
        width: Math.abs(at.x - drag.from.x),
        height: Math.abs(at.y - drag.from.y),
      });
      return;
    }

    const dx = at.x - drag.from.x;
    const dy = at.y - drag.from.y;
    const box = drag.box;
    setDraft({
      id: drag.id,
      box:
        drag.mode === 'move'
          ? { ...box, x: box.x + dx, y: box.y + dy }
          : { ...box, width: box.width + dx, height: box.height + dy },
    });
  }, []);

  const onPointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;

    if (drag.mode === 'draw') {
      setDrawing((box) => {
        // A stray click should not leave an invisible region behind on the page.
        if (box && box.width >= MIN_DRAG && box.height >= MIN_DRAG) onDraw(page.id, box);
        return null;
      });
      return;
    }

    setDraft((current) => {
      if (current) onChangeBox(drag.id, current.box);
      return null;
    });
  }, [onChangeBox, onDraw, page.id]);

  const label = `Page ${index + 1}`;

  return (
    <div ref={hostRef} className="preview-page edit-page">
      <div className="preview-page-inner">
        {failed ? (
          <div className="preview-error">Could not render this page</div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              className="preview-canvas"
              role="img"
              aria-label={`${label} of ${source?.name ?? 'the document'}`}
            />
            {!bitmap && (
              <div className="preview-loading">
                <div className="spinner-sm" aria-hidden="true" />
                <span className="preview-loading-text">Rendering...</span>
              </div>
            )}
            <div
              ref={layerRef}
              className="overlay-layer redact-layer"
              onPointerDown={startDraw}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {redactions.map((region) => {
                const box = draft?.id === region.id ? draft.box : region;
                const selected = region.id === selectedId;
                return (
                  <div
                    key={region.id}
                    className={`redaction-box${selected ? ' selected' : ''}`}
                    style={{
                      left: `${box.x * 100}%`,
                      top: `${box.y * 100}%`,
                      width: `${box.width * 100}%`,
                      height: `${box.height * 100}%`,
                    }}
                    onPointerDown={(e) => startBox(e, region, 'move')}
                  >
                    {selected && (
                      <>
                        <button
                          type="button"
                          className="redaction-remove"
                          aria-label={`Remove this region from ${label}`}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => onRemove(region.id)}
                        >
                          &times;
                        </button>
                        <span
                          className="overlay-handle"
                          onPointerDown={(e) => startBox(e, region, 'resize')}
                          aria-hidden="true"
                        />
                      </>
                    )}
                  </div>
                );
              })}
              {drawing && (
                <div
                  className="redaction-box drawing"
                  style={{
                    left: `${drawing.x * 100}%`,
                    top: `${drawing.y * 100}%`,
                    width: `${drawing.width * 100}%`,
                    height: `${drawing.height * 100}%`,
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>

      <div className="page-bar">
        <span className="preview-page-num">
          {label}
          {redactions.length > 0 && (
            <span className="page-edited">
              {' '}
              &middot; {redactions.length} region{redactions.length === 1 ? '' : 's'}
            </span>
          )}
        </span>
      </div>
    </div>
  );
});
