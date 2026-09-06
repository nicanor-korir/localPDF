/**
 * Re-encode one image out of a PDF, smaller.
 *
 * The geometry and the decisions live here; the two things that differ between the page and a
 * worker — how you make a canvas, and how you get bytes back out of one — are injected. That
 * is the same arrangement `compress-image.js` and `compress-image-worker.js` use, and for the
 * same reason: the two encoders cannot drift if there is only one of them.
 *
 * Everything comes back as a baseline JPEG. That is the only lossy format PDF understands
 * natively (`/DCTDecode`), and re-encoding a photograph as PNG would make it larger — which
 * for a tool whose entire job is making the file smaller would be a strange thing to do.
 */

/**
 * The size to draw at: never enlarged, and never past the cap on the longest side.
 *
 * Rounded to whole pixels, and never to zero — a canvas of zero width throws.
 */
export function targetSize(width, height, maxPixels) {
  const longest = Math.max(width, height);
  const scale = longest > maxPixels ? maxPixels / longest : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/**
 * Lay inflated samples out as RGBA for a canvas.
 *
 * Only the two arrangements `decodeStrategy` admits: one byte per pixel of grey, or three of
 * red, green and blue. Anything else was refused earlier rather than guessed at here.
 */
export function samplesToRgba(samples, width, height, components) {
  const pixels = width * height;
  if (samples.length < pixels * components) return null;

  const rgba = new Uint8ClampedArray(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    const from = i * components;
    const to = i * 4;
    if (components === 1) {
      rgba[to] = rgba[to + 1] = rgba[to + 2] = samples[from];
    } else {
      rgba[to] = samples[from];
      rgba[to + 1] = samples[from + 1];
      rgba[to + 2] = samples[from + 2];
    }
    rgba[to + 3] = 255;
  }
  return rgba;
}

/**
 * Undo the stream's filters, so the bytes become samples.
 *
 * Borrows pdf-lib's decoder rather than adding another: it already handles Flate, LZW and the
 * PNG predictors, and getting a predictor wrong turns a photograph into diagonal noise.
 */
export async function inflateSamples(data, info) {
  if (info.filters.length === 0) return data;

  const { PDFContext, PDFDict, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } =
    await import('pdf-lib');

  const context = PDFContext.create();
  const dict = new Map();
  dict.set(PDFName.of('Filter'), context.obj(info.filters.map((filter) => PDFName.of(filter))));
  if (info.decodeParms) {
    const plain = {};
    for (const [key, value] of Object.entries(info.decodeParms)) plain[key] = PDFNumber.of(value);
    dict.set(PDFName.of('DecodeParms'), context.obj([context.obj(plain)]));
  }
  return decodePDFRawStream(
    PDFRawStream.of(PDFDict.fromMapWithContext(dict, context), data),
  ).decode();
}

/**
 * @param {object} request  what `pdf-compress.js` passes: { data, info, strategy, maxPixels, quality }
 * @param {object} adapter  { createCanvas(w, h), toJpeg(canvas, quality) }
 * @returns {Promise<{data: Uint8Array, width: number, height: number} | null>}
 */
export async function recodeImageWith(request, adapter) {
  const { data, info, strategy, maxPixels, quality } = request;

  let source = null;
  try {
    if (strategy.kind === 'blob') {
      source = await createImageBitmap(new Blob([data], { type: strategy.mime }));
    } else {
      const samples = await inflateSamples(data, info);
      if (!samples) return null;
      const rgba = samplesToRgba(samples, info.width, info.height, strategy.components);
      if (!rgba) return null;
      source = await createImageBitmap(new ImageData(rgba, info.width, info.height));
    }
  } catch {
    // A decode that fails is a skipped image, never a failed compression. Plenty of PDFs carry
    // an image some encoder produced that no decoder is happy with.
    return null;
  }

  try {
    // Trust the decoded bitmap over the dictionary: if they disagree, the dictionary is the
    // one that would put a stretched picture on the page.
    const { width, height } = targetSize(source.width, source.height, maxPixels);
    const canvas = adapter.createCanvas(width, height);
    const context = canvas.getContext('2d');
    // JPEG has no transparency. Anything the soft mask would have hidden must sit on white,
    // not on the black a fresh canvas would otherwise leave behind it.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);

    const bytes = await adapter.toJpeg(canvas, quality);
    return bytes ? { data: bytes, width, height } : null;
  } catch {
    return null;
  } finally {
    source.close?.();
  }
}
