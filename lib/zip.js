/**
 * A minimal, dependency-free ZIP writer.
 *
 * Store-only (no deflate) and deliberately so: every payload this app puts in a zip is a PDF
 * or a JPEG, both of which are already compressed. Deflating them again costs CPU on the
 * user's machine and buys back a fraction of a percent. Adding a compression library for that
 * trade would be a poor one, and this app has no room for dependencies it does not need.
 *
 * DOM-free, so it runs under Vitest in Node against the same bytes the browser produces.
 */

// Polynomial-reversed CRC-32 (IEEE 802.3), the variant ZIP requires.
let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c >>> 0;
  }
  return crcTable;
}

export function crc32(bytes) {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ZIP stores timestamps as MS-DOS date/time, which starts at 1980 and has two-second
// resolution. Anything earlier would encode as a negative year, so clamp rather than wrap.
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time =
    (Math.floor(date.getSeconds() / 2) & 0x1f) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getHours() & 0x1f) << 11);
  const day = (date.getDate() & 0x1f) | (((date.getMonth() + 1) & 0x0f) << 5) | ((year - 1980) << 9);
  return { time, date: day };
}

function encodeName(name) {
  // Zip paths are always forward-slashed, and a leading slash or a `..` segment makes an
  // archive that some extractors will happily write outside the target directory.
  const clean = String(name)
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
  return new TextEncoder().encode(clean || 'file');
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
// Bit 11 marks the name as UTF-8. Without it a non-ASCII filename is read as CP437.
const FLAG_UTF8 = 0x800;
const MAX_UINT32 = 0xffffffff;

class ByteWriter {
  constructor() {
    this.chunks = [];
    this.length = 0;
  }

  push(bytes) {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  u16(value) {
    this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value) {
    this.push(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ]),
    );
  }

  concat() {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/**
 * Build a ZIP archive from `[{ name, data }]`, where `data` is a Uint8Array.
 *
 * Returns a Uint8Array. Throws rather than emitting a file no extractor can read: ZIP64 is not
 * implemented, so anything past the 4 GB / 65535-entry limits is refused explicitly.
 */
export function createZip(entries, { now = new Date() } = {}) {
  const list = Array.from(entries || []);
  if (list.length === 0) throw new Error('Cannot create an empty zip.');
  if (list.length > 0xffff) throw new Error('Too many files for a zip archive.');

  const { time, date } = dosDateTime(now);
  const body = new ByteWriter();
  const central = new ByteWriter();

  for (const entry of list) {
    const name = encodeName(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    if (data.length > MAX_UINT32) throw new Error(`"${entry.name}" is too large for a zip archive.`);

    const offset = body.length;
    if (offset > MAX_UINT32) throw new Error('Zip archive is too large.');
    const sum = crc32(data);

    body.u32(LOCAL_SIG);
    body.u16(20); // version needed
    body.u16(FLAG_UTF8);
    body.u16(0); // method: stored
    body.u16(time);
    body.u16(date);
    body.u32(sum);
    body.u32(data.length); // compressed
    body.u32(data.length); // uncompressed
    body.u16(name.length);
    body.u16(0); // extra length
    body.push(name);
    body.push(data);

    central.u32(CENTRAL_SIG);
    central.u16(20); // version made by
    central.u16(20); // version needed
    central.u16(FLAG_UTF8);
    central.u16(0);
    central.u16(time);
    central.u16(date);
    central.u32(sum);
    central.u32(data.length);
    central.u32(data.length);
    central.u16(name.length);
    central.u16(0); // extra
    central.u16(0); // comment
    central.u16(0); // disk number
    central.u16(0); // internal attrs
    central.u32(0); // external attrs
    central.u32(offset);
    central.push(name);
  }

  const centralOffset = body.length;
  const centralBytes = central.concat();

  const end = new ByteWriter();
  end.u32(EOCD_SIG);
  end.u16(0); // this disk
  end.u16(0); // disk with central directory
  end.u16(list.length);
  end.u16(list.length);
  end.u32(centralBytes.length);
  end.u32(centralOffset);
  end.u16(0); // comment length

  const out = new Uint8Array(body.length + centralBytes.length + end.length);
  out.set(body.concat(), 0);
  out.set(centralBytes, body.length);
  out.set(end.concat(), body.length + centralBytes.length);
  return out;
}

/**
 * Make every name in a set unique, so a zip cannot contain two entries an extractor would
 * silently overwrite one with the other. `report.pdf` twice becomes `report.pdf` and
 * `report (2).pdf`.
 */
export function uniqueNames(names) {
  const seen = new Map();
  return names.map((name) => {
    const taken = seen.get(name) || 0;
    seen.set(name, taken + 1);
    if (taken === 0) return name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let n = taken + 1;
    let candidate = `${stem} (${n})${ext}`;
    while (seen.has(candidate)) candidate = `${stem} (${++n})${ext}`;
    seen.set(candidate, 1);
    return candidate;
  });
}
