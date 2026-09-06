/**
 * The shared machinery for rewriting a PDF at the byte level.
 *
 * Both directions of PDF security need the same awkward work — find every object, find the
 * strings and stream data inside it, replace only those, and write the result out with a fresh
 * cross-reference table. `pdf-decrypt.js` and `pdf-encrypt.js` are thin policy layers over
 * this: one supplies "decrypt these bytes", the other "encrypt these bytes".
 *
 * **Everything not explicitly rewritten is copied through byte for byte.** That is the design
 * rule. These functions run on documents the user cannot easily inspect afterwards, so the
 * less they touch, the fewer ways they can quietly change something nobody asked them to.
 * Parsing to a tree and serialising it back would rewrite the whole file to change a few
 * hundred bytes.
 *
 * Pure and DOM-free apart from a lazy `import('pdf-lib')` used only to inflate object streams.
 */

import { Lexer, Name, PdfString, Ref, indexOfKeyword, scanObjects } from './pdf-lexer.js';

/** The file could not be read as a PDF at all. */
export class UnreadablePdf extends Error {
  constructor(detail) {
    super(`This file could not be read as a PDF (${detail}).`);
    this.name = 'UnreadablePdf';
  }
}

export const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
export const textOf = (b) => String.fromCharCode(...b);

export function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export const nameOf = (value) => (value instanceof Name ? value.value : null);

export function resolve(value, bytes, objects) {
  if (!(value instanceof Ref)) return value;
  const entry = objects.get(value.num);
  if (!entry) return null;
  return new Lexer(bytes, entry.bodyStart).readObject();
}

export function readObjectDict(bytes, entry) {
  const lexer = new Lexer(bytes, entry.bodyStart);
  lexer.skipSpace();
  if (bytes[lexer.pos] !== 0x3c || bytes[lexer.pos + 1] !== 0x3c) return null;
  return lexer.readDict();
}

/**
 * Everything the trailer holds that matters here: /Root, /Info, /ID and /Encrypt.
 *
 * Gathered from both shapes a trailer takes — the `trailer << >>` keyword of a classic
 * cross-reference table, and the dictionary of a `/Type /XRef` stream — because a file can
 * contain either, and an incrementally-updated one contains several. Later dictionaries win,
 * which is what an incremental update means.
 */
export function readTrailer(bytes, objects) {
  const found = { root: null, info: null, id: null, encrypt: null };

  const apply = (dict) => {
    if (!(dict instanceof Map)) return;
    if (dict.has('Root')) found.root = dict.get('Root');
    if (dict.has('Info')) found.info = dict.get('Info');
    if (dict.has('ID')) found.id = dict.get('ID');
    if (dict.has('Encrypt')) found.encrypt = dict.get('Encrypt');
  };

  let at = 0;
  for (;;) {
    at = indexOfKeyword(bytes, 'trailer', at);
    if (at === -1) break;
    const lexer = new Lexer(bytes, at + 7);
    lexer.skipSpace();
    if (bytes[lexer.pos] === 0x3c && bytes[lexer.pos + 1] === 0x3c) apply(lexer.readDict());
    at += 7;
  }

  for (const entry of [...objects.values()].sort((a, b) => a.start - b.start)) {
    const dict = readObjectDict(bytes, entry);
    if (dict instanceof Map && nameOf(dict.get('Type')) === 'XRef') apply(dict);
  }

  return found;
}

/**
 * Find every string token and the stream data inside one object.
 *
 * Deliberately a flat scan rather than a parse: it needs byte ranges, and a parse tree is
 * exactly what loses them. Strings are only looked for before the `stream` keyword, because
 * everything after it is data.
 */
export function scanObjectBody(bytes, start, end) {
  const strings = [];
  let streamStart = -1;
  let dictEnd = end;
  let i = start;

  while (i < end) {
    const byte = bytes[i];

    if (byte === 0x25) {
      while (i < end && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
      continue;
    }

    if (byte === 0x28) {
      const from = i;
      const lexer = new Lexer(bytes, i);
      lexer.readLiteralString();
      i = Math.min(lexer.pos, end);
      strings.push({ start: from, end: i });
      continue;
    }

    if (byte === 0x3c) {
      if (bytes[i + 1] === 0x3c) {
        i += 2;
        continue;
      }
      const from = i;
      const lexer = new Lexer(bytes, i);
      lexer.readHexString();
      i = Math.min(lexer.pos, end);
      strings.push({ start: from, end: i });
      continue;
    }

    // `stream` must sit on a token boundary, so a key called /streamData is not mistaken for it.
    if (
      byte === 0x73 &&
      bytes[i + 1] === 0x74 && bytes[i + 2] === 0x72 && bytes[i + 3] === 0x65 &&
      bytes[i + 4] === 0x61 && bytes[i + 5] === 0x6d &&
      (i === start || !isRegularByte(bytes[i - 1]))
    ) {
      dictEnd = i;
      let at = i + 6;
      // The data begins after CRLF or LF — never after a bare CR.
      if (bytes[at] === 0x0d && bytes[at + 1] === 0x0a) at += 2;
      else if (bytes[at] === 0x0a) at += 1;
      streamStart = at;
      break;
    }

    i++;
  }

  return { strings, streamStart, dictEnd };
}

function isRegularByte(byte) {
  return !(
    byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09 || byte === 0x0c || byte === 0x00 ||
    byte === 0x28 || byte === 0x29 || byte === 0x3c || byte === 0x3e || byte === 0x5b ||
    byte === 0x5d || byte === 0x7b || byte === 0x7d || byte === 0x2f || byte === 0x25
  );
}

const HEX_DIGITS = '0123456789ABCDEF';
/** Write a string as hex. Always valid, and it removes every chance of an escaping mistake. */
export function toHexString(data) {
  const out = new Uint8Array(data.length * 2 + 2);
  out[0] = 0x3c;
  for (let i = 0; i < data.length; i++) {
    out[i * 2 + 1] = HEX_DIGITS.charCodeAt(data[i] >> 4);
    out[i * 2 + 2] = HEX_DIGITS.charCodeAt(data[i] & 0x0f);
  }
  out[out.length - 1] = 0x3e;
  return out;
}

/** How long a stream is, following /Length through an indirect reference if it is one. */
export function streamLength(dict, bytes, objects, streamStart, bodyEnd) {
  const length = dict ? resolve(dict.get('Length'), bytes, objects) : null;
  if (typeof length === 'number' && length >= 0 && streamStart + length <= bytes.length) {
    // Trust /Length only if `endstream` really is where it says the data ends. A wrong /Length
    // is common enough in the wild that taking it on faith corrupts real files.
    const after = new Lexer(bytes, streamStart + length);
    after.skipSpace();
    if (indexOfKeyword(bytes, 'endstream', after.pos, after.pos + 9) === after.pos) return length;
  }
  const endstream = indexOfKeyword(bytes, 'endstream', streamStart, bodyEnd);
  if (endstream === -1) return null;
  let end = endstream;
  // Back off the EOL that precedes `endstream`, which is not part of the data.
  if (bytes[end - 1] === 0x0a) end--;
  if (bytes[end - 1] === 0x0d) end--;
  return end - streamStart;
}

/** Replace the /Length value in an object's dictionary. */
export function rewriteLength(body, length) {
  const at = indexOfKeyword(body, '/Length', 0);
  if (at === -1) return body;
  const lexer = new Lexer(body, at + 7);
  lexer.skipSpace();
  const valueStart = lexer.pos;
  lexer.readObject();
  const valueEnd = lexer.pos;
  return concat([body.subarray(0, valueStart), ascii(String(length)), body.subarray(valueEnd)]);
}

/**
 * Inflate a stream using pdf-lib's decoder.
 *
 * Only ever called on `/ObjStm` data. Borrowing pdf-lib's decoder rather than writing another
 * one is a deliberate saving: it already handles Flate, LZW and the PNG predictors, and it is
 * a dependency this app ships regardless.
 */
async function inflate(dictMap, data) {
  const { PDFContext, PDFRawStream, PDFDict, PDFName, PDFNumber, decodePDFRawStream } =
    await import('pdf-lib');

  const filter = dictMap.get('Filter');
  const filters = Array.isArray(filter) ? filter : filter ? [filter] : [];
  if (filters.length === 0) return data;

  const context = PDFContext.create();
  const dict = new Map();
  dict.set(PDFName.of('Filter'), context.obj(filters.map((f) => PDFName.of(String(f)))));

  const parms = dictMap.get('DecodeParms') ?? dictMap.get('DP');
  const parmList = Array.isArray(parms) ? parms : parms ? [parms] : [];
  if (parmList.length > 0) {
    dict.set(
      PDFName.of('DecodeParms'),
      context.obj(
        parmList.map((entry) => {
          if (!(entry instanceof Map)) return context.obj({});
          const plain = {};
          for (const [key, value] of entry) {
            if (typeof value === 'number') plain[key] = PDFNumber.of(value);
          }
          return context.obj(plain);
        }),
      ),
    );
  }

  return decodePDFRawStream(PDFRawStream.of(PDFDict.fromMapWithContext(dict, context), data)).decode();
}

/**
 * Split an object stream into the objects it holds.
 *
 * Their strings are not separately encrypted: the specification encrypts the object stream as
 * a whole. So once the stream itself is in the clear the members can be lifted out as raw
 * bytes and written straight back as ordinary indirect objects.
 *
 * Expanding rather than preserving them costs a little size — object streams compress the
 * document structure — but it means the output can use a plain cross-reference table, which
 * every reader understands and which is far easier to be sure is correct.
 */
export async function expandObjectStream(dict, data, bytes, objects) {
  const count = Number(resolve(dict.get('N'), bytes, objects) ?? 0);
  const first = Number(resolve(dict.get('First'), bytes, objects) ?? 0);
  if (!Number.isInteger(count) || count <= 0) return [];

  const plain = await inflate(dict, data);
  const header = new Lexer(plain, 0);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const num = header.readObject();
    const offset = header.readObject();
    if (typeof num !== 'number' || typeof offset !== 'number') return [];
    entries.push({ num, offset });
  }

  const members = [];
  for (let i = 0; i < entries.length; i++) {
    const start = first + entries[i].offset;
    const end = i + 1 < entries.length ? first + entries[i + 1].offset : plain.length;
    if (start >= plain.length || end > plain.length || end <= start) continue;
    members.push({ num: entries[i].num, body: plain.subarray(start, end) });
  }
  return members;
}

export function pdfVersion(bytes) {
  const match = textOf(bytes.subarray(0, 16)).match(/%PDF-(\d\.\d)/);
  return match ? match[1] : '1.7';
}

const pad10 = (n) => String(n).padStart(10, '0');

/** Write the objects out with a fresh classic cross-reference table. */
export function serialise(version, entries, trailerParts) {
  const chunks = [];
  let offset = 0;
  const push = (data) => {
    chunks.push(data);
    offset += data.length;
  };

  push(ascii(`%PDF-${version}\n`));
  // A comment of high bytes, so tools that sniff for binary content treat the file correctly.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const sorted = [...entries].sort((a, b) => a.num - b.num);
  const maxNum = sorted.reduce((max, entry) => Math.max(max, entry.num), 0);
  const offsets = new Array(maxNum + 1).fill(null);

  for (const entry of sorted) {
    offsets[entry.num] = offset;
    push(ascii(`${entry.num} 0 obj\n`));
    push(entry.body);
    push(ascii('\nendobj\n'));
  }

  const xrefOffset = offset;
  const lines = [`xref\n0 ${maxNum + 1}\n`, '0000000000 65535 f \n'];
  for (let num = 1; num <= maxNum; num++) {
    lines.push(offsets[num] === null ? '0000000000 65535 f \n' : `${pad10(offsets[num])} 00000 n \n`);
  }
  push(ascii(lines.join('')));
  push(ascii(`trailer\n<< /Size ${maxNum + 1}${trailerParts} >>\nstartxref\n${xrefOffset}\n%%EOF\n`));

  return concat(chunks);
}

/**
 * Rewrite the strings inside one object body, leaving everything else byte for byte.
 *
 * Split out because it is needed twice: for objects that sit directly in the file, and for
 * objects lifted out of an object stream when protecting a document.
 */
function rewriteStrings(bytes, start, end, transformString, num, gen) {
  const { strings, streamStart, dictEnd } = scanObjectBody(bytes, start, end);
  const pieces = [];
  let cursor = start;
  for (const range of strings) {
    pieces.push(bytes.subarray(cursor, range.start));
    const raw = new Lexer(bytes, range.start).readObject();
    const replacement = raw instanceof PdfString ? transformString(raw.bytes, num, gen) : null;
    pieces.push(toHexString(replacement ?? new Uint8Array(0)));
    cursor = range.end;
  }
  pieces.push(bytes.subarray(cursor, streamStart === -1 ? end : dictEnd));
  return { head: concat(pieces), streamStart, dictEnd };
}

/**
 * Walk every object in `bytes`, rewriting its strings and stream data.
 *
 * `transformString(data, num, gen)` and `transformStream(data, num, gen, type)` return the
 * replacement bytes, or null to leave the value empty.
 *
 * `replaceStreamObject(entry, dict, type, data)` is the escape hatch for the one case where
 * rewriting the data is not enough: re-encoding an image changes its dimensions, filter and
 * colour space, so the dictionary has to be rebuilt too. Returning `{ dict, data }` replaces
 * the whole object; returning null leaves it to the ordinary path. It may be async.
 *
 * `objectStreamOrder` is the one place the two directions genuinely differ:
 *
 *   - `'transform-then-expand'` (decrypting) — the object stream is ciphertext. Decrypt it,
 *     then lift out the members, whose own strings are already plaintext: the specification
 *     encrypts the stream as a whole and does not encrypt what is inside it a second time.
 *   - `'expand-then-transform'` (protecting) — the object stream is plaintext. Lift the members
 *     out first, then encrypt each one as an ordinary object, because once they are top-level
 *     objects their strings are no longer covered by anything.
 *
 * Getting that order backwards means inflating ciphertext, which fails loudly. It is written
 * down here because it failed exactly once, quietly enough to look like a decoder bug.
 *
 * Returns the entries ready for `serialise`.
 */
export async function rewriteObjects(bytes, objects, {
  transformString,
  transformStream,
  skip,
  replaceStreamObject = null,
  objectStreamOrder = 'transform-then-expand',
}) {
  const written = [];
  const objectStreams = [];

  for (const entry of objects.values()) {
    const dict = readObjectDict(bytes, entry);
    const type = dict instanceof Map ? nameOf(dict.get('Type')) : null;
    if (skip?.(entry, type, dict)) continue;

    const { head, streamStart, dictEnd } = rewriteStrings(
      bytes,
      entry.bodyStart,
      entry.bodyEnd,
      transformString,
      entry.num,
      entry.gen,
    );
    void dictEnd;

    if (streamStart === -1) {
      written.push({ num: entry.num, body: head });
      continue;
    }

    const length = streamLength(dict, bytes, objects, streamStart, entry.bodyEnd);
    if (length === null) throw new UnreadablePdf(`object ${entry.num} has an unreadable stream`);
    const raw = bytes.subarray(streamStart, streamStart + length);

    if (replaceStreamObject) {
      const replacement = await replaceStreamObject(entry, dict, type, raw);
      if (replacement) {
        written.push({
          num: entry.num,
          body: concat([
            ascii(replacement.dict),
            ascii('\nstream\n'),
            replacement.data,
            ascii('\nendstream'),
          ]),
        });
        continue;
      }
    }

    if (type === 'ObjStm') {
      objectStreams.push({
        dict,
        entry,
        data: objectStreamOrder === 'transform-then-expand'
          ? transformStream(raw, entry.num, entry.gen, type) ?? new Uint8Array(0)
          : raw,
      });
      continue;
    }

    const data = transformStream(raw, entry.num, entry.gen, type) ?? new Uint8Array(0);
    written.push({
      num: entry.num,
      // /Length has to match the rewritten size: AES shortens on decrypt and lengthens on
      // encrypt, and a stale /Length is a corrupt file that still looks plausible.
      body: rewriteLength(concat([head, ascii('\nstream\n'), data, ascii('\nendstream')]), data.length),
    });
  }

  // Members of an object stream become ordinary top-level objects. Done after the main loop so
  // a member never displaces an object of the same number that was written directly.
  const seen = new Set(written.map((entry) => entry.num));
  for (const { dict, data } of objectStreams) {
    for (const member of await expandObjectStream(dict, data, bytes, objects)) {
      if (seen.has(member.num)) continue;
      seen.add(member.num);
      const body =
        objectStreamOrder === 'expand-then-transform'
          ? rewriteStrings(member.body, 0, member.body.length, transformString, member.num, 0).head
          : new Uint8Array(member.body);
      written.push({ num: member.num, body });
    }
  }

  return written;
}

export { scanObjects, Lexer, PdfString, Ref, Name };
