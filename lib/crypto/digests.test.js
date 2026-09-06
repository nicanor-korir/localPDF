import { createHash, createCipheriv } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { md5 } from './md5.js';
import { rc4 } from './rc4.js';
import { sha256, sha384, sha512 } from './sha2.js';

const hex = (bytes) => Buffer.from(bytes).toString('hex');
const bytes = (s) => new TextEncoder().encode(s);
const nodeHash = (algo, data) => createHash(algo).update(Buffer.from(data)).digest('hex');

// Sizes chosen to straddle every block/padding boundary these implementations have:
// empty, short, exactly one block, one byte under and over, and multi-block.
const SIZES = [0, 1, 3, 55, 56, 63, 64, 65, 111, 112, 119, 128, 129, 200, 1000, 4096];
const sample = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);

describe('md5', () => {
  it('matches the published vectors', () => {
    expect(hex(md5(bytes('')))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(hex(md5(bytes('abc')))).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  it('agrees with node:crypto across every padding boundary', () => {
    for (const n of SIZES) expect(hex(md5(sample(n))), `length ${n}`).toBe(nodeHash('md5', sample(n)));
  });
});

describe('sha256', () => {
  it('matches the published vector', () => {
    expect(hex(sha256(bytes('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('agrees with node:crypto across every padding boundary', () => {
    for (const n of SIZES) {
      expect(hex(sha256(sample(n))), `length ${n}`).toBe(nodeHash('sha256', sample(n)));
    }
  });
});

describe('sha512 and sha384', () => {
  it('matches the published vectors', () => {
    expect(hex(sha512(bytes('abc')))).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
        '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
    expect(hex(sha384(bytes('abc')))).toBe(
      'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed' +
        '8086072ba1e7cc2358baeca134c825a7',
    );
  });

  it('agrees with node:crypto across every padding boundary', () => {
    for (const n of SIZES) {
      expect(hex(sha512(sample(n))), `sha512 length ${n}`).toBe(nodeHash('sha512', sample(n)));
      expect(hex(sha384(sample(n))), `sha384 length ${n}`).toBe(nodeHash('sha384', sample(n)));
    }
  });
});

describe('rc4', () => {
  it('matches the published test vectors', () => {
    expect(hex(rc4(bytes('Key'), bytes('Plaintext')))).toBe('bbf316e8d940af0ad3');
    expect(hex(rc4(bytes('Secret'), bytes('Attack at dawn')))).toBe('45a01f645fc35b383552544b9bf5');
  });

  it('is its own inverse', () => {
    const key = sample(16);
    const data = sample(300);
    expect(hex(rc4(key, rc4(key, data)))).toBe(hex(data));
  });
});
