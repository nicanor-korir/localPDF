import { describe, expect, it } from 'vitest';
import { samplesToRgba, targetSize } from './recode-image.js';

describe('targetSize', () => {
  it('caps the longest side and keeps the shape', () => {
    expect(targetSize(3000, 2000, 1500)).toEqual({ width: 1500, height: 1000, scale: 0.5 });
    expect(targetSize(2000, 3000, 1500)).toEqual({ width: 1000, height: 1500, scale: 0.5 });
  });

  it('never enlarges', () => {
    // Making a small image bigger would cost bytes and add nothing.
    expect(targetSize(400, 300, 1600)).toEqual({ width: 400, height: 300, scale: 1 });
  });

  it('never rounds a dimension to zero, which would throw on a canvas', () => {
    const tiny = targetSize(1000, 1, 10);
    expect(tiny.width).toBe(10);
    expect(tiny.height).toBe(1);
  });
});

describe('samplesToRgba', () => {
  it('expands grey to RGBA, opaque', () => {
    const rgba = samplesToRgba(Uint8Array.from([0, 128, 255, 64]), 2, 2, 1);
    expect([...rgba.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...rgba.slice(4, 8)]).toEqual([128, 128, 128, 255]);
  });

  it('copies RGB across and fills in the alpha', () => {
    const rgba = samplesToRgba(Uint8Array.from([10, 20, 30, 40, 50, 60]), 2, 1, 3);
    expect([...rgba]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it('refuses samples that are too short rather than reading past the end', () => {
    // A truncated stream would otherwise paint whatever happened to be in memory.
    expect(samplesToRgba(Uint8Array.from([1, 2, 3]), 4, 4, 3)).toBeNull();
  });
});
