import { describe, expect, it } from 'vitest';
import { Lexer, Name, PdfString, Ref, indexOfKeyword, lastIndexOfKeyword, scanObjects } from './pdf-lexer.js';

const bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const read = (s) => new Lexer(bytes(s)).readObject();
const text = (b) => String.fromCharCode(...b);

describe('reading values', () => {
  it('reads numbers, booleans and null', () => {
    expect(read('42')).toBe(42);
    expect(read('-3.5')).toBe(-3.5);
    expect(read('true')).toBe(true);
    expect(read('false')).toBe(false);
    expect(read('null')).toBeNull();
  });

  it('reads names, including #-escapes', () => {
    expect(read('/Type')).toBeInstanceOf(Name);
    expect(read('/Type').value).toBe('Type');
    expect(read('/A#20B').value).toBe('A B');
  });

  it('reads indirect references but not bare integer pairs', () => {
    const ref = read('12 0 R');
    expect(ref).toBeInstanceOf(Ref);
    expect([ref.num, ref.gen]).toEqual([12, 0]);
    // "12 0" with no R is two numbers, and the second must still be readable.
    const lexer = new Lexer(bytes('12 0'));
    expect(lexer.readObject()).toBe(12);
    expect(lexer.readObject()).toBe(0);
  });

  it('reads literal strings with escapes, nesting and octal', () => {
    expect(text(read('(hello)').bytes)).toBe('hello');
    expect(text(read('(a\\(b\\)c)').bytes)).toBe('a(b)c');
    expect(text(read('(outer (inner) done)').bytes)).toBe('outer (inner) done');
    expect(text(read('(tab\\there)').bytes)).toBe('tab\there');
    expect(read('(\\101\\102)').bytes).toEqual(Uint8Array.from([65, 66]));
    // A backslash-newline is a line continuation and contributes nothing.
    expect(text(read('(one\\\ntwo)').bytes)).toBe('onetwo');
    // A backslash before an ordinary character is dropped, and the character stands.
    expect(text(read('(a\\Zb)').bytes)).toBe('aZb');
  });

  it('reads hex strings, ignoring whitespace and padding an odd digit', () => {
    expect(read('<48656C6C6F>').bytes).toEqual(bytes('Hello'));
    expect(read('<48 65 6C\n6C 6F>').bytes).toEqual(bytes('Hello'));
    expect(read('<4>').bytes).toEqual(Uint8Array.from([0x40]));
    expect(read('<48656C6C6F>').hex).toBe(true);
    expect(read('(Hello)').hex).toBe(false);
  });

  it('does not mistake a dictionary for a hex string', () => {
    const dict = read('<< /A 1 >>');
    expect(dict).toBeInstanceOf(Map);
    expect(dict.get('A')).toBe(1);
  });

  it('reads nested dictionaries and arrays', () => {
    const dict = read('<< /Kids [1 0 R 2 0 R] /Sub << /N 3 >> /S (x) >>');
    expect(dict.get('Kids').map((r) => r.num)).toEqual([1, 2]);
    expect(dict.get('Sub').get('N')).toBe(3);
    expect(dict.get('S')).toBeInstanceOf(PdfString);
  });

  it('skips comments', () => {
    const dict = read('<< % a comment with /Fake 9\n /A 1 >>');
    expect(dict.get('A')).toBe(1);
    expect(dict.has('Fake')).toBe(false);
  });

  it('terminates on malformed input instead of spinning', () => {
    // Each of these used to be a candidate for an infinite loop.
    for (const source of ['<< /A', '[1 2', '(unterminated', '<abc', '>>', ']', '<< >> >>']) {
      const lexer = new Lexer(bytes(source));
      const before = Date.now();
      for (let i = 0; i < 50 && lexer.pos < lexer.length; i++) lexer.readObject();
      expect(Date.now() - before, source).toBeLessThan(1000);
    }
  });
});

describe('scanObjects', () => {
  const file = `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 1 >>
endobj
12 3 obj
(a string)
endobj
trailer
<< /Root 1 0 R >>
`;

  it('finds every object with its number and generation', () => {
    const objects = scanObjects(bytes(file));
    expect([...objects.keys()].sort((a, b) => a - b)).toEqual([1, 2, 12]);
    expect(objects.get(12).gen).toBe(3);
  });

  it('gives a body range that covers the object and stops before endobj', () => {
    const raw = bytes(file);
    const entry = scanObjects(raw).get(2);
    const body = text(raw.subarray(entry.bodyStart, entry.bodyEnd));
    expect(body.trim()).toBe('<< /Type /Pages /Count 1 >>');
  });

  it('is not fooled by the word "obj" inside other tokens', () => {
    const objects = scanObjects(bytes('1 0 obj\n<< /Sub /MyObject /X 9 0 objx >>\nendobj\n'));
    expect([...objects.keys()]).toEqual([1]);
  });

  it('does not treat a number glued to a preceding token as an object number', () => {
    const objects = scanObjects(bytes('/Name99 0 obj\n'));
    expect(objects.size).toBe(0);
  });

  it('lets a later definition of the same object win, as an incremental update does', () => {
    const raw = bytes('1 0 obj\n(first)\nendobj\n1 0 obj\n(second)\nendobj\n');
    const entry = scanObjects(raw).get(1);
    expect(text(raw.subarray(entry.bodyStart, entry.bodyEnd))).toContain('second');
  });

  it('copes with a missing endobj by stopping at the next object', () => {
    const raw = bytes('1 0 obj\n(a)\n2 0 obj\n(b)\nendobj\n');
    const objects = scanObjects(raw);
    expect(objects.size).toBe(2);
    expect(text(raw.subarray(objects.get(1).bodyStart, objects.get(1).bodyEnd))).toContain('(a)');
  });
});

describe('keyword search', () => {
  it('finds forwards and backwards', () => {
    const raw = bytes('aa trailer bb trailer cc');
    expect(indexOfKeyword(raw, 'trailer')).toBe(3);
    expect(lastIndexOfKeyword(raw, 'trailer')).toBe(14);
    expect(indexOfKeyword(raw, 'missing')).toBe(-1);
    expect(lastIndexOfKeyword(raw, 'missing')).toBe(-1);
  });

  it('respects the search bounds', () => {
    const raw = bytes('aa trailer bb');
    expect(indexOfKeyword(raw, 'trailer', 4)).toBe(-1);
    expect(indexOfKeyword(raw, 'trailer', 0, 9)).toBe(-1);
  });
});
