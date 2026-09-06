import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  blocksFromItems,
  groupBlocks,
  groupLines,
  normalizeItems,
  toMarkdown,
  toPlainText,
} from './text-layout.js';

/** A pdf.js-shaped text item. `y` grows upwards, as it does in PDF space. */
const item = (str, x, y, { size = 10, width = null, font = 'g_d0_f1' } = {}) => ({
  str,
  transform: [size, 0, 0, size, x, y],
  width: width ?? str.length * size * 0.5,
  height: size,
  fontName: font,
});

describe('normalizeItems', () => {
  it('reads position and size out of the transform', () => {
    const [only] = normalizeItems([item('Hello', 72, 700, { size: 12 })]);
    expect(only).toMatchObject({ text: 'Hello', x: 72, y: 700, size: 12 });
  });

  it('drops the empty items pdf.js emits for line breaks', () => {
    expect(normalizeItems([item('a', 0, 0), { str: '', transform: [1, 0, 0, 1, 0, 0] }])).toHaveLength(1);
  });

  it('survives an item with no transform', () => {
    expect(normalizeItems([{ str: 'x' }])[0]).toMatchObject({ text: 'x', x: 0, y: 0 });
  });
});

describe('groupLines', () => {
  it('puts items at the same baseline on one line, left to right', () => {
    const lines = groupLines(normalizeItems([
      item('world', 120, 700),
      item('Hello', 72, 700),
    ]));
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('Hello world');
  });

  it('orders lines down the page', () => {
    const lines = groupLines(normalizeItems([
      item('second', 72, 680),
      item('first', 72, 700),
    ]));
    expect(lines.map((l) => l.text)).toEqual(['first', 'second']);
  });

  it('joins kerning runs without inserting spaces inside a word', () => {
    // pdf.js often splits a word into several items for kerning; joining on whitespace would
    // shatter every word on the page.
    const lines = groupLines(normalizeItems([
      item('Wa', 72, 700, { width: 10 }),
      item('ter', 82, 700, { width: 12 }),
    ]));
    expect(lines[0].text).toBe('Water');
  });

  it('inserts a space where the gap is wide enough to be one', () => {
    const lines = groupLines(normalizeItems([
      item('one', 72, 700, { width: 15 }),
      item('two', 95, 700, { width: 15 }),
    ]));
    expect(lines[0].text).toBe('one two');
  });

  it('scales its tolerance with the type size', () => {
    // The same 4pt drop means different things at different sizes: in 30pt type it is a
    // superscript on the same line, in 6pt type it is the next line down.
    expect(groupLines(normalizeItems([item('a', 0, 700, { size: 30 }), item('b', 40, 696, { size: 30 })])))
      .toHaveLength(1);
    expect(groupLines(normalizeItems([item('a', 0, 700, { size: 6 }), item('b', 40, 696, { size: 6 })])))
      .toHaveLength(2);
  });

  it('returns nothing for nothing', () => {
    expect(groupLines([])).toEqual([]);
  });
});

describe('groupBlocks', () => {
  const page = (lines) => groupBlocks(groupLines(normalizeItems(lines)));

  it('joins consecutive lines into one paragraph', () => {
    const blocks = page([
      item('The quick brown fox', 72, 700),
      item('jumps over the dog.', 72, 688),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'paragraph', text: 'The quick brown fox jumps over the dog.' });
  });

  it('breaks a paragraph on a sparse page, where the only gap is the break', () => {
    // The real geometry from lib/__fixtures__/encrypted/base.pdf: 12pt type, 30pt apart. The
    // median gap is that gap, so a rule that only compares against the median could never see
    // a break here.
    const blocks = page([
      item('CONFIDENTIAL PAGE 1', 72, 760, { size: 12 }),
      item('Account balance: 12,345.67', 72, 730, { size: 12 }),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.text)).toEqual(['CONFIDENTIAL PAGE 1', 'Account balance: 12,345.67']);
  });

  it('keeps double-spaced lines in one paragraph', () => {
    // Twice the type size is wide leading, not a new paragraph.
    const blocks = page([
      item('The first line of it', 72, 700),
      item('and the second line', 72, 680),
      item('and then the third', 72, 660),
    ]);
    expect(blocks).toHaveLength(1);
  });

  it('starts a new paragraph after a larger gap', () => {
    const blocks = page([
      item('First paragraph line one', 72, 700),
      item('First paragraph line two', 72, 688),
      item('Second paragraph.', 72, 650),
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
    expect(blocks[1].text).toBe('Second paragraph.');
  });

  it('rejoins a word broken across lines by a hyphen', () => {
    const blocks = page([
      item('an extraordi-', 72, 700),
      item('nary result', 72, 688),
    ]);
    expect(blocks[0].text).toBe('an extraordinary result');
  });

  it('reads a noticeably larger line as a heading', () => {
    const blocks = page([
      item('Quarterly Report', 72, 720, { size: 20 }),
      item('Revenue rose again this quarter.', 72, 690, { size: 10 }),
      item('Costs held steady across the board.', 72, 678, { size: 10 }),
    ]);
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1, text: 'Quarterly Report' });
    expect(blocks[1].type).toBe('paragraph');
  });

  it('has no headings on a page that is all one size', () => {
    const blocks = page([
      item('All the same size here', 72, 700),
      item('And here as well today', 72, 660),
    ]);
    expect(blocks.every((b) => b.type === 'paragraph')).toBe(true);
  });

  it('recognises bullets and numbers as list items', () => {
    const blocks = page([
      item('• First point', 72, 700),
      item('- Second point', 72, 680),
      item('3. Third point', 72, 660),
    ]);
    expect(blocks.map((b) => b.type)).toEqual(['list-item', 'list-item', 'list-item']);
    expect(blocks.map((b) => b.text)).toEqual(['First point', 'Second point', 'Third point']);
  });

  it('does not mistake a sentence starting with a dash-like word for a list', () => {
    const blocks = page([item('Prices fell - then recovered.', 72, 700)]);
    expect(blocks[0].type).toBe('paragraph');
  });

  it('returns nothing for an empty page', () => {
    expect(groupBlocks([])).toEqual([]);
  });
});

describe('toMarkdown', () => {
  it('renders headings, paragraphs and lists', () => {
    const blocks = blocksFromItems([
      item('Findings', 72, 720, { size: 20 }),
      item('We looked at the numbers.', 72, 690),
      item('• One thing', 72, 660),
    ]);
    const md = toMarkdown([blocks]);
    expect(md).toContain('# Findings');
    expect(md).toContain('We looked at the numbers.');
    expect(md).toContain('- One thing');
  });

  it('separates pages with a rule, so a reader can see where one ended', () => {
    const a = blocksFromItems([item('Page one text here', 72, 700)]);
    const b = blocksFromItems([item('Page two text here', 72, 700)]);
    expect(toMarkdown([a, b])).toContain('\n---\n');
    expect(toMarkdown([a, b], { pageBreaks: false })).not.toContain('---');
  });

  it('escapes characters that would otherwise become markup', () => {
    const blocks = blocksFromItems([item('Costs *rose* by 5_000 [sic]', 72, 700)]);
    const md = toMarkdown([blocks]);
    expect(md).toContain('\\*rose\\*');
    expect(md).toContain('5\\_000');
    expect(md).toContain('\\[sic\\]');
  });

  it('ends with exactly one newline', () => {
    expect(toMarkdown([blocksFromItems([item('One line', 72, 700)])])).toMatch(/[^\n]\n$/);
  });
});

describe('toPlainText', () => {
  it('keeps the words and drops the markup', () => {
    const blocks = blocksFromItems([
      item('Findings', 72, 720, { size: 20 }),
      item('• One thing', 72, 690),
    ]);
    const text = toPlainText([blocks]);
    expect(text).toContain('Findings');
    expect(text).toContain('• One thing');
    expect(text).not.toContain('#');
  });
});

/**
 * The synthetic cases above all passed while the real thing was wrong: the geometry I assumed
 * for the fixture was not the geometry it has. Run a real PDF through pdf.js and the whole
 * pipeline, so the next wrong assumption fails here rather than in someone's download.
 */
describe('against a real PDF', () => {
  it('keeps two lines a wide gap apart as two paragraphs', async () => {
    const bytes = new Uint8Array(
      readFileSync(new URL('./__fixtures__/encrypted/base.pdf', import.meta.url)),
    );
    const task = pdfjs.getDocument({ data: bytes, verbosity: 0 });
    try {
      const doc = await task.promise;
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        pages.push(blocksFromItems((await (await doc.getPage(i)).getTextContent()).items));
      }

      expect(pages).toHaveLength(3);
      // 12pt type, 30pt apart — a break, and it must not come out as one run-on line.
      expect(pages[0].map((b) => b.text)).toEqual([
        'CONFIDENTIAL PAGE 1',
        'Account balance: 12,345.67',
      ]);

      const md = toMarkdown(pages);
      expect(md).toContain('CONFIDENTIAL PAGE 1\n\nAccount balance: 12,345.67');
      expect(md).toContain('\n---\n');
      expect(toPlainText(pages)).toContain('CONFIDENTIAL PAGE 3');
    } finally {
      await task.destroy();
    }
  });
});
