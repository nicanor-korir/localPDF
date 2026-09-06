import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ProtectedPdf, analysePdf, compressPdf } from './pdf-compress.js';

const fixture = (name) =>
  new Uint8Array(readFileSync(new URL(`./__fixtures__/encrypted/${name}`, import.meta.url)));

/** Bytes that compress badly, so a "smaller" result can only come from the stub. */
const noise = (n, seed = 1) =>
  Uint8Array.from({ length: n }, (_, i) => (i * 2654435761 + seed * 40503) & 0xff);

/**
 * A PDF carrying image XObjects with the given dictionaries.
 *
 * The bytes are not real JPEGs, and do not need to be: the decoder is injected, so what is
 * under test here is which images get chosen and how the result is written back.
 */
async function pdfWithImages(images) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([400, 400]);
  const names = [];

  images.forEach((image, index) => {
    const dict = {
      Type: 'XObject',
      Subtype: 'Image',
      Width: image.width,
      Height: image.height,
      ColorSpace: image.colourSpace ?? 'DeviceRGB',
      BitsPerComponent: image.bits ?? 8,
      Filter: image.filter ?? 'DCTDecode',
      ...(image.extra ?? {}),
    };
    const stream = PDFRawStream.of(doc.context.obj(dict), image.data);
    stream.dict.set(PDFName.of('Length'), PDFNumber.of(image.data.length));
    const ref = doc.context.register(stream);
    const name = `Im${index}`;
    names.push(name);
    page.node.setXObject(PDFName.of(name), ref);
  });

  page.drawText('A page with pictures on it.', { x: 40, y: 360, size: 12 });
  return { bytes: await doc.save({ useObjectStreams: false }), names };
}

/** Stands in for the canvas: halves the dimensions and returns a quarter of the bytes. */
const halvingRecoder = ({ data, info }) => ({
  data: noise(Math.max(16, Math.floor(data.length / 4)), 7),
  width: Math.max(1, Math.floor(info.width / 2)),
  height: Math.max(1, Math.floor(info.height / 2)),
});

const opensCleanly = async (bytes) => {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  try {
    const doc = await task.promise;
    return doc.numPages;
  } finally {
    await task.destroy();
  }
};

describe('analysePdf', () => {
  it('reports where the bytes are', async () => {
    const { bytes } = await pdfWithImages([
      { width: 2000, height: 1500, data: noise(120_000) },
      { width: 40, height: 40, data: noise(400) },
    ]);
    const report = analysePdf(bytes);

    expect(report.imageCount).toBe(2);
    expect(report.imageBytes).toBeGreaterThan(120_000);
    expect(report.total).toBe(bytes.length);
    // Everything has to be accounted for somewhere.
    expect(report.imageBytes + report.otherStreamBytes + report.structureBytes).toBe(report.total);
  });

  it('separates what it could actually work on from the image total', async () => {
    const { bytes } = await pdfWithImages([
      { width: 2000, height: 1500, data: noise(90_000) },
      // Fax is bilevel and already smaller than any re-encoding would manage.
      { width: 2000, height: 1500, data: noise(90_000), filter: 'CCITTFaxDecode' },
    ]);
    const report = analysePdf(bytes);
    expect(report.imageCount).toBe(2);
    expect(report.recodableBytes).toBeLessThan(report.imageBytes);
  });

  it('refuses a file that is not a PDF', () => {
    expect(() => analysePdf(new Uint8Array([1, 2, 3]))).toThrow(/could not be read/);
  });
});

describe('compressPdf', () => {
  it('replaces a large image and rewrites its dictionary to match', async () => {
    const { bytes } = await pdfWithImages([{ width: 2400, height: 1800, data: noise(200_000) }]);
    const result = await compressPdf(bytes, { recodeImage: halvingRecoder, compact: false });

    expect(result.recoded).toBe(1);
    expect(result.after).toBeLessThan(result.before);
    expect(result.changed).toBe(true);

    const text = new TextDecoder('latin1').decode(result.bytes);
    // The dictionary must describe the new image, not the old one.
    expect(text).toContain('/Width 1200');
    expect(text).toContain('/Height 900');
    expect(text).not.toContain('/Width 2400');
    expect(await opensCleanly(result.bytes)).toBe(1);
  });

  it('leaves small images alone', async () => {
    const { bytes } = await pdfWithImages([{ width: 60, height: 60, data: noise(900) }]);
    const result = await compressPdf(bytes, { recodeImage: halvingRecoder, compact: false });
    expect(result.recoded).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('leaves formats it cannot read safely exactly as they were', async () => {
    for (const filter of ['CCITTFaxDecode', 'JBIG2Decode', 'JPXDecode']) {
      const { bytes } = await pdfWithImages([
        { width: 2400, height: 1800, data: noise(200_000), filter },
      ]);
      const result = await compressPdf(bytes, { recodeImage: halvingRecoder, compact: false });
      expect(result.recoded, filter).toBe(0);
      expect(result.skipped, filter).toBe(1);
    }
  });

  it('keeps the original when the encoder cannot manage an image', async () => {
    const { bytes } = await pdfWithImages([{ width: 2400, height: 1800, data: noise(200_000) }]);
    const result = await compressPdf(bytes, { recodeImage: () => null, compact: false });
    expect(result.recoded).toBe(0);
    expect(result.changed).toBe(false);
    expect(result.bytes).toBe(bytes);
  });

  it('keeps the original when re-encoding would make an image bigger', async () => {
    const { bytes } = await pdfWithImages([{ width: 2400, height: 1800, data: noise(200_000) }]);
    const inflating = ({ data, info }) => ({
      data: noise(data.length * 2, 9),
      width: info.width,
      height: info.height,
    });
    const result = await compressPdf(bytes, { recodeImage: inflating, compact: false });
    expect(result.recoded).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('never returns a file larger than the one it was given', async () => {
    // A document of many tiny objects: the rewrite costs more structure than it saves.
    const { bytes } = await pdfWithImages([{ width: 30, height: 30, data: noise(120) }]);
    const result = await compressPdf(bytes, { recodeImage: halvingRecoder, compact: false });
    expect(result.after).toBeLessThanOrEqual(result.before);
    expect(result.bytes.length).toBeLessThanOrEqual(bytes.length);
  });

  it('carries the transparency across when it replaces an image', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage([400, 400]);
    const mask = doc.context.register(
      PDFRawStream.of(
        doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: 8, Height: 8, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }),
        noise(64),
      ),
    );
    const image = PDFRawStream.of(
      doc.context.obj({
        Type: 'XObject', Subtype: 'Image', Width: 2400, Height: 1800,
        ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'DCTDecode', SMask: mask,
      }),
      noise(200_000),
    );
    image.dict.set(PDFName.of('Length'), PDFNumber.of(200_000));
    page.node.setXObject(PDFName.of('Im0'), doc.context.register(image));
    const bytes = await doc.save({ useObjectStreams: false });

    const result = await compressPdf(bytes, { recodeImage: halvingRecoder, compact: false });
    expect(result.recoded).toBe(1);
    // The soft mask is a separate object holding the alpha; losing the reference would lose
    // the transparency silently.
    expect(new TextDecoder('latin1').decode(result.bytes)).toMatch(/\/SMask \d+ 0 R/);
  });

  it('reports how much the images gave up', async () => {
    const { bytes } = await pdfWithImages([
      { width: 2400, height: 1800, data: noise(200_000) },
      { width: 2000, height: 1600, data: noise(160_000, 3) },
    ]);
    const result = await compressPdf(bytes, { recodeImage: halvingRecoder, compact: false });
    expect(result.recoded).toBe(2);
    expect(result.imageBytesAfter).toBeLessThan(result.imageBytesBefore);
  });

  it('refuses a protected document rather than producing rubbish', async () => {
    await expect(
      compressPdf(fixture('enc-aes-128.pdf'), { recodeImage: halvingRecoder }),
    ).rejects.toBeInstanceOf(ProtectedPdf);
  });

  it('keeps the page text readable', async () => {
    const { bytes } = await pdfWithImages([{ width: 2400, height: 1800, data: noise(200_000) }]);
    const result = await compressPdf(bytes, { recodeImage: halvingRecoder, compact: false });

    const task = pdfjs.getDocument({ data: new Uint8Array(result.bytes), verbosity: 0 });
    try {
      const doc = await task.promise;
      const content = await (await doc.getPage(1)).getTextContent();
      expect(content.items.map((i) => i.str).join(' ')).toContain('A page with pictures on it.');
    } finally {
      await task.destroy();
    }
  });
});
