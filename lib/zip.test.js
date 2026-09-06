import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createZip, crc32, uniqueNames } from './zip';

const enc = (s) => new TextEncoder().encode(s);
const u32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
const u16 = (b, o) => b[o] | (b[o + 1] << 8);

// Verify with the system `unzip` when it is available, so the archives are checked by an
// implementation that is not ours. Skipped rather than failed where it is missing.
function systemUnzip() {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const hasUnzip = systemUnzip();

describe('crc32', () => {
  it('matches the standard check vector', () => {
    // The IEEE 802.3 check value for "123456789".
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
  });

  it('is zero for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('createZip', () => {
  it('writes local headers, a central directory and an EOCD record', () => {
    const zip = createZip([
      { name: 'a.txt', data: enc('hello') },
      { name: 'b.txt', data: enc('world!') },
    ]);

    expect(u32(zip, 0)).toBe(0x04034b50);

    const eocdAt = zip.length - 22;
    expect(u32(zip, eocdAt)).toBe(0x06054b50);
    expect(u16(zip, eocdAt + 8)).toBe(2); // entries on this disk
    expect(u16(zip, eocdAt + 10)).toBe(2); // total entries

    const cdOffset = u32(zip, eocdAt + 16);
    expect(u32(zip, cdOffset)).toBe(0x02014b50);
    // The central directory must start exactly where the file data ends.
    expect(cdOffset + u32(zip, eocdAt + 12)).toBe(eocdAt);
  });

  it('marks names as UTF-8 so non-ASCII filenames survive', () => {
    const zip = createZip([{ name: 'rapport-café.pdf', data: enc('x') }]);
    expect(u16(zip, 6) & 0x800).toBe(0x800);
  });

  it('stores rather than deflates', () => {
    const zip = createZip([{ name: 'a.bin', data: new Uint8Array(500) }]);
    expect(u16(zip, 8)).toBe(0); // method 0 = stored
    expect(u32(zip, 18)).toBe(500); // compressed size == uncompressed
    expect(u32(zip, 22)).toBe(500);
  });

  it('strips path traversal out of entry names', () => {
    const zip = createZip([{ name: '../../etc/passwd', data: enc('x') }]);
    const nameLen = u16(zip, 26);
    const name = new TextDecoder().decode(zip.subarray(30, 30 + nameLen));
    expect(name).toBe('etc/passwd');
  });

  it('refuses an empty archive rather than emitting a stub', () => {
    expect(() => createZip([])).toThrow(/empty/i);
  });

  it.runIf(hasUnzip)('produces an archive the system unzip accepts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
    try {
      // -t verifies every entry's CRC against its stored data. This is the real independent
      // check, and it covers the non-ASCII name too.
      const all = join(dir, 'all.zip');
      writeFileSync(
        all,
        createZip([
          { name: 'one.txt', data: enc('first file') },
          { name: 'nested/two.bin', data: new Uint8Array([0, 1, 2, 253, 254, 255]) },
          { name: 'caf\u00e9.txt', data: enc('unicode name') },
        ]),
      );
      execFileSync('unzip', ['-t', all], { stdio: 'pipe' });

      // The extraction round-trip stays ASCII-only. The Info-ZIP build macOS ships predates
      // the UTF-8 name flag and mangles the filename on the way out; that is its limitation,
      // not the archive's, and -t above already proved the entry is intact.
      const ascii = join(dir, 'ascii.zip');
      writeFileSync(
        ascii,
        createZip([
          { name: 'one.txt', data: enc('first file') },
          { name: 'nested/two.bin', data: new Uint8Array([0, 1, 2, 253, 254, 255]) },
        ]),
      );
      execFileSync('unzip', ['-qq', '-o', ascii, '-d', dir], { stdio: 'pipe' });

      expect(readFileSync(join(dir, 'one.txt'), 'utf8')).toBe('first file');
      expect([...readFileSync(join(dir, 'nested/two.bin'))]).toEqual([0, 1, 2, 253, 254, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('uniqueNames', () => {
  it('leaves distinct names alone', () => {
    expect(uniqueNames(['a.pdf', 'b.pdf'])).toEqual(['a.pdf', 'b.pdf']);
  });

  it('disambiguates duplicates before the extension', () => {
    expect(uniqueNames(['a.pdf', 'a.pdf', 'a.pdf'])).toEqual(['a.pdf', 'a (2).pdf', 'a (3).pdf']);
  });

  it('does not collide with a name that already looks disambiguated', () => {
    expect(uniqueNames(['a.pdf', 'a (2).pdf', 'a.pdf'])).toEqual(['a.pdf', 'a (2).pdf', 'a (3).pdf']);
  });

  it('handles names with no extension', () => {
    expect(uniqueNames(['notes', 'notes'])).toEqual(['notes', 'notes (2)']);
  });
});
