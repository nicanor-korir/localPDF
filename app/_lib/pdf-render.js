/**
 * Turning a source page into pixels, and drawing those pixels with the user's transforms.
 *
 * Browser-only by nature (pdf.js, canvas, ImageBitmap), which is exactly why it lives here and
 * not in lib/: everything in lib/ stays DOM-free so it can be unit-tested in Node.
 */

import { assetUrl } from '../../lib/asset-path';

export const PREVIEW_SCALE = 1.4;
// Backing width for the display canvas, independent of the layout width so a wider column or
// a zoomed page stays sharp without re-rendering the PDF.
export const CANVAS_WIDTH = 760;
// Rendered pages are held as ImageBitmaps — decoded pixels — so cap how many we keep. Evicted
// entries are dropped rather than close()d: a component may still hold one, and drawing a
// closed bitmap throws.
export const MAX_CACHED_RASTERS = 60;
// Undo depth. Deep enough to walk back a run of mistaken edits, bounded so a long session

export async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const lib = pdfjs.default || pdfjs;
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = assetUrl('pdf.worker.min.js');
  }
  return lib;
}

/**
 * Draw a page's raster with its rotation and crop applied, scaled to `targetWidth`.
 *
 * Deliberately the same order as compressImage(): rotate, then crop the rotated result. The
 * preview is what the user cropped against, so any divergence here would surface as an output
 * that does not match what they saw.
 */
export function drawPage(canvas, bitmap, rotation, crop, targetWidth = CANVAS_WIDTH) {
  const quarter = rotation === 90 || rotation === 270;
  const rotW = quarter ? bitmap.height : bitmap.width;
  const rotH = quarter ? bitmap.width : bitmap.height;

  const cx = crop ? crop.x * rotW : 0;
  const cy = crop ? crop.y * rotH : 0;
  const cw = crop ? crop.width * rotW : rotW;
  const ch = crop ? crop.height * rotH : rotH;
  if (cw <= 0 || ch <= 0) return;

  // A null target means "whatever the source is", which is what an export wants: the page is
  // already rendered at the resolution the caller asked for, and rescaling it here would
  // either soften it or waste the pixels.
  const scale = targetWidth === null ? 1 : targetWidth / cw;
  canvas.width = Math.max(1, Math.round(cw * scale));
  canvas.height = Math.max(1, Math.round(ch * scale));

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
  ctx.translate(rotW / 2, rotH / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  ctx.restore();
}
