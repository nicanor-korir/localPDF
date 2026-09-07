'use client';

import { memo, useCallback, useRef, useState } from 'react';
import { PREVIEW_SCALE } from '../_lib/pdf-render';
import { fractionOf, usePageRaster } from '../_lib/use-page-raster';

const EMPTY = [];

/**
 * How tall this page is in PDF points, so a size in points can be shown at the right size.
 *
 * Mirrors what `drawPage` does — rotate, then crop the rotated result — because the preview is
 * what the overlay was placed against, and a font that looks right on screen and comes out
 * twice the size would make the whole tool untrustworthy.
 */
function pageHeightInPoints(bitmap, rotation, crop) {
  const quarter = rotation === 90 || rotation === 270;
  const rotH = quarter ? bitmap.width : bitmap.height;
  const cropped = crop ? crop.height * rotH : rotH;
  return Math.max(1, cropped / PREVIEW_SCALE);
}

/**
 * One page in the editor: the rendered page, with whatever has been added on top of it.
 *
 * Memoised like `PageCard`, and for the same reason — but with one addition that matters more
 * here: dragging keeps the box in local state and only commits on release. Without that, every
 * pointermove would push a new array into the store, re-render every page in the document and
 * record an undo step per pixel.
 */
export const EditPage = memo(function EditPage({
  page,
  index,
  source,
  getBitmap,
  overlays = EMPTY,
  selectedId,
  onSelect,
  onChangeBox,
  onAddText,
  onAddImage,
  canAddImage,
}) {
  const { hostRef, canvasRef, bitmap, failed } = usePageRaster(page, getBitmap);
  const layerRef = useRef(null);
  const [draft, setDraft] = useState(null);
  const dragRef = useRef(null);

  const onPointerDown = useCallback(
    (event, overlay, mode) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect(overlay.id);
      const layer = layerRef.current;
      if (!layer) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      const at = fractionOf(layer, event);
      dragRef.current = { id: overlay.id, mode, startX: at.x, startY: at.y, box: { ...overlay } };
      setDraft({ id: overlay.id, box: { ...overlay } });
    },
    [onSelect],
  );

  const onPointerMove = useCallback((event) => {
    const drag = dragRef.current;
    const layer = layerRef.current;
    if (!drag || !layer) return;
    const at = fractionOf(layer, event);
    const dx = at.x - drag.startX;
    const dy = at.y - drag.startY;
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
    // Committed once, on release: a store write per pointermove would re-render every page in
    // the document and fill the undo stack with a step per pixel.
    setDraft((current) => {
      if (current) onChangeBox(drag.id, current.box);
      return null;
    });
  }, [onChangeBox]);

  const label = `Page ${index + 1}`;
  const heightPt = bitmap ? pageHeightInPoints(bitmap, page.rotation, page.crop) : 842;

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
              aria-label={page.blank ? `${label}, blank` : `${label} of ${source?.name ?? 'the document'}`}
            />
            {!bitmap && (
              <div className="preview-loading">
                <div className="spinner-sm" aria-hidden="true" />
                <span className="preview-loading-text">Rendering...</span>
              </div>
            )}
            <div
              ref={layerRef}
              className="overlay-layer"
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onClick={() => onSelect(null)}
            >
              {overlays.map((overlay) => {
                const box = draft?.id === overlay.id ? draft.box : overlay;
                const selected = overlay.id === selectedId;
                const style = {
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                };
                return (
                  <div
                    key={overlay.id}
                    className={`overlay-box${selected ? ' selected' : ''}`}
                    style={style}
                    onPointerDown={(e) => onPointerDown(e, overlay, 'move')}
                  >
                    {overlay.type === 'text' ? (
                      <span
                        className="overlay-text"
                        style={{
                          // Points to on-screen pixels, using this page's own height, so what
                          // is shown is the size that will be written.
                          fontSize: `calc(${overlay.size} / ${heightPt} * 100%)`,
                          color: overlay.colour === 'white' ? '#fff' : undefined,
                        }}
                        data-colour={overlay.colour}
                      >
                        {overlay.text || 'Type something'}
                      </span>
                    ) : (
                      <span className="overlay-image" aria-hidden="true" />
                    )}
                    {selected && (
                      <span
                        className="overlay-handle"
                        onPointerDown={(e) => onPointerDown(e, overlay, 'resize')}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="page-bar">
        <span className="preview-page-num">{label}</span>
        <div className="page-controls">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAddText(page.id)}>
            + Text
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onAddImage(page.id)}
            disabled={!canAddImage}
            title={canAddImage ? 'Place an image on this page' : 'Add an image to the documents first'}
          >
            + Image
          </button>
        </div>
      </div>
    </div>
  );
});
