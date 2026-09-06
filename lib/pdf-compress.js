/**
 * Make a PDF smaller.
 *
 * Almost all of it happens in one place: the images. In any document worth compressing, one
 * scanned page outweighs the entire object graph, so this re-encodes the large images and
 * otherwise leaves the file alone. Rewriting text, subsetting fonts or discarding structure
 * would risk the document for savings that round to nothing.
 *
 * Two rules it will not break:
 *
 *   - **Never return a larger file.** Re-encoding an already-optimised image usually makes it
 *     bigger, and a "Compress" button that quietly inflates a document is worse than one that
 *     does nothing. If the result is not smaller, the original comes back untouched and the
 *     caller is told so.
 *   - **Skip what it cannot read safely.** Fax, JBIG2, JPEG 2000, indexed and CMYK images are
 *     left exactly as they were rather than guessed at. Half of them are already smaller than
 *     any re-encoding would manage.
 *
 * DOM-free: decoding and encoding need a canvas, so `recodeImage` is injected exactly as
 * `mergeDocuments` takes `compressImage`. That keeps the decisions here testable in Node.
 */

import {
  UnreadablePdf,
  pdfVersion,
  readTrailer,
  rewriteObjects,
  scanObjects,
  serialise,
  textOf,
  toHexString,
} from './pdf-rewrite.js';
import { PdfString, Ref } from './pdf-lexer.js';
import {
  decodeStrategy,
  describeImage,
  dictOf,
  isImageXObject,
  jpegImageDict,
  levelOf,
  shouldRecode,
} from './pdf-images.js';
import { streamLength } from './pdf-rewrite.js';

export { UnreadablePdf };

/** The document is protected, so its streams cannot be read until it is unlocked. */
export class ProtectedPdf extends Error {
  constructor() {
    super('This PDF is protected. Unlock it first, then compress it.');
    this.name = 'ProtectedPdf';
  }
}

/**
 * Where the bytes actually are.
 *
 * Shown before anything is changed, because it is the honest answer to "how much smaller can
 * this get": a document that is 5% images has almost nothing to give, and saying so up front
 * is better than a progress bar that ends in a 2% saving.
 */
export function analysePdf(bytes) {
  const objects = scanObjects(bytes);
  if (objects.size === 0) throw new UnreadablePdf('no objects found');

  let imageBytes = 0;
  let imageCount = 0;
  let recodableBytes = 0;
  let otherStreamBytes = 0;

  for (const entry of objects.values()) {
    const dict = dictOf(bytes, entry.bodyStart);
    if (!dict) continue;
    const info = streamInfo(bytes, objects, entry, dict);
    if (!info) continue;

    if (isImageXObject(dict)) {
      const image = describeImage(dict);
      imageBytes += info.length;
      imageCount++;
      if (decodeStrategy(image)) recodableBytes += info.length;
    } else {
      otherStreamBytes += info.length;
    }
  }

  return {
    total: bytes.length,
    imageCount,
    imageBytes,
    // How much of the file this tool could actually work on, which is the number that predicts
    // the outcome — not the image total, which includes formats it will not touch.
    recodableBytes,
    otherStreamBytes,
    structureBytes: Math.max(0, bytes.length - imageBytes - otherStreamBytes),
  };
}

function streamInfo(bytes, objects, entry, dict) {
  // Find the stream keyword without re-scanning strings: an image dictionary has none worth
  // reading, and this runs over every object in the file.
  const at = findStream(bytes, entry.bodyStart, entry.bodyEnd);
  if (at === -1) return null;
  const length = streamLength(dict, bytes, objects, at, entry.bodyEnd);
  return length === null ? null : { start: at, length };
}

function findStream(bytes, from, to) {
  for (let i = from; i < to - 6; i++) {
    if (
      bytes[i] === 0x73 && bytes[i + 1] === 0x74 && bytes[i + 2] === 0x72 &&
      bytes[i + 3] === 0x65 && bytes[i + 4] === 0x61 && bytes[i + 5] === 0x6d
    ) {
      let at = i + 6;
      if (bytes[at] === 0x0d && bytes[at + 1] === 0x0a) at += 2;
      else if (bytes[at] === 0x0a) at += 1;
      return at;
    }
  }
  return -1;
}

/**
 * Re-encode the images in `bytes`.
 *
 * `recodeImage({ data, info, strategy, maxPixels, quality })` returns
 * `{ data, width, height }` or null when it could not manage it — a decode that fails is a
 * skipped image, never a failed compression.
 */
export async function compressPdf(bytes, {
  recodeImage,
  level = 'balanced',
  compact = true,
  onProgress,
  signal,
} = {}) {
  const settings = levelOf(level);
  const objects = scanObjects(bytes);
  if (objects.size === 0) throw new UnreadablePdf('no objects found');

  const trailer = readTrailer(bytes, objects);
  if (trailer.encrypt) throw new ProtectedPdf();

  let recoded = 0;
  let skipped = 0;
  let imageBytesBefore = 0;
  let imageBytesAfter = 0;
  let seen = 0;

  const written = await rewriteObjects(bytes, objects, {
    skip: (entry, type) => type === 'XRef',
    transformString: (data) => data,
    transformStream: (data) => data,
    replaceStreamObject: async (entry, dict, type, data) => {
      if (signal?.aborted) throw new CompressCancelled();
      if (!isImageXObject(dict)) return null;

      seen++;
      const info = { ...describeImage(dict), byteLength: data.length };
      const strategy = decodeStrategy(info);
      if (!strategy || !shouldRecode(info, settings)) {
        skipped++;
        return null;
      }

      onProgress?.(`Recompressing image ${seen}`);
      const result = await recodeImage({
        data,
        info,
        strategy,
        maxPixels: settings.maxPixels,
        quality: settings.quality,
      });

      // A result that is not smaller is not an improvement. Keeping the original is both
      // smaller and higher quality, so there is never a reason to take it.
      if (!result || result.data.length >= data.length) {
        skipped++;
        return null;
      }

      recoded++;
      imageBytesBefore += data.length;
      imageBytesAfter += result.data.length;
      return {
        dict: jpegImageDict(dict, {
          width: result.width,
          height: result.height,
          byteLength: result.data.length,
        }),
        data: result.data,
      };
    },
  });

  if (written.length === 0) throw new UnreadablePdf('nothing to write');

  let trailerParts = '';
  if (trailer.root instanceof Ref) trailerParts += ` /Root ${trailer.root.num} 0 R`;
  if (trailer.info instanceof Ref) trailerParts += ` /Info ${trailer.info.num} 0 R`;
  if (Array.isArray(trailer.id) && trailer.id.every((part) => part instanceof PdfString)) {
    trailerParts += ` /ID [${trailer.id.map((part) => textOf(toHexString(part.bytes))).join(' ')}]`;
  }
  if (!trailerParts.includes('/Root')) throw new UnreadablePdf('no document catalogue');

  let out = serialise(pdfVersion(bytes), written, trailerParts);

  // The pass above writes every object at the top level with a plain cross-reference table,
  // which is easy to be sure is correct but larger than the object streams most producers
  // use. Handing the result to pdf-lib puts that structure back.
  if (compact) {
    onProgress?.('Tidying up...');
    out = (await compactWithPdfLib(out)) ?? out;
  }

  const smaller = out.length < bytes.length;
  return {
    // Never hand back something bigger than what was given.
    bytes: smaller ? out : bytes,
    before: bytes.length,
    after: smaller ? out.length : bytes.length,
    changed: smaller,
    recoded,
    skipped,
    imageBytesBefore,
    imageBytesAfter,
  };
}

/** Raised when the caller cancelled. Named to match the merge one so the UI treats it alike. */
export class CompressCancelled extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'MergeCancelled';
  }
}

async function compactWithPdfLib(bytes) {
  try {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
    return await doc.save({ useObjectStreams: true });
  } catch (err) {
    // Compacting is a bonus, not the feature. A document pdf-lib will not reload is still
    // perfectly good with its plain cross-reference table.
    console.warn('Could not compact the output; keeping the plain structure.', err);
    return null;
  }
}
