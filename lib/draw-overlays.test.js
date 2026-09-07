import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { mergeDocuments } from './merge.js';
import { addImage, addText } from './overlays.js';
import { asSource, makePdf, pagesOf } from './__fixtures__/pdfs.js';

const compressImage = () => Promise.resolve({ bytes: PIXEL, format: 'jpeg', passthrough: false });

import { readFileSync } from 'node:fs';
const PIXEL = new Uint8Array(readFileSync(new URL('./__fixtures__/pixel.jpg', import.meta.url)));

/**
 * Where each piece of text sits on the page *as displayed*, in fractions of the visible page.
 *
 * Going through the viewport transform is the point: it applies /Rotate, so this answers the
 * question that matters — "is the text where the user put it on screen" — rather than the one
 * that is easy to answer and means nothing, "is it at some coordinate in content space".
 */
async function textPositions(bytes) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    return content.items
      .filter((item) => item.str.trim())
      .map((item) => {
        const [, , , , x, y] = pdfjs.Util.transform(viewport.transform, item.transform);
        return { text: item.str, u: x / viewport.width, v: y / viewport.height };
      });
  } finally {
    await task.destroy();
  }
}

/** Merge one source page, with overlays, keeping its own size so positions stay comparable. */
async function build(sourceBytes, makeOverlays, options = {}) {
  const source = asSource(sourceBytes, 'doc.pdf');
  const [page] = pagesOf(source, 1);
  return mergeDocuments([page], {
    sources: [source],
    compressImage,
    pageSize: 'original',
    overlays: makeOverlays(page),
    ...options,
  });
}

describe('text overlays', () => {
  it('puts text on the page where it was placed', async () => {
    const { bytes } = await build(await makePdf({ width: 400, height: 600 }), (page) =>
      addText([], page.id, { x: 0.1, y: 0.1, width: 0.6, height: 0.1 }, { text: 'Signed here' }),
    );

    const found = await textPositions(bytes);
    const signed = found.find((item) => item.text.includes('Signed'));
    expect(signed, 'the text should be in the output').toBeTruthy();
    // Near the top-left, which is where a box at (0.1, 0.1) is.
    expect(signed.u).toBeGreaterThan(0.05);
    expect(signed.u).toBeLessThan(0.4);
    expect(signed.v).toBeGreaterThan(0.05);
    expect(signed.v).toBeLessThan(0.4);
  });

  it.each([0, 90, 180, 270])('lands in the same displayed corner on a page rotated %i', async (rotate) => {
    // The whole reason the placement geometry exists. A viewer rotates the page by /Rotate, so
    // text drawn without compensating would come out sideways and in the wrong corner.
    const { bytes } = await build(await makePdf({ width: 400, height: 600, rotate }), (page) =>
      addText([], page.id, { x: 0.05, y: 0.05, width: 0.5, height: 0.08 }, { text: 'CORNER' }),
    );

    const found = await textPositions(bytes);
    const corner = found.find((item) => item.text.includes('CORNER'));
    expect(corner, `no text at ${rotate} degrees`).toBeTruthy();
    expect(corner.u, `x at ${rotate}`).toBeLessThan(0.5);
    expect(corner.v, `y at ${rotate}`).toBeLessThan(0.5);
  });

  it('puts a box at the bottom-right in the bottom-right', async () => {
    const { bytes } = await build(await makePdf({ width: 400, height: 600 }), (page) =>
      addText([], page.id, { x: 0.6, y: 0.85, width: 0.35, height: 0.08 }, { text: 'FOOTER' }),
    );
    const footer = (await textPositions(bytes)).find((item) => item.text.includes('FOOTER'));
    expect(footer.u).toBeGreaterThan(0.5);
    expect(footer.v).toBeGreaterThan(0.5);
  });

  it('leaves the page alone when the text is empty', async () => {
    const source = await makePdf({ width: 400, height: 600 });
    const plain = await build(source, () => []);
    const blank = await build(source, (page) =>
      addText([], page.id, { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, { text: '   ' }),
    );
    expect(await textPositions(blank.bytes)).toEqual(await textPositions(plain.bytes));
  });

  it('substitutes what the built-in fonts cannot write, and says which characters', async () => {
    const { bytes, overlayNotes } = await build(await makePdf({ width: 400, height: 600 }), (page) =>
      addText([], page.id, { x: 0.1, y: 0.1, width: 0.7, height: 0.1 }, { text: 'Total 日 100' }),
    );

    // Reported rather than silently dropped: a word vanishing from a document with nobody
    // told is the worst version of this.
    expect(overlayNotes).toContainEqual({ type: 'unwritable', characters: ['日'] });
    const found = await textPositions(bytes);
    expect(found.map((i) => i.text).join(' ')).toContain('Total ? 100');
  });

  it('honours the size and colour it was given', async () => {
    const { bytes } = await build(await makePdf({ width: 400, height: 600 }), (page) =>
      addText([], page.id, { x: 0.1, y: 0.1, width: 0.8, height: 0.2 }, {
        text: 'BIG',
        size: 40,
        colour: 'red',
      }),
    );
    const operators = await pageOperators(bytes);
    expect(operators).toMatch(/\s40(\.\d+)? Tf/);
    // A red fill, written as an RGB colour operator.
    expect(operators).toMatch(/0\.8 0\.1 0\.1 rg/);
  });
});

describe('image overlays', () => {
  it('draws an added image onto the page', async () => {
    const pdf = asSource(await makePdf({ width: 400, height: 600 }), 'doc.pdf');
    const stamp = asSource(PIXEL, 'stamp.jpg', 'image/jpeg');
    const [page] = pagesOf(pdf, 1);

    const before = await mergeDocuments([page], { sources: [pdf, stamp], compressImage, pageSize: 'original' });
    const after = await mergeDocuments([page], {
      sources: [pdf, stamp],
      compressImage,
      pageSize: 'original',
      overlays: addImage([], page.id, { x: 0.1, y: 0.1, width: 0.3, height: 0.2 }, stamp.fileId),
    });

    expect(after.bytes.length).toBeGreaterThan(before.bytes.length);
    const doc = await PDFDocument.load(after.bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
  });

  it('ignores an image whose source is no longer there', async () => {
    const { bytes, overlayNotes } = await build(await makePdf({ width: 400, height: 600 }), (page) =>
      addImage([], page.id, { x: 0.1, y: 0.1, width: 0.3, height: 0.2 }, 'gone'),
    );
    expect(overlayNotes).toEqual([]);
    expect((await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount()).toBe(1);
  });
});

describe('overlays and the rest of the merge', () => {
  it('changes nothing when there are none', async () => {
    const source = await makePdf({ width: 400, height: 600 });
    const withOption = await build(source, () => []);
    const withoutOption = await mergeDocuments(pagesOf(asSource(source, 'doc.pdf'), 1), {
      sources: [asSource(source, 'doc.pdf')],
      compressImage,
      pageSize: 'original',
    });
    expect(withOption.bytes.length).toBe(withoutOption.bytes.length);
    expect(withOption.overlayNotes).toEqual([]);
  });

  it('ignores overlays pointing at a page that is not in the output', async () => {
    const { bytes } = await build(await makePdf({ width: 400, height: 600 }), () =>
      addText([], 'some-other-page', { x: 0.1, y: 0.1, width: 0.5, height: 0.1 }, { text: 'GHOST' }),
    );
    expect((await textPositions(bytes)).some((i) => i.text.includes('GHOST'))).toBe(false);
  });
});

/**
 * The first page's content operators, decompressed.
 *
 * The content stream is Flate-compressed even without object streams, so reading the output as
 * text finds nothing. This is the only way to assert on what was actually *written* — the font
 * size and the fill colour never reach pdf.js's text layer.
 */
async function pageOperators(bytes) {
  const { PDFRawStream, decodePDFRawStream } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const [page] = doc.getPages();
  const contents = page.node.Contents();
  const streams = contents?.asArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  return streams
    .filter((stream) => stream instanceof PDFRawStream)
    .map((stream) => new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()))
    .join('\n');
}
