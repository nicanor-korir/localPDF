import { describe, expect, it } from 'vitest';
import {
  MIN_SIZE,
  addImage,
  addRedaction,
  addText,
  clampBox,
  colourOf,
  groupOverlays,
  isEncodable,
  overlaysForPage,
  reconcileOverlays,
  redactedPageIds,
  redactionsForPage,
  removeOverlay,
  setBox,
  toWritableText,
  unwritableCharacters,
  updateOverlay,
} from './overlays.js';

const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 };

describe('clampBox', () => {
  it('keeps a box inside the page', () => {
    expect(clampBox({ x: 0.9, y: 0.9, width: 0.4, height: 0.4 })).toEqual({
      x: 0.6, y: 0.6, width: 0.4, height: 0.4,
    });
    expect(clampBox({ x: -0.5, y: -0.5, width: 0.2, height: 0.2 })).toMatchObject({ x: 0, y: 0 });
  });

  it('never lets a box collapse to nothing', () => {
    const tiny = clampBox({ x: 0.5, y: 0.5, width: 0, height: -1 });
    expect(tiny.width).toBe(MIN_SIZE);
    expect(tiny.height).toBe(MIN_SIZE);
  });

  it('caps a box at the whole page', () => {
    expect(clampBox({ x: 0, y: 0, width: 5, height: 5 })).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
});

describe('adding overlays', () => {
  it('adds text with an id and the defaults', () => {
    const [only] = addText([], 'p1', box, { text: 'Hello' });
    expect(only).toMatchObject({ pageId: 'p1', type: 'text', text: 'Hello', ...box });
    expect(only.id).toBeTruthy();
    expect(only.size).toBeGreaterThan(0);
  });

  it('adds an image pointing at a source file', () => {
    const [only] = addImage([], 'p1', box, 'file-7');
    expect(only).toMatchObject({ type: 'image', fileId: 'file-7' });
  });

  it('gives every overlay a distinct id', () => {
    let list = [];
    for (let i = 0; i < 5; i++) list = addText(list, 'p1', box);
    expect(new Set(list.map((o) => o.id)).size).toBe(5);
  });
});

describe('setBox', () => {
  const list = addText([], 'p1', box, { text: 'x' });

  it('moves an overlay', () => {
    const moved = setBox(list, list[0].id, { ...box, x: 0.5 });
    expect(moved[0].x).toBe(0.5);
    expect(moved).not.toBe(list);
  });

  it('returns the same array when nothing moved, so undo has nothing to record', () => {
    expect(setBox(list, list[0].id, box)).toBe(list);
  });

  it('returns the same array for an overlay that is not there', () => {
    expect(setBox(list, 'missing', { ...box, x: 0.9 })).toBe(list);
  });

  it('clamps as it moves', () => {
    expect(setBox(list, list[0].id, { ...box, x: 5 })[0].x).toBeLessThanOrEqual(1);
  });
});

describe('updateOverlay', () => {
  const list = addText([], 'p1', box, { text: 'before', size: 14 });

  it('changes the text', () => {
    expect(updateOverlay(list, list[0].id, { text: 'after' })[0].text).toBe('after');
  });

  it('returns the same array when the value is already that', () => {
    expect(updateOverlay(list, list[0].id, { text: 'before', size: 14 })).toBe(list);
  });

  it('returns the same array for an overlay that is not there', () => {
    expect(updateOverlay(list, 'missing', { text: 'x' })).toBe(list);
  });
});

describe('removeOverlay', () => {
  const list = addText([], 'p1', box);

  it('removes one', () => {
    expect(removeOverlay(list, list[0].id)).toHaveLength(0);
  });

  it('returns the same array when there was nothing to remove', () => {
    expect(removeOverlay(list, 'missing')).toBe(list);
  });
});

describe('reconcileOverlays', () => {
  it('drops overlays whose page has gone', () => {
    // Deleting a page has to take what was written on it, or the writing reattaches itself to
    // whatever page inherits the id.
    const list = [...addText([], 'p1', box), ...addText([], 'p2', box)];
    const kept = reconcileOverlays(list, [{ id: 'p1' }]);
    expect(kept).toHaveLength(1);
    expect(kept[0].pageId).toBe('p1');
  });

  it('returns the same array when every page is still there', () => {
    const list = addText([], 'p1', box);
    expect(reconcileOverlays(list, [{ id: 'p1' }, { id: 'p2' }])).toBe(list);
  });

  it('returns the same array when there are no overlays at all', () => {
    const empty = [];
    expect(reconcileOverlays(empty, [])).toBe(empty);
  });
});

describe('grouping', () => {
  const list = [...addText([], 'p1', box), ...addText([], 'p2', box), ...addText([], 'p1', box)];

  it('collects overlays by page, in order', () => {
    const grouped = groupOverlays(list);
    expect(grouped.get('p1')).toHaveLength(2);
    expect(grouped.get('p2')).toHaveLength(1);
    expect(grouped.has('p3')).toBe(false);
  });

  it('is empty for a document with none, so the merge pays nothing', () => {
    expect(groupOverlays([]).size).toBe(0);
  });

  it('filters for one page', () => {
    expect(overlaysForPage(list, 'p2')).toHaveLength(1);
  });
});

describe('what the built-in fonts can write', () => {
  it('accepts ASCII and Latin-1', () => {
    // An em dash is WinAnsi too, so the only thing here that cannot be written is the arrow.
    expect(unwritableCharacters('Hello, world! café — naïve → so')).toEqual(['→']);
    expect(isEncodable('é')).toBe(true);
    expect(isEncodable('£')).toBe(true);
  });

  it('accepts the WinAnsi extras people actually type', () => {
    // Curly quotes and an em dash come out of every word processor.
    expect(unwritableCharacters('“quoted” — it’s fine •')).toEqual([]);
    expect(isEncodable('€')).toBe(true);
  });

  it('names what it cannot write, once each and in order', () => {
    expect(unwritableCharacters('日本語 日')).toEqual(['日', '本', '語']);
    expect(unwritableCharacters('a → b ← c')).toEqual(['→', '←']);
  });

  it('is happy with an empty or missing string', () => {
    expect(unwritableCharacters('')).toEqual([]);
    expect(unwritableCharacters(undefined)).toEqual([]);
  });

  it('substitutes rather than dropping, so nothing vanishes without a trace', () => {
    expect(toWritableText('a日b')).toBe('a?b');
    expect(toWritableText('plain')).toBe('plain');
  });
});

describe('colours', () => {
  it('falls back rather than throwing on an unknown name', () => {
    expect(colourOf('nonsense').id).toBe('black');
    expect(colourOf('red').rgb).toEqual([0.8, 0.1, 0.1]);
  });
});

describe('redactions', () => {
  it('carries no styling at all', () => {
    // A redaction is not a black rectangle you can configure; it is a promise that what was
    // underneath is gone. A colour or opacity setting would invite making that promise false.
    const [only] = addRedaction([], 'p1', box);
    expect(only).toEqual({ id: only.id, pageId: 'p1', type: 'redaction', ...box });
  });

  it('picks out the pages that carry one', () => {
    const list = [
      ...addRedaction([], 'p1', box),
      ...addText([], 'p2', box, { text: 'not a redaction' }),
      ...addRedaction([], 'p3', box),
    ];
    expect([...redactedPageIds(list)].sort()).toEqual(['p1', 'p3']);
    expect(redactionsForPage(list, 'p1')).toHaveLength(1);
    expect(redactionsForPage(list, 'p2')).toHaveLength(0);
  });

  it('is empty for a document with none', () => {
    expect(redactedPageIds(addText([], 'p1', box)).size).toBe(0);
  });

  it('goes through the same undo and reconciliation as everything else', () => {
    const list = addRedaction([], 'p1', box);
    expect(setBox(list, list[0].id, box)).toBe(list);
    expect(reconcileOverlays(list, [{ id: 'other' }])).toHaveLength(0);
  });
});
