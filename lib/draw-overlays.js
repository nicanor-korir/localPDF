/**
 * Draw what the user added — a line of text, or an image — onto a page.
 *
 * Called from the merge, immediately after `applyPageTransform` and *before* `fitPageToBox`.
 * That moment matters: the page's media box is then exactly the content the user was looking
 * at when they placed the overlay, origin-normalised, so a 0..1 display coordinate means the
 * same thing here as it did on screen. Everything after — scaling to A4, centring — moves the
 * overlay along with the rest of the page, which is what should happen.
 *
 * DOM-free, so the whole path is tested in Node against real PDF fixtures.
 */

import { StandardFonts, degrees, rgb } from 'pdf-lib';
import {
  cropToContentRect,
  localToContent,
  normalizeRotation,
  placeInContentRect,
} from './pdf-geometry.js';
import { colourOf, toWritableText, unwritableCharacters } from './overlays.js';

/**
 * Fonts are embedded once per document and reused.
 *
 * The standard fonts need no font file, so a text box costs the output nothing but the
 * characters themselves. The trade is WinAnsi: see `overlays.js` for what that excludes and
 * why the UI says so rather than quietly dropping characters.
 */
export function createFontCache(doc) {
  let helvetica = null;
  return {
    async regular() {
      helvetica ||= await doc.embedFont(StandardFonts.Helvetica);
      return helvetica;
    },
  };
}

/**
 * Where an overlay's 0..1 box lands in content space.
 *
 * `frame` is the content rect the overlay coordinates are relative to. For a PDF page that is
 * the whole media box, because `applyPageTransform` has just normalised it to the origin. For
 * an image page it is the rectangle the picture occupies on the sheet, which is smaller — the
 * user placed the overlay on the image, not on the surrounding paper.
 *
 * The offset is added after the rotation mapping, which is only correct while a non-zero
 * offset implies no rotation. That holds: the only offset frame is an image page, and an
 * image's rotation is already baked into its pixels by the time it is embedded.
 */
function contentRectFor(overlay, frame, rotation) {
  const local = cropToContentRect(overlay, frame.width, frame.height, rotation);
  return { ...local, x: local.x + frame.x, y: local.y + frame.y };
}

function drawTextOverlay(page, overlay, { font, frame, rotation, notes }) {
  const missing = unwritableCharacters(overlay.text);
  if (missing.length > 0) {
    // Substituted rather than dropped, and reported: a word going missing from a document
    // without anyone being told is the worst version of this.
    notes.push({ type: 'unwritable', characters: missing });
  }
  const text = toWritableText(overlay.text).replace(/\s+/g, ' ').trim();
  if (!text) return;

  const placed = placeInContentRect(contentRectFor(overlay, frame, rotation), rotation);

  // The overlay box is where the user drew it; the text sits on a baseline near its top, which
  // is where a text box puts its first line.
  const size = Math.max(4, Math.min(overlay.size ?? 14, placed.height));
  const baseline = localToContent(placed, rotation, 0, Math.max(0, placed.height - size));
  const [r, g, b] = colourOf(overlay.colour).rgb;

  page.drawText(text, {
    x: baseline.x,
    y: baseline.y,
    size,
    font,
    color: rgb(r, g, b),
    rotate: degrees(placed.rotate),
  });
}

function drawImageOverlay(page, overlay, image, { frame, rotation }) {
  const placed = placeInContentRect(contentRectFor(overlay, frame, rotation), rotation);
  page.drawImage(image, {
    x: placed.anchor.x,
    y: placed.anchor.y,
    width: placed.width,
    height: placed.height,
    rotate: degrees(placed.rotate),
  });
}

/**
 * Draw every overlay belonging to this page.
 *
 * `embedImage(fileId)` returns an embedded pdf-lib image, or null when the source is gone.
 * `frame` is the content rect the overlay coordinates are relative to; it defaults to the whole
 * page, which is what a PDF page wants.
 *
 * Returns notes worth telling the user about — currently only characters the built-in fonts
 * could not write.
 */
export async function drawOverlays(page, overlays, { fontCache, embedImage, frame = null }) {
  const notes = [];
  if (!overlays || overlays.length === 0) return notes;

  const { width, height } = page.getSize();
  const rotation = normalizeRotation(page.getRotation().angle);
  const context = { frame: frame ?? { x: 0, y: 0, width, height }, rotation, notes };

  for (const overlay of overlays) {
    try {
      if (overlay.type === 'text') {
        drawTextOverlay(page, overlay, { ...context, font: await fontCache.regular() });
      } else if (overlay.type === 'image') {
        const image = await embedImage(overlay.fileId);
        if (image) drawImageOverlay(page, overlay, image, context);
      }
    } catch (err) {
      // One overlay that will not draw must not cost the page it sits on.
      console.error('Skipping an overlay:', err);
      notes.push({ type: 'failed' });
    }
  }

  return notes;
}
