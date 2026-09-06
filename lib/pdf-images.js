/**
 * Finding the images inside a PDF, and describing them again after they have been re-encoded.
 *
 * In any PDF worth compressing, almost all the bytes are images. Everything else — content
 * streams, fonts, the object graph — is usually a rounding error next to one scanned page, so
 * this is where compression happens and the rest is not worth risking a document for.
 *
 * Pure and DOM-free. The actual decoding and encoding needs a canvas and is injected, exactly
 * as `mergeDocuments` takes `compressImage`, so the decisions below can be tested in Node.
 */

import { Lexer, Name, PdfString, Ref } from './pdf-lexer.js';

const nameOf = (value) => (value instanceof Name ? value.value : null);

/** The filters, in order. A stream can carry a chain such as `[/FlateDecode /DCTDecode]`. */
export function filterChain(dict) {
  const filter = dict?.get('Filter');
  const list = Array.isArray(filter) ? filter : filter ? [filter] : [];
  return list.map((entry) => nameOf(entry)).filter(Boolean);
}

/** Is this object an image XObject we could work on at all? */
export function isImageXObject(dict) {
  if (!(dict instanceof Map)) return false;
  if (nameOf(dict.get('Subtype')) !== 'Image') return false;
  // A stencil mask is one bit per pixel and paints a colour through a shape. Re-encoding one
  // as a photograph would be both larger and wrong.
  if (dict.get('ImageMask') === true) return false;
  return true;
}

/**
 * What the image is, in the terms the decision below needs.
 *
 * `colourSpace` is only the name when it is a plain device space; anything indirect, indexed or
 * ICC-based comes back null, because those cannot be read as plain samples without following
 * references this module deliberately does not follow.
 */
export function describeImage(dict) {
  return {
    width: Number(dict.get('Width') ?? 0),
    height: Number(dict.get('Height') ?? 0),
    bitsPerComponent: Number(dict.get('BitsPerComponent') ?? 8),
    colourSpace: nameOf(dict.get('ColorSpace')),
    filters: filterChain(dict),
    hasSoftMask: dict.has('SMask'),
    decodeParms: decodeParmsOf(dict),
  };
}

/**
 * The numeric decode parameters, flattened.
 *
 * Only the numbers matter, and only for the flate path: a predictor changes how inflated bytes
 * are laid out, and ignoring it would turn a photograph into diagonal noise. Anything indirect
 * is dropped, which leaves the defaults — the same thing a reader assumes when the entry is
 * absent.
 */
function decodeParmsOf(dict) {
  const raw = dict.get('DecodeParms') ?? dict.get('DP');
  const entry = Array.isArray(raw) ? raw.find((item) => item instanceof Map) : raw;
  if (!(entry instanceof Map)) return null;
  const out = {};
  for (const [key, value] of entry) {
    if (typeof value === 'number') out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// Formats whose bytes a browser can decode directly, because they are ordinary image files.
const BROWSER_DECODABLE = { DCTDecode: 'image/jpeg', JPXDecode: 'image/jp2' };

/**
 * How, if at all, this image's bytes can be turned into pixels.
 *
 * `'blob'`   — the stream is an image file the browser already knows (a JPEG). Hand it over.
 * `'raw'`    — inflated samples we can lay out ourselves: 8 bits per component, grey or RGB.
 * `null`     — anything else. CCITT fax and JBIG2 are bilevel and already smaller than any
 *              re-encoding would make them; JPEG 2000 support is inconsistent; indexed and
 *              separation colour need the palette to be resolved. All are left alone.
 */
export function decodeStrategy(info) {
  const last = info.filters.at(-1);

  if (last && BROWSER_DECODABLE[last]) {
    // A JPEG 2000 stream is only worth attempting where the browser actually decodes it, and
    // most do not. Treat it as undecodable rather than producing a blank page.
    if (last === 'JPXDecode') return null;
    // A JPEG wrapped in another filter is not a file the browser can be handed directly, and
    // unwrapping it first buys a rare case at the cost of a decode path that can go wrong.
    if (info.filters.length !== 1) return null;
    return { kind: 'blob', mime: BROWSER_DECODABLE[last] };
  }

  const inflatable = !last || last === 'FlateDecode' || last === 'LZWDecode';
  if (!inflatable) return null;
  if (info.bitsPerComponent !== 8) return null;
  if (info.colourSpace === 'DeviceRGB') return { kind: 'raw', components: 3 };
  if (info.colourSpace === 'DeviceGray') return { kind: 'raw', components: 1 };
  return null;
}

/** Presets, in the terms a person picks between rather than pixels and quality numbers. */
export const COMPRESSION_LEVELS = {
  light: { id: 'light', label: 'Light - barely visible', maxPixels: 2400, quality: 0.85 },
  balanced: { id: 'balanced', label: 'Balanced', maxPixels: 1600, quality: 0.72 },
  strong: { id: 'strong', label: 'Strong - smallest file', maxPixels: 1100, quality: 0.55 },
};
export const DEFAULT_COMPRESSION_LEVEL = 'balanced';

export const levelOf = (id) => COMPRESSION_LEVELS[id] || COMPRESSION_LEVELS.balanced;

/**
 * Is this image worth touching?
 *
 * Small images are left alone: re-encoding a 60-pixel logo saves nothing and risks softening
 * something that was crisp. The threshold is deliberately generous — the savings all come from
 * the handful of large scans, not from the many small decorations.
 */
export function shouldRecode(info, level, { minBytes = 8 * 1024 } = {}) {
  if (info.width < 8 || info.height < 8) return false;
  const longest = Math.max(info.width, info.height);
  // Worth it if it is either physically large, or heavy enough that better encoding may win.
  return longest > level.maxPixels || info.byteLength >= minBytes;
}

// --- Writing the replacement --------------------------------------------------------------

/** Serialise the small subset of PDF values an image dictionary carries. */
export function writeValue(value) {
  if (value instanceof Ref) return `${value.num} ${value.gen} R`;
  if (value instanceof Name) return `/${value.value}`;
  if (value instanceof PdfString) {
    const hex = [...value.bytes].map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    return `<${hex}>`;
  }
  if (Array.isArray(value)) return `[${value.map(writeValue).join(' ')}]`;
  if (value instanceof Map) {
    const parts = [];
    for (const [key, entry] of value) parts.push(`/${key} ${writeValue(entry)}`);
    return `<< ${parts.join(' ')} >>`;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  return 'null';
}

/**
 * Entries carried across from the original image dictionary.
 *
 * Everything else described the *old* encoding — colour space, bit depth, filters, decode
 * arrays — and is replaced. Carrying those over would describe the new JPEG incorrectly, which
 * is a far more likely way to break a document than dropping a key nobody set.
 *
 * `SMask` and `Mask` are the important ones: they hold the transparency, they are separate
 * objects, and a viewer scales them to the image, so they stay correct after downsampling.
 */
const CARRIED = ['SMask', 'Mask', 'OC', 'Metadata', 'StructParent', 'Intent', 'Interpolate', 'Name'];

/** Build the dictionary text for an image that has been re-encoded as a baseline JPEG. */
export function jpegImageDict(originalDict, { width, height, byteLength }) {
  const parts = [
    '/Type /XObject',
    '/Subtype /Image',
    `/Width ${width}`,
    `/Height ${height}`,
    '/ColorSpace /DeviceRGB',
    '/BitsPerComponent 8',
    '/Filter /DCTDecode',
    `/Length ${byteLength}`,
  ];
  for (const key of CARRIED) {
    if (originalDict.has(key)) parts.push(`/${key} ${writeValue(originalDict.get(key))}`);
  }
  return `<< ${parts.join(' ')} >>`;
}

/** Read an object's dictionary out of a body slice. */
export function dictOf(bytes, start) {
  const lexer = new Lexer(bytes, start);
  lexer.skipSpace();
  if (bytes[lexer.pos] !== 0x3c || bytes[lexer.pos + 1] !== 0x3c) return null;
  return lexer.readDict();
}
