/**
 * A small, targeted reader for PDF syntax.
 *
 * This is not a PDF parser and must not become one. It exists so `pdf-decrypt.js` can do three
 * things and nothing else:
 *
 *   1. find every `N G obj ... endobj` in a file,
 *   2. read a dictionary well enough to answer questions like "what is /Length" or "what does
 *      /Encrypt say",
 *   3. locate every string token and the stream data inside an object, as byte ranges.
 *
 * (3) is the important one. Decryption then rewrites those ranges *in place* and copies
 * everything else through untouched, so anything this reader does not understand — odd
 * whitespace, comments, keys nobody has heard of — survives byte for byte. Round-tripping a
 * document through a parse tree would risk changing things nobody asked to change, in a file
 * the user cannot easily check.
 *
 * Pure and DOM-free.
 */

const DIGIT_0 = 0x30;
const DIGIT_9 = 0x39;

export function isWhitespace(byte) {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09 || byte === 0x0c || byte === 0x00;
}

export function isDelimiter(byte) {
  return (
    byte === 0x28 || byte === 0x29 || byte === 0x3c || byte === 0x3e || byte === 0x5b ||
    byte === 0x5d || byte === 0x7b || byte === 0x7d || byte === 0x2f || byte === 0x25
  );
}

const isRegular = (byte) => !isWhitespace(byte) && !isDelimiter(byte);
const isDigit = (byte) => byte >= DIGIT_0 && byte <= DIGIT_9;

/** A reference to another object: `12 0 R`. */
export class Ref {
  constructor(num, gen) {
    this.num = num;
    this.gen = gen;
  }
}

/** A PDF string, kept as raw bytes plus how it was written, so it can be rewritten in place. */
export class PdfString {
  constructor(bytes, hex) {
    this.bytes = bytes;
    this.hex = hex;
  }
}

/** A name such as `/Type`. Stored without the slash. */
export class Name {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const HEX = '0123456789abcdefABCDEF';
const hexValue = (byte) => {
  const c = String.fromCharCode(byte);
  const i = HEX.indexOf(c);
  return i < 0 ? -1 : i < 16 ? i : i - 6;
};

/**
 * A cursor over the file's bytes.
 *
 * `pos` is public and callers move it; every `read*` leaves it just past what it consumed.
 */
export class Lexer {
  constructor(bytes, pos = 0) {
    this.bytes = bytes;
    this.pos = pos;
  }

  get length() {
    return this.bytes.length;
  }

  /** Move past whitespace and comments. */
  skipSpace() {
    const { bytes } = this;
    while (this.pos < bytes.length) {
      const byte = bytes[this.pos];
      if (isWhitespace(byte)) {
        this.pos++;
      } else if (byte === 0x25) {
        // A comment runs to the end of the line.
        while (this.pos < bytes.length && bytes[this.pos] !== 0x0a && bytes[this.pos] !== 0x0d) {
          this.pos++;
        }
      } else {
        return;
      }
    }
  }

  /** The next run of regular characters, as a string. Does not skip whitespace first. */
  readToken() {
    const start = this.pos;
    while (this.pos < this.bytes.length && isRegular(this.bytes[this.pos])) this.pos++;
    return String.fromCharCode(...this.bytes.subarray(start, this.pos));
  }

  readName() {
    this.pos++; // the slash
    const start = this.pos;
    const out = [];
    while (this.pos < this.bytes.length && isRegular(this.bytes[this.pos])) {
      let byte = this.bytes[this.pos];
      // #-escapes: /A#20B is "A B".
      if (byte === 0x23 && this.pos + 2 < this.bytes.length) {
        const hi = hexValue(this.bytes[this.pos + 1]);
        const lo = hexValue(this.bytes[this.pos + 2]);
        if (hi >= 0 && lo >= 0) {
          byte = hi * 16 + lo;
          this.pos += 2;
        }
      }
      out.push(byte);
      this.pos++;
    }
    if (out.length === 0 && this.pos === start) return new Name('');
    return new Name(String.fromCharCode(...out));
  }

  /** A `(...)` string. Leaves `pos` just past the closing paren. */
  readLiteralString() {
    const { bytes } = this;
    this.pos++; // the open paren
    const out = [];
    let depth = 1;

    while (this.pos < bytes.length) {
      let byte = bytes[this.pos++];

      if (byte === 0x5c) {
        // Backslash escape.
        if (this.pos >= bytes.length) break;
        const next = bytes[this.pos++];
        switch (next) {
          case 0x6e: out.push(0x0a); break; // \n
          case 0x72: out.push(0x0d); break; // \r
          case 0x74: out.push(0x09); break; // \t
          case 0x62: out.push(0x08); break; // \b
          case 0x66: out.push(0x0c); break; // \f
          case 0x28: out.push(0x28); break; // \(
          case 0x29: out.push(0x29); break; // \)
          case 0x5c: out.push(0x5c); break; // backslash
          case 0x0d:
            // Line continuation; a CRLF counts as one.
            if (bytes[this.pos] === 0x0a) this.pos++;
            break;
          case 0x0a:
            break;
          default:
            if (next >= 0x30 && next <= 0x37) {
              // Up to three octal digits.
              let value = next - 0x30;
              for (let i = 0; i < 2; i++) {
                const digit = bytes[this.pos];
                if (digit >= 0x30 && digit <= 0x37) {
                  value = value * 8 + (digit - 0x30);
                  this.pos++;
                } else break;
              }
              out.push(value & 0xff);
            } else {
              // A backslash before anything else is ignored, and the character stands.
              out.push(next);
            }
        }
        continue;
      }

      if (byte === 0x28) {
        depth++;
      } else if (byte === 0x29) {
        depth--;
        if (depth === 0) break;
      }
      out.push(byte);
    }

    return new PdfString(Uint8Array.from(out), false);
  }

  /** A `<...>` string. Assumes the caller has checked this is not `<<`. */
  readHexString() {
    const { bytes } = this;
    this.pos++; // the open angle
    const out = [];
    let high = -1;

    while (this.pos < bytes.length) {
      const byte = bytes[this.pos++];
      if (byte === 0x3e) break;
      const value = hexValue(byte);
      if (value < 0) continue; // whitespace and anything else is ignored
      if (high < 0) {
        high = value;
      } else {
        out.push(high * 16 + value);
        high = -1;
      }
    }
    // An odd number of digits means the last one is padded with a trailing zero.
    if (high >= 0) out.push(high * 16);

    return new PdfString(Uint8Array.from(out), true);
  }

  /**
   * Read one object.
   *
   * Understands numbers, names, strings, arrays, dictionaries, booleans, null and indirect
   * references. Stops at `stream` rather than consuming the data — the caller decides what to
   * do with that, because it needs the byte range, not the bytes.
   */
  readObject() {
    this.skipSpace();
    if (this.pos >= this.bytes.length) return null;

    const byte = this.bytes[this.pos];

    if (byte === 0x2f) return this.readName();
    if (byte === 0x28) return this.readLiteralString();

    if (byte === 0x3c) {
      if (this.bytes[this.pos + 1] === 0x3c) return this.readDict();
      return this.readHexString();
    }

    if (byte === 0x5b) {
      this.pos++;
      const array = [];
      for (;;) {
        this.skipSpace();
        if (this.pos >= this.bytes.length) break;
        if (this.bytes[this.pos] === 0x5d) {
          this.pos++;
          break;
        }
        const value = this.readObject();
        if (value === undefined) break;
        array.push(value);
      }
      return array;
    }

    if (byte === 0x5d || byte === 0x3e || byte === 0x29) {
      // A closing delimiter with nothing to close — malformed, but stepping over it keeps the
      // scan going rather than looping forever.
      this.pos++;
      return undefined;
    }

    if (isDigit(byte) || byte === 0x2b || byte === 0x2d || byte === 0x2e) {
      return this.readNumberOrRef();
    }

    const token = this.readToken();
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    if (token === '') {
      this.pos++; // never stall
      return undefined;
    }
    return new Name(token); // a bare keyword; the caller decides whether it matters
  }

  /** A number, or `N G R` if that is what follows. */
  readNumberOrRef() {
    const start = this.pos;
    const first = Number(this.readToken());

    if (Number.isInteger(first) && first >= 0) {
      const save = this.pos;
      this.skipSpace();
      const genStart = this.pos;
      const second = this.readToken();
      if (/^\d+$/.test(second)) {
        this.skipSpace();
        const third = this.readToken();
        if (third === 'R') return new Ref(first, Number(second));
      }
      this.pos = save;
      void genStart;
    }

    if (Number.isNaN(first)) {
      this.pos = start;
      this.readToken();
      return 0;
    }
    return first;
  }

  readDict() {
    this.pos += 2; // <<
    const dict = new Map();
    for (;;) {
      this.skipSpace();
      if (this.pos >= this.bytes.length) break;
      if (this.bytes[this.pos] === 0x3e && this.bytes[this.pos + 1] === 0x3e) {
        this.pos += 2;
        break;
      }
      if (this.bytes[this.pos] !== 0x2f) {
        // Not a key. Step over whatever it is rather than spinning.
        const before = this.pos;
        this.readObject();
        if (this.pos === before) this.pos++;
        continue;
      }
      const key = this.readName().value;
      const value = this.readObject();
      if (value !== undefined) dict.set(key, value);
    }
    return dict;
  }
}

/**
 * Every `N G obj ... endobj` in the file, by object number.
 *
 * Found by scanning the bytes rather than by following the cross-reference table. That is what
 * pdf.js and pdf-lib do when a file is damaged, and it is the right default here: it needs no
 * xref parsing, it copes with files whose xref is wrong, and the alternative — reading an xref
 * stream — would mean inflating a stream before knowing whether the file is even readable.
 *
 * A later definition of the same object number wins, matching how incremental updates work.
 */
export function scanObjects(bytes) {
  const objects = new Map();
  const limit = bytes.length - 3;

  for (let i = 0; i < limit; i++) {
    // Look for "obj" preceded by two integers.
    if (bytes[i] !== 0x6f || bytes[i + 1] !== 0x62 || bytes[i + 2] !== 0x6a) continue;
    // The character after must not be regular, or this is part of a longer word.
    if (i + 3 < bytes.length && isRegular(bytes[i + 3])) continue;

    let j = i - 1;
    while (j >= 0 && isWhitespace(bytes[j])) j--;
    const genEnd = j + 1;
    while (j >= 0 && isDigit(bytes[j])) j--;
    const genStart = j + 1;
    if (genStart === genEnd) continue;

    while (j >= 0 && isWhitespace(bytes[j])) j--;
    const numEnd = j + 1;
    if (numEnd === genStart) continue;
    while (j >= 0 && isDigit(bytes[j])) j--;
    const numStart = j + 1;
    if (numStart === numEnd) continue;
    // The integer must not be glued to a preceding regular character.
    if (numStart > 0 && isRegular(bytes[numStart - 1])) continue;

    const num = Number(String.fromCharCode(...bytes.subarray(numStart, numEnd)));
    const gen = Number(String.fromCharCode(...bytes.subarray(genStart, genEnd)));
    if (!Number.isInteger(num) || !Number.isInteger(gen)) continue;

    objects.set(num, { num, gen, start: numStart, bodyStart: i + 3 });
    i += 2;
  }

  // Each object body ends at its `endobj`, or at the start of the next object if that keyword
  // is missing — which happens in the wild more often than it should.
  const sorted = [...objects.values()].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const nextStart = i + 1 < sorted.length ? sorted[i + 1].start : bytes.length;
    const endObj = indexOfKeyword(bytes, 'endobj', entry.bodyStart, nextStart);
    entry.bodyEnd = endObj === -1 ? nextStart : endObj;
  }

  return objects;
}

const KEYWORD_CACHE = new Map();
function keywordBytes(word) {
  let cached = KEYWORD_CACHE.get(word);
  if (!cached) {
    cached = Uint8Array.from(word, (c) => c.charCodeAt(0));
    KEYWORD_CACHE.set(word, cached);
  }
  return cached;
}

/** Find `word` in `bytes` between `from` and `to`, or -1. */
export function indexOfKeyword(bytes, word, from = 0, to = bytes.length) {
  const needle = keywordBytes(word);
  const limit = Math.min(to, bytes.length) - needle.length;
  outer: for (let i = Math.max(0, from); i <= limit; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Search backwards, which is how `startxref` and the last `trailer` are found. */
export function lastIndexOfKeyword(bytes, word, from = bytes.length) {
  const needle = keywordBytes(word);
  outer: for (let i = Math.min(from, bytes.length - needle.length); i >= 0; i--) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
