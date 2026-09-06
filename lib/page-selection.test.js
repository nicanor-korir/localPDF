import { describe, expect, it } from 'vitest';
import {
  PageRangeError,
  formatPageRanges,
  parsePageRanges,
  planSplit,
  splitPartName,
} from './page-selection';

describe('parsePageRanges', () => {
  it('parses single pages, ranges and mixtures, 1-based in, 0-based out', () => {
    expect(parsePageRanges('1-3, 5, 8-10', 10).indices).toEqual([0, 1, 2, 4, 7, 8, 9]);
  });

  it('keeps the groups separate so split can make one file per group', () => {
    expect(parsePageRanges('1-2, 5', 10).ranges).toEqual([
      { start: 0, end: 1 },
      { start: 4, end: 4 },
    ]);
  });

  it('accepts spaces, semicolons and newlines as separators', () => {
    expect(parsePageRanges('1 2;3\n4', 10).indices).toEqual([0, 1, 2, 3]);
  });

  it('treats "all" as the whole document', () => {
    expect(parsePageRanges('all', 3).indices).toEqual([0, 1, 2]);
    expect(parsePageRanges('ALL', 3).ranges).toEqual([{ start: 0, end: 2 }]);
  });

  it('reads a trailing hyphen and "end" as "to the last page"', () => {
    expect(parsePageRanges('3-', 5).indices).toEqual([2, 3, 4]);
    expect(parsePageRanges('3-end', 5).indices).toEqual([2, 3, 4]);
    expect(parsePageRanges('3-last', 5).indices).toEqual([2, 3, 4]);
  });

  it('normalises a reversed range instead of rejecting it', () => {
    expect(parsePageRanges('7-3', 10).indices).toEqual([2, 3, 4, 5, 6]);
  });

  it('preserves the order the user wrote, so extract doubles as a reorder', () => {
    expect(parsePageRanges('3, 1', 5).indices).toEqual([2, 0]);
  });

  it('de-duplicates overlapping ranges without disturbing that order', () => {
    expect(parsePageRanges('3-5, 4-6', 10).indices).toEqual([2, 3, 4, 5]);
  });

  it('names the page that is out of range', () => {
    expect(() => parsePageRanges('1-12', 9)).toThrow(/Page 12 does not exist.*9 pages/);
  });

  it('rejects page zero', () => {
    expect(() => parsePageRanges('0-2', 9)).toThrow(/start at 1/);
  });

  it('rejects text that is not a range', () => {
    expect(() => parsePageRanges('one to three', 9)).toThrow(PageRangeError);
    expect(() => parsePageRanges('-3', 9)).toThrow(PageRangeError);
  });

  it('asks for input rather than silently selecting nothing', () => {
    expect(() => parsePageRanges('', 9)).toThrow(/Enter the pages/);
    expect(() => parsePageRanges('   ', 9)).toThrow(/Enter the pages/);
  });

  it('singularises the message for a one-page document', () => {
    expect(() => parsePageRanges('2', 1)).toThrow(/has 1 page\./);
  });
});

describe('formatPageRanges', () => {
  it('collapses runs and round-trips through the parser', () => {
    expect(formatPageRanges([0, 1, 2, 4, 7, 8, 9])).toBe('1-3, 5, 8-10');
    expect(parsePageRanges(formatPageRanges([0, 1, 2, 4]), 10).indices).toEqual([0, 1, 2, 4]);
  });

  it('sorts and de-duplicates', () => {
    expect(formatPageRanges([4, 0, 4, 1])).toBe('1-2, 5');
  });

  it('is empty for an empty selection', () => {
    expect(formatPageRanges([])).toBe('');
  });
});

describe('planSplit', () => {
  it('makes one document per page in "each" mode', () => {
    const plan = planSplit({ mode: 'each', pageCount: 3 });
    expect(plan).toEqual([
      { label: '1', indices: [0] },
      { label: '2', indices: [1] },
      { label: '3', indices: [2] },
    ]);
  });

  it('chunks in "every" mode and keeps the short final chunk', () => {
    const plan = planSplit({ mode: 'every', pageCount: 7, every: 3 });
    expect(plan.map((p) => p.label)).toEqual(['1-3', '4-6', '7']);
    expect(plan.at(-1).indices).toEqual([6]);
  });

  it('refuses a chunk size that would not split anything', () => {
    expect(() => planSplit({ mode: 'every', pageCount: 5, every: 5 })).toThrow(/leave the 5-page/);
    expect(() => planSplit({ mode: 'every', pageCount: 5, every: 9 })).toThrow(/leave the 5-page/);
  });

  it('rejects a non-positive chunk size', () => {
    expect(() => planSplit({ mode: 'every', pageCount: 5, every: 0 })).toThrow(/1 or more/);
    expect(() => planSplit({ mode: 'every', pageCount: 5, every: 1.5 })).toThrow(/1 or more/);
  });

  it('makes one document per written group in "ranges" mode', () => {
    const plan = planSplit({ mode: 'ranges', pageCount: 10, ranges: '1-2, 5, 8-10' });
    expect(plan.map((p) => p.label)).toEqual(['1-2', '5', '8-10']);
    expect(plan[2].indices).toEqual([7, 8, 9]);
  });

  it('never plans an empty document', () => {
    for (const plan of [
      planSplit({ mode: 'each', pageCount: 4 }),
      planSplit({ mode: 'every', pageCount: 7, every: 3 }),
      planSplit({ mode: 'ranges', pageCount: 9, ranges: '1, 4-6' }),
    ]) {
      expect(plan.length).toBeGreaterThan(0);
      for (const part of plan) expect(part.indices.length).toBeGreaterThan(0);
    }
  });

  it('rejects an unknown mode rather than defaulting to one', () => {
    expect(() => planSplit({ mode: 'sideways', pageCount: 3 })).toThrow(/Unknown split mode/);
  });
});

describe('splitPartName', () => {
  it('names a part after the source document and its range', () => {
    expect(splitPartName('report.pdf', '2-4')).toBe('report-pages-2-4.pdf');
    expect(splitPartName('report', '1')).toBe('report-pages-1.pdf');
  });

  it('falls back rather than producing a name that is only a suffix', () => {
    expect(splitPartName('.pdf', '1')).toBe('document-pages-1.pdf');
    expect(splitPartName('', '1')).toBe('document-pages-1.pdf');
  });
});
