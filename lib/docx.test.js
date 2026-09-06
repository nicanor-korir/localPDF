import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDocx, escapeXml } from './docx.js';

function hasUnzip() {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const unzipAvailable = hasUnzip();

/**
 * macOS ships `textutil`, which reads OOXML with Apple's implementation rather than ours.
 * Skipped where it does not exist (CI runs on Linux), but it is the strongest check available:
 * a file that only our own zip reader accepts proves very little about whether Word will open
 * it.
 */
function hasTextutil() {
  try {
    execFileSync('textutil', ['-info', '/dev/null'], { stdio: 'ignore' });
    return true;
  } catch (err) {
    // -info on /dev/null fails, but "command not found" fails differently.
    return err?.code !== 'ENOENT';
  }
}
const textutilAvailable = hasTextutil();

/** Unpack a .docx with the system unzip and return its parts as text. */
function unpack(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'docx-'));
  try {
    const path = join(dir, 'out.docx');
    writeFileSync(path, bytes);
    // -t checks every entry's CRC, which is the part worth borrowing an outside tool for.
    execFileSync('unzip', ['-t', path], { stdio: 'pipe' });
    execFileSync('unzip', ['-qq', '-o', path, '-d', dir], { stdio: 'pipe' });
    const read = (name) => readFileSync(join(dir, name), 'utf8');
    return {
      types: read('[Content_Types].xml'),
      rels: read('_rels/.rels'),
      document: read('word/document.xml'),
      styles: read('word/styles.xml'),
      numbering: read('word/numbering.xml'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const page = [
  { type: 'heading', level: 1, text: 'Quarterly Report' },
  { type: 'paragraph', text: 'Revenue rose again.' },
  { type: 'list-item', text: 'First point' },
];

describe('escapeXml', () => {
  it('escapes the five characters XML reserves', () => {
    expect(escapeXml('a & b < c > d " e \' f')).toBe('a &amp; b &lt; c &gt; d &quot; e &apos; f');
  });

  it('drops control characters, which make a document Word calls damaged', () => {
    expect(escapeXml('a\x00b\x07c')).toBe('abc');
  });

  it('keeps the whitespace XML does allow', () => {
    expect(escapeXml('a\tb\nc')).toBe('a\tb\nc');
  });
});

describe('createDocx', () => {
  it('is a zip', () => {
    expect([...createDocx([page]).subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('puts [Content_Types].xml first, which some readers require', () => {
    const bytes = createDocx([page]);
    const name = new TextDecoder().decode(bytes.subarray(30, 30 + 19));
    expect(name).toBe('[Content_Types].xml');
  });

  it('never produces a body with no paragraphs', () => {
    // Word reports a document with an empty body as damaged.
    const text = new TextDecoder('latin1').decode(createDocx([]));
    expect(text).toContain('<w:p/>');
  });

  it('escapes text rather than letting it become markup', () => {
    const text = new TextDecoder().decode(createDocx([[{ type: 'paragraph', text: 'a < b & c' }]]));
    expect(text).toContain('a &lt; b &amp; c');
    expect(text).not.toContain('a < b & c');
  });

  it('skips blocks with no text', () => {
    const text = new TextDecoder().decode(createDocx([[{ type: 'paragraph', text: '   ' }]]));
    expect(text).toContain('<w:p/>');
  });

  it.runIf(unzipAvailable)('unpacks into the parts Word expects', () => {
    const parts = unpack(createDocx([page, [{ type: 'paragraph', text: 'Second page.' }]]));

    expect(parts.types).toContain('/word/document.xml');
    expect(parts.types).toContain('/word/numbering.xml');
    expect(parts.rels).toContain('word/document.xml');

    expect(parts.document).toContain('<w:pStyle w:val="Heading1"/>');
    expect(parts.document).toContain('Quarterly Report');
    expect(parts.document).toContain('Revenue rose again.');
    // A real numbered bullet, so pressing Enter in Word continues the list.
    expect(parts.document).toContain('<w:numId w:val="1"/>');
    expect(parts.document).toContain('<w:br w:type="page"/>');
    expect(parts.document).toContain('<w:sectPr>');

    expect(parts.styles).toContain('w:styleId="Heading1"');
    expect(parts.numbering).toContain('w:numFmt w:val="bullet"');
  });

  it.runIf(textutilAvailable)('opens in an implementation that is not ours', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docx-'));
    try {
      const path = join(dir, 'out.docx');
      writeFileSync(
        path,
        createDocx([
          [
            { type: 'heading', level: 1, text: 'Quarterly Report' },
            { type: 'paragraph', text: 'Revenue rose again.' },
            { type: 'list-item', text: 'Margins improved' },
          ],
          [{ type: 'paragraph', text: 'Second page with an ampersand & a < sign.' }],
        ]),
      );
      const text = execFileSync('textutil', ['-convert', 'txt', '-stdout', path], {
        stdio: ['ignore', 'pipe', 'pipe'],
      }).toString();

      expect(text).toContain('Quarterly Report');
      expect(text).toContain('Revenue rose again.');
      // The bullet comes back as a bullet, so the numbering definition really took.
      expect(text).toContain('\u2022\tMargins improved');
      // Escaped characters come back as themselves, not as entities.
      expect(text).toContain('ampersand & a < sign');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.runIf(unzipAvailable)('carries the title into the document properties', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docx-'));
    try {
      const path = join(dir, 'out.docx');
      writeFileSync(path, createDocx([page], { title: 'My Report' }));
      execFileSync('unzip', ['-qq', '-o', path, '-d', dir], { stdio: 'pipe' });
      expect(readFileSync(join(dir, 'docProps/core.xml'), 'utf8')).toContain('<dc:title>My Report</dc:title>');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
