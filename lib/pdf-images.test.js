import { describe, expect, it } from 'vitest';
import { Lexer, Name, PdfString, Ref } from './pdf-lexer.js';
import {
  COMPRESSION_LEVELS,
  decodeStrategy,
  describeImage,
  dictOf,
  filterChain,
  isImageXObject,
  jpegImageDict,
  levelOf,
  shouldRecode,
  writeValue,
} from './pdf-images.js';

const bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const dict = (source) => new Lexer(bytes(source)).readObject();

const IMAGE = dict(
  '<< /Type /XObject /Subtype /Image /Width 2000 /Height 1500 /ColorSpace /DeviceRGB ' +
    '/BitsPerComponent 8 /Filter /DCTDecode /Length 900000 /SMask 12 0 R >>',
);

describe('isImageXObject', () => {
  it('accepts an image XObject', () => {
    expect(isImageXObject(IMAGE)).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isImageXObject(dict('<< /Subtype /Form >>'))).toBe(false);
    expect(isImageXObject(dict('<< /Type /Page >>'))).toBe(false);
    expect(isImageXObject(null)).toBe(false);
  });

  it('leaves stencil masks alone', () => {
    // One bit per pixel, painting a colour through a shape. Re-encoding it as a photograph
    // would be both larger and wrong.
    expect(isImageXObject(dict('<< /Subtype /Image /ImageMask true >>'))).toBe(false);
  });
});

describe('filterChain', () => {
  it('reads a single filter and a chain alike', () => {
    expect(filterChain(dict('<< /Filter /DCTDecode >>'))).toEqual(['DCTDecode']);
    expect(filterChain(dict('<< /Filter [/FlateDecode /DCTDecode] >>'))).toEqual([
      'FlateDecode',
      'DCTDecode',
    ]);
  });

  it('is empty when there is no filter', () => {
    expect(filterChain(dict('<< /Width 1 >>'))).toEqual([]);
  });
});

describe('describeImage', () => {
  it('reads the geometry and encoding', () => {
    expect(describeImage(IMAGE)).toEqual({
      width: 2000,
      height: 1500,
      bitsPerComponent: 8,
      colourSpace: 'DeviceRGB',
      filters: ['DCTDecode'],
      hasSoftMask: true,
      decodeParms: null,
    });
  });

  it('keeps the decode parameters, which change how inflated bytes are laid out', () => {
    // Ignoring a predictor turns a photograph into diagonal noise.
    const withParms = dict(
      '<< /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /Columns 800 >> >>',
    );
    expect(describeImage(withParms).decodeParms).toEqual({ Predictor: 15, Colors: 3, Columns: 800 });
    // An array of parameters, as a filter chain carries.
    const asArray = dict('<< /Filter [/FlateDecode] /DecodeParms [<< /Predictor 12 >>] >>');
    expect(describeImage(asArray).decodeParms).toEqual({ Predictor: 12 });
  });

  it('reports an indirect colour space as unknown rather than guessing', () => {
    expect(describeImage(dict('<< /ColorSpace 9 0 R >>')).colourSpace).toBeNull();
  });
});

describe('decodeStrategy', () => {
  const info = (over) => ({ bitsPerComponent: 8, colourSpace: 'DeviceRGB', filters: [], ...over });

  it('hands a JPEG straight to the browser', () => {
    expect(decodeStrategy(info({ filters: ['DCTDecode'] }))).toEqual({ kind: 'blob', mime: 'image/jpeg' });
    // A JPEG wrapped in another filter is not a file the browser can be handed directly, and
    // unwrapping it first would buy a rare case at the cost of a decode path that can go wrong.
    expect(decodeStrategy(info({ filters: ['FlateDecode', 'DCTDecode'] }))).toBeNull();
  });

  it('reads plain 8-bit samples itself', () => {
    expect(decodeStrategy(info({ filters: ['FlateDecode'] }))).toEqual({ kind: 'raw', components: 3 });
    expect(decodeStrategy(info({ filters: ['FlateDecode'], colourSpace: 'DeviceGray' }))).toEqual({
      kind: 'raw',
      components: 1,
    });
    // No filter at all is still plain samples.
    expect(decodeStrategy(info({ filters: [] })).kind).toBe('raw');
  });

  it('leaves alone what it cannot read safely', () => {
    // Bilevel fax and JBIG2 are already smaller than any re-encoding would make them.
    expect(decodeStrategy(info({ filters: ['CCITTFaxDecode'] }))).toBeNull();
    expect(decodeStrategy(info({ filters: ['JBIG2Decode'] }))).toBeNull();
    // JPEG 2000 support is inconsistent; attempting it risks a blank page.
    expect(decodeStrategy(info({ filters: ['JPXDecode'] }))).toBeNull();
    // Indexed and separation colour need the palette resolved.
    expect(decodeStrategy(info({ filters: ['FlateDecode'], colourSpace: null }))).toBeNull();
    expect(decodeStrategy(info({ filters: ['FlateDecode'], colourSpace: 'DeviceCMYK' }))).toBeNull();
    // Anything but 8 bits per component is not a layout we lay out.
    expect(decodeStrategy(info({ filters: ['FlateDecode'], bitsPerComponent: 1 }))).toBeNull();
    expect(decodeStrategy(info({ filters: ['FlateDecode'], bitsPerComponent: 16 }))).toBeNull();
  });
});

describe('shouldRecode', () => {
  const level = levelOf('balanced');

  it('takes on an image larger than the target', () => {
    expect(shouldRecode({ width: 3000, height: 2000, byteLength: 1000 }, level)).toBe(true);
  });

  it('takes on a heavy image even when its dimensions are modest', () => {
    expect(shouldRecode({ width: 900, height: 900, byteLength: 400_000 }, level)).toBe(true);
  });

  it('leaves a small, light image alone', () => {
    // Re-encoding a logo saves nothing and softens something that was crisp.
    expect(shouldRecode({ width: 120, height: 60, byteLength: 3000 }, level)).toBe(false);
  });

  it('never touches something too small to be a picture', () => {
    expect(shouldRecode({ width: 4, height: 4, byteLength: 999_999 }, level)).toBe(false);
  });
});

describe('compression levels', () => {
  it('gets smaller and rougher in one direction', () => {
    const order = ['light', 'balanced', 'strong'].map((id) => COMPRESSION_LEVELS[id]);
    for (let i = 1; i < order.length; i++) {
      expect(order[i].maxPixels, order[i].id).toBeLessThan(order[i - 1].maxPixels);
      expect(order[i].quality, order[i].id).toBeLessThan(order[i - 1].quality);
    }
  });

  it('falls back rather than throwing on an unknown name', () => {
    expect(levelOf('nonsense').id).toBe('balanced');
  });
});

describe('writeValue', () => {
  it('writes the value kinds an image dictionary holds', () => {
    expect(writeValue(new Ref(12, 0))).toBe('12 0 R');
    expect(writeValue(new Name('DeviceRGB'))).toBe('/DeviceRGB');
    expect(writeValue(42)).toBe('42');
    expect(writeValue(true)).toBe('true');
    expect(writeValue([1, new Name('X'), new Ref(3, 0)])).toBe('[1 /X 3 0 R]');
    expect(writeValue(new PdfString(Uint8Array.from([0xde, 0xad]), true))).toBe('<DEAD>');
  });

  it('round-trips through the reader', () => {
    const source = '[1 /X 3 0 R << /A 2 >>]';
    expect(writeValue(new Lexer(bytes(source)).readObject())).toBe('[1 /X 3 0 R << /A 2 >>]');
  });
});

describe('jpegImageDict', () => {
  const built = jpegImageDict(IMAGE, { width: 1600, height: 1200, byteLength: 120000 });

  it('describes the new JPEG, not the old encoding', () => {
    expect(built).toContain('/Width 1600');
    expect(built).toContain('/Height 1200');
    expect(built).toContain('/Filter /DCTDecode');
    expect(built).toContain('/ColorSpace /DeviceRGB');
    expect(built).toContain('/BitsPerComponent 8');
    expect(built).toContain('/Length 120000');
    expect(built).not.toContain('/Width 2000');
    expect(built).not.toContain('/Height 1500');
  });

  it('carries the transparency across', () => {
    // The soft mask is a separate object holding the alpha, and a viewer scales it to the
    // image — so it stays correct after the base image is made smaller.
    expect(built).toContain('/SMask 12 0 R');
  });

  it('drops entries that described the old encoding', () => {
    const old = dict(
      '<< /Subtype /Image /Width 10 /Height 10 /Filter /FlateDecode ' +
        '/DecodeParms << /Predictor 15 >> /Decode [1 0 1 0 1 0] /ColorSpace /DeviceCMYK >>',
    );
    const next = jpegImageDict(old, { width: 5, height: 5, byteLength: 99 });
    expect(next).not.toContain('DecodeParms');
    expect(next).not.toContain('/Decode ');
    expect(next).not.toContain('DeviceCMYK');
    expect(next).not.toContain('FlateDecode');
  });

  it('is a dictionary the reader accepts back', () => {
    const parsed = new Lexer(bytes(built)).readObject();
    expect(parsed).toBeInstanceOf(Map);
    expect(parsed.get('Width')).toBe(1600);
    expect(parsed.get('SMask')).toBeInstanceOf(Ref);
  });
});

describe('dictOf', () => {
  it('reads a dictionary at an offset and refuses anything else', () => {
    expect(dictOf(bytes('  << /A 1 >>'), 0).get('A')).toBe(1);
    expect(dictOf(bytes('(a string)'), 0)).toBeNull();
  });
});
