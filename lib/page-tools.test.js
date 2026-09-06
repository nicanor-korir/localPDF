import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { mergeDocuments } from './merge.js';
import { parsePageRanges, planSplit, splitPartName } from './page-selection.js';
import { createZip } from './zip.js';
import { asSource, makePdf, pagesOf } from './__fixtures__/pdfs.js';

const compressImage = () => Promise.resolve({ bytes: new Uint8Array(), format: 'jpeg' });
const reload = (bytes) => PDFDocument.load(bytes, { updateMetadata: false });

/**
 * Extract and split are not new engines — they are the merge pipeline pointed at a subset of
 * the page list. These tests pin that composition, because a selection that is parsed
 * correctly and then written incorrectly produces a file that looks plausible and is wrong.
 */
describe('extract', () => {
  it('writes exactly the selected pages, in the selected order', async () => {
    // Five pages, each a different width, so a page can be identified by its size alone.
    const widths = [301, 302, 303, 304, 305];
    const sources = [];
    const pages = [];
    for (const width of widths) {
      const source = asSource(await makePdf({ width, height: 400 }), `w${width}.pdf`);
      sources.push(source);
      pages.push(...pagesOf(source, 1));
    }

    const { indices } = parsePageRanges('5, 1, 3', 5);
    const selected = indices.map((i) => pages[i]);

    const { bytes } = await mergeDocuments(selected, {
      sources,
      compressImage,
      pageSize: 'original',
    });
    const out = await reload(bytes);

    expect(out.getPageCount()).toBe(3);
    expect(out.getPages().map((p) => Math.round(p.getWidth()))).toEqual([305, 301, 303]);
  });

  it('keeps each page at its original size rather than refitting to A4', async () => {
    const source = asSource(await makePdf({ width: 200, height: 900, pages: 2 }), 'tall.pdf');
    const pages = pagesOf(source, 2);

    const { bytes } = await mergeDocuments([pages[1]], {
      sources: [source],
      compressImage,
      pageSize: 'original',
    });
    const [page] = (await reload(bytes)).getPages();

    expect(Math.round(page.getWidth())).toBe(200);
    expect(Math.round(page.getHeight())).toBe(900);
  });
});

describe('split', () => {
  it('produces one document per part, together covering every page exactly once', async () => {
    const source = asSource(await makePdf({ width: 300, height: 400, pages: 7 }), 'report.pdf');
    const pages = pagesOf(source, 7);
    const parts = planSplit({ mode: 'every', pageCount: 7, every: 3 });

    const outputs = [];
    for (const part of parts) {
      const { bytes } = await mergeDocuments(
        part.indices.map((i) => pages[i]),
        { sources: [source], compressImage, pageSize: 'original' },
      );
      outputs.push({ name: splitPartName('report.pdf', part.label), bytes });
    }

    expect(outputs.map((o) => o.name)).toEqual([
      'report-pages-1-3.pdf',
      'report-pages-4-6.pdf',
      'report-pages-7.pdf',
    ]);

    const counts = [];
    for (const output of outputs) counts.push((await reload(output.bytes)).getPageCount());
    expect(counts).toEqual([3, 3, 1]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(7);
  });

  it('packs the parts into a zip whose entries are all real PDFs', async () => {
    const source = asSource(await makePdf({ width: 300, height: 400, pages: 4 }), 'report.pdf');
    const pages = pagesOf(source, 4);
    const parts = planSplit({ mode: 'each', pageCount: 4 });

    const entries = [];
    for (const part of parts) {
      const { bytes } = await mergeDocuments(
        part.indices.map((i) => pages[i]),
        { sources: [source], compressImage, pageSize: 'original' },
      );
      entries.push({ name: splitPartName('report.pdf', part.label), data: bytes });
    }

    for (const entry of entries) {
      expect(new TextDecoder().decode(entry.data.subarray(0, 5))).toBe('%PDF-');
    }

    const zip = createZip(entries);
    // Local file header signature, then one central directory entry per part.
    expect([...zip.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = new TextDecoder('latin1').decode(zip);
    for (const entry of entries) expect(text).toContain(entry.name);
  });
});
