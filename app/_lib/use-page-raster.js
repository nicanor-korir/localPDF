'use client';

import { useEffect, useRef, useState } from 'react';
import { drawPage } from './pdf-render';

/**
 * Render one page into a canvas, lazily, with its rotation and crop applied.
 *
 * The scaffolding the editors share: render only once the page is near the viewport, so a
 * 400-page document does not rasterise 400 pages before anyone scrolls, and redraw when the
 * transforms change. Extracted so the edit and redact pages cannot drift on what a page looks
 * like — which for redaction matters, because a box is only in the right place if the page
 * underneath it is drawn the same way twice.
 */
export function usePageRaster(page, getBitmap) {
  const hostRef = useRef(null);
  const canvasRef = useRef(null);
  const [bitmap, setBitmap] = useState(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

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
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    getBitmap(page)
      .then((result) => {
        if (!cancelled) setBitmap(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, page.fileId, page.sourceIndex, getBitmap]);

  useEffect(() => {
    if (!bitmap || !canvasRef.current) return;
    drawPage(canvasRef.current, bitmap, page.rotation, page.crop);
  }, [bitmap, page.rotation, page.crop]);

  return { hostRef, canvasRef, bitmap, failed };
}

/** Where a pointer is within an element, as 0..1 fractions. */
export function fractionOf(element, event) {
  const rect = element.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
  };
}
