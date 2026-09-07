'use client';

/**
 * Removing content from a page, rather than covering it up.
 *
 * A black rectangle drawn over text in a PDF hides nothing: the text is still an object in the
 * file, and anyone can select it, copy it, or read it with a parser. Tools that ship that as
 * "redaction" are the reason people's names keep turning up in supposedly redacted documents.
 * This app's whole claim is that it does not leak, so it cannot be one of them.
 *
 * So a redacted page is **rendered to pixels and replaced by that image**. Everything that was
 * on it — the text under the box and the text beside it — stops existing as text. That is a
 * real cost, and the page says so: the redacted pages lose their selectable text and their
 * links. It buys the one thing that matters here, which is that the removal is total and can
 * be checked afterwards rather than believed.
 *
 * The check is not rhetorical: `verifyRedaction` re-opens the finished document and confirms
 * those pages carry no text at all.
 */

import { drawPage, loadPdfjs } from './pdf-render';
import { rasterisePage } from './convert';

/** Rendering resolution for a redacted page. High enough to print, low enough to stay sane. */
export const REDACTION_DPI = 200;

/**
 * Render one page with its redactions burned in, and report the size it should come out.
 *
 * The boxes are painted in the same normalised space they were drawn in, onto the same
 * rotated-and-cropped raster the user was looking at, so what is covered on screen is exactly
 * what is covered in the pixels.
 */
export async function rasteriseRedactedPage(page, source, pdf, redactions, { dpi = REDACTION_DPI } = {}) {
  const bitmap = await rasterisePage(page, source, pdf, dpi / 72);
  const canvas = document.createElement('canvas');
  // A null target width keeps the pixels the render produced.
  drawPage(canvas, bitmap, page.rotation, page.crop, null);
  bitmap.close?.();

  const context = canvas.getContext('2d');
  context.fillStyle = '#000000';
  for (const box of redactions) {
    context.fillRect(
      Math.floor(box.x * canvas.width),
      Math.floor(box.y * canvas.height),
      Math.ceil(box.width * canvas.width),
      Math.ceil(box.height * canvas.height),
    );
  }

  const blob = await new Promise((resolve, reject) => {
    // PNG, not JPEG: a black rectangle over text is exactly the high-contrast edge JPEG
    // smears, and a smeared edge on a redaction looks like a mistake even when it is not one.
    canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Could not render the page'))), 'image/png');
  });

  const size = { width: (canvas.width / dpi) * 72, height: (canvas.height / dpi) * 72 };
  canvas.width = 0;
  canvas.height = 0;
  return { blob, ...size };
}

/**
 * Confirm the finished document really has no text on the pages that were redacted.
 *
 * The point of doing this rather than trusting the pipeline: "it looked right" is exactly the
 * evidence every leaked redaction had. Returns the indexes of any page that still carries
 * text, which should always be empty.
 */
export async function verifyRedaction(bytes, redactedPageIndexes) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({ data: new Uint8Array(bytes) });
  try {
    const doc = await task.promise;
    const leaked = [];
    for (const index of redactedPageIndexes) {
      if (index < 0 || index >= doc.numPages) continue;
      const page = await doc.getPage(index + 1);
      try {
        const content = await page.getTextContent();
        if (content.items.some((item) => item.str.trim())) leaked.push(index);
      } finally {
        page.cleanup();
      }
    }
    return leaked;
  } finally {
    await task.destroy();
  }
}
