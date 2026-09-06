"use client";

/**
 * Turning the pages of the session into something that is not a PDF.
 *
 * Browser-only: rendering needs a canvas and text extraction needs pdf.js, so this lives here
 * rather than in lib/. The parts that can be reasoned about without a browser — laying text
 * back out, building a .docx — are in lib/text-layout.js and lib/docx.js, and are tested there.
 *
 * Everything yields between pages. Rendering a 200-page document at 300 DPI is a lot of work,
 * and a loop that never gives the event loop a turn is a frozen tab with a progress overlay
 * that cannot repaint to say what it is doing.
 */

import { blocksFromItems } from "../../lib/text-layout";
import { drawPage } from "./pdf-render";

/** Resolutions offered for image export, in dots per inch. A PDF point is 1/72 inch. */
export const RESOLUTIONS = [
  { id: "96", label: "Screen (96 dpi)", dpi: 96 },
  { id: "150", label: "Good (150 dpi)", dpi: 150 },
  { id: "300", label: "Print (300 dpi)", dpi: 300 },
];
export const DEFAULT_RESOLUTION = "150";

export const FORMATS = [
  {
    id: "png",
    label: "PNG images",
    kind: "image",
    mime: "image/png",
    extension: "png",
  },
  {
    id: "jpeg",
    label: "JPEG images",
    kind: "image",
    mime: "image/jpeg",
    extension: "jpg",
  },
  { id: "txt", label: "Plain text", kind: "text", extension: "txt" },
  { id: "md", label: "Markdown", kind: "text", extension: "md" },
  { id: "docx", label: "Word (.docx)", kind: "text", extension: "docx" },
];
export const DEFAULT_FORMAT = "png";

export const formatById = (id) =>
  FORMATS.find((format) => format.id === id) || FORMATS[0];

/** Raised when the caller cancelled. Shares a name with the merge one so the UI treats it alike. */
export class ConvertCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "MergeCancelled";
  }
}

// Let the browser paint. Without this the progress overlay never updates and the Cancel button
// is never seen.
const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Run `work` with pdf.js's render loop driven by timers instead of animation frames.
 *
 * pdf.js steps a display render through `requestAnimationFrame`, and browsers stop calling that
 * in a hidden tab. Start a long export, switch to another tab to do something else — which is
 * exactly what people do while waiting — and the conversion silently stops until you come back,
 * with a progress overlay frozen mid-count and nothing to explain it.
 *
 * Swapping the scheduler for the duration is the smallest fix that keeps the *rendering intent*
 * identical to the preview, so the exported image still matches what the user was shown.
 * (`intent: 'print'` would also avoid rAF, but it renders annotations differently, and this
 * page promises the output matches the preview.)
 *
 * `cancelAnimationFrame` is swapped too: pdf.js cancels a pending frame when a render is
 * aborted, and leaving it pointing at the real implementation would let a cancelled render keep
 * stepping. Both are restored in a `finally`, always.
 */
async function withTimerDrivenFrames(work) {
  const frame = window.requestAnimationFrame;
  const cancel = window.cancelAnimationFrame;
  window.requestAnimationFrame = (callback) =>
    window.setTimeout(() => callback(performance.now()), 0);
  window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
  try {
    return await work();
  } finally {
    window.requestAnimationFrame = frame;
    window.cancelAnimationFrame = cancel;
  }
}

function checkCancelled(signal) {
  if (signal?.aborted) throw new ConvertCancelled();
}

/**
 * Render one page to a bitmap at the requested scale, honouring its rotation and crop.
 *
 * Deliberately not the preview cache: those are rendered at 1.4x for the screen, and exporting
 * them would hand the user a soft, upscaled image while telling them it was 300 dpi.
 */
async function rasterisePage(page, source, pdf, scale) {
  if (source.type !== "application/pdf") return createImageBitmap(source.file);

  const pdfPage = await pdf.getPage(page.sourceIndex + 1);
  try {
    const viewport = pdfPage.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext("2d");
    // JPEG has no transparency, and a PDF page is paper: white, not black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
    return await createImageBitmap(canvas);
  } finally {
    pdfPage.cleanup();
  }
}

const toBlob = (canvas, mime, quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("The browser could not encode this page")),
      mime,
      quality,
    );
  });

/**
 * Render every page to an image.
 *
 * Returns `[{ name, data }]`, ready for `createZip`. Names are zero-padded so a file manager
 * sorting alphabetically still shows page 2 before page 10.
 */
export async function renderPagesToImages(
  pages,
  {
    files,
    docs,
    format,
    dpi,
    quality = 0.85,
    baseName = "page",
    onProgress,
    signal,
  },
) {
  const spec = formatById(format);
  const scale = dpi / 72;
  const width = String(pages.length).length;
  const out = [];

  await withTimerDrivenFrames(async () => {
    for (let index = 0; index < pages.length; index++) {
      checkCancelled(signal);
      onProgress?.(`Rendering page ${index + 1} of ${pages.length}`);

      const page = pages[index];
      const source = files.find((file) => file.id === page.fileId);
      if (!source) continue;

      const bitmap = await rasterisePage(
        page,
        source,
        docs.get(page.fileId)?.pdf,
        scale,
      );
      const canvas = document.createElement("canvas");
      // A null target width keeps the pixels the render produced, so "300 dpi" means 300 dpi.
      drawPage(canvas, bitmap, page.rotation, page.crop, null);
      bitmap.close?.();

      const blob = await toBlob(
        canvas,
        spec.mime,
        spec.id === "jpeg" ? quality : undefined,
      );
      out.push({
        name: `${baseName}-${String(index + 1).padStart(width, "0")}.${spec.extension}`,
        data: new Uint8Array(await blob.arrayBuffer()),
      });

      // Release the backing store rather than waiting for the collector; at 300 dpi each of
      // these is tens of megabytes.
      canvas.width = 0;
      canvas.height = 0;
      await yieldToBrowser();
    }
  });

  return out;
}

/**
 * Extract the text of every page, laid back out into blocks.
 *
 * Image pages contribute nothing — there is no text in an image to find — and are skipped
 * rather than producing an empty page, which would leave unexplained gaps in the output.
 */
export async function extractPageBlocks(
  pages,
  { files, docs, onProgress, signal },
) {
  const out = [];

  for (let index = 0; index < pages.length; index++) {
    checkCancelled(signal);
    onProgress?.(`Reading page ${index + 1} of ${pages.length}`);

    const page = pages[index];
    const source = files.find((file) => file.id === page.fileId);
    const pdf =
      source && source.type === "application/pdf"
        ? docs.get(page.fileId)?.pdf
        : null;
    if (!pdf) continue;

    const pdfPage = await pdf.getPage(page.sourceIndex + 1);
    try {
      const content = await pdfPage.getTextContent();
      const blocks = blocksFromItems(content.items);
      if (blocks.length > 0) out.push(blocks);
    } finally {
      pdfPage.cleanup();
    }
    await yieldToBrowser();
  }

  return out;
}
