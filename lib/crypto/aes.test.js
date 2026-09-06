import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cbcDecrypt, cbcEncrypt, ecbDecryptBlock, ecbEncryptBlock, encryptBlock, expandKey } from './aes.js';

const hex = (b) => Buffer.from(b).toString('hex');
const fromHex = (s) => new Uint8Array(Buffer.from(s, 'hex'));

describe('AES block cipher', () => {
  it('matches the FIPS-197 AES-128 example vector', () => {
    const key = fromHex('000102030405060708090a0b0c0d0e0f');
    const block = fromHex('00112233445566778899aabbccddeeff');
    encryptBlock(block, expandKey(key));
    expect(hex(block)).toBe('69c4e0d86a7b0430d8cdb78070b4c55a');
  });

  it('matches the FIPS-197 AES-256 example vector', () => {
    const key = fromHex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
    const block = fromHex('00112233445566778899aabbccddeeff');
    encryptBlock(block, expandKey(key));
    expect(hex(block)).toBe('8ea2b7ca516745bfeafc49904b496089');
  });

  it('refuses a key length AES does not have', () => {
    expect(() => expandKey(new Uint8Array(24))).toThrow(/16 or 32/);
    expect(() => expandKey(new Uint8Array(5))).toThrow(/16 or 32/);
  });
});

describe('AES-CBC against node:crypto', () => {
  for (const [label, keyLength, algo] of [
    ['AES-128', 16, 'aes-128-cbc'],
    ['AES-256', 32, 'aes-256-cbc'],
  ]) {
    it(`${label} encrypts to the same bytes node does, across every padding case`, () => {
      const key = randomBytes(keyLength);
      const iv = randomBytes(16);
      // 0 and 16 both produce a full extra padding block, which is the case implementations
      // most often get wrong.
      for (const n of [0, 1, 15, 16, 17, 31, 32, 33, 100, 1024]) {
        const data = randomBytes(n);
        const cipher = createCipheriv(algo, key, iv);
        const expected = Buffer.concat([cipher.update(data), cipher.final()]);
        const ours = cbcEncrypt(new Uint8Array(key), new Uint8Array(iv), new Uint8Array(data));
        expect(hex(ours), `${label} length ${n}`).toBe(expected.toString('hex'));
      }
    });

    it(`${label} decrypts what node encrypted`, () => {
      const key = randomBytes(keyLength);
      const iv = randomBytes(16);
      for (const n of [0, 1, 16, 17, 255, 4096]) {
        const data = randomBytes(n);
        const cipher = createCipheriv(algo, key, iv);
        const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
        const ours = cbcDecrypt(new Uint8Array(key), new Uint8Array(iv), new Uint8Array(encrypted));
        expect(hex(ours), `${label} length ${n}`).toBe(data.toString('hex'));
      }
    });

    it(`${label} produces bytes node can decrypt`, () => {
      const key = randomBytes(keyLength);
      const iv = randomBytes(16);
      const data = randomBytes(500);
      const ours = cbcEncrypt(new Uint8Array(key), new Uint8Array(iv), new Uint8Array(data));
      const decipher = createDecipheriv(algo, key, iv);
      const back = Buffer.concat([decipher.update(Buffer.from(ours)), decipher.final()]);
      expect(back.toString('hex')).toBe(data.toString('hex'));
    });
  }
});

describe('AES-CBC without padding', () => {
  it('round-trips whole blocks untouched, which is what key unwrapping needs', () => {
    const key = new Uint8Array(randomBytes(32));
    const iv = new Uint8Array(16); // /UE and /OE are unwrapped with a zero IV
    const data = new Uint8Array(randomBytes(32));
    const encrypted = cbcEncrypt(key, iv, data, { pad: false });
    expect(encrypted.length).toBe(32);
    expect(hex(cbcDecrypt(key, iv, encrypted, { pad: false }))).toBe(hex(data));
  });

  it('refuses a partial block rather than silently padding', () => {
    expect(() => cbcEncrypt(new Uint8Array(16), new Uint8Array(16), new Uint8Array(5), { pad: false }))
      .toThrow(/whole number of blocks/);
  });
});

describe('AES-CBC with a wrong key', () => {
  it('returns null rather than throwing, so a bad password reads as a failed decrypt', () => {
    const data = new Uint8Array(randomBytes(64));
    const encrypted = cbcEncrypt(new Uint8Array(randomBytes(32)), new Uint8Array(16), data);
    // Try enough wrong keys that a chance-valid padding byte cannot make this flaky.
    let nulls = 0;
    for (let i = 0; i < 40; i++) {
      if (cbcDecrypt(new Uint8Array(randomBytes(32)), new Uint8Array(16), encrypted) === null) nulls++;
    }
    expect(nulls).toBeGreaterThan(30);
  });

  it('returns null for a length that is not a whole number of blocks', () => {
    expect(cbcDecrypt(new Uint8Array(16), new Uint8Array(16), new Uint8Array(7))).toBeNull();
  });
});

describe('AES-ECB single block', () => {
  it('agrees with node on the /Perms-sized block', () => {
    const key = randomBytes(32);
    const data = randomBytes(16);
    const cipher = createCipheriv('aes-256-ecb', key, null);
    cipher.setAutoPadding(false);
    const expected = Buffer.concat([cipher.update(data), cipher.final()]);
    expect(hex(ecbEncryptBlock(new Uint8Array(key), new Uint8Array(data)))).toBe(expected.toString('hex'));
    expect(hex(ecbDecryptBlock(new Uint8Array(key), new Uint8Array(expected)))).toBe(data.toString('hex'));
  });
});
