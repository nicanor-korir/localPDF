/**
 * AES-128 and AES-256, in CBC and ECB.
 *
 * What each is for in a PDF:
 *   - AES-128-CBC  — strings and streams in a revision-4 (`/AESV2`) document.
 *   - AES-256-CBC  — strings and streams in a revision-6 (`/AESV3`) document, and the
 *                    `/UE` / `/OE` key-unwrapping step, which uses a zero IV and no padding.
 *   - AES-128-CBC  — the inner loop of the revision-6 key-derivation hash (no padding).
 *   - AES-256-ECB  — the `/Perms` block, which is a single 16-byte AES-ECB blob.
 *
 * Not Web Crypto: `crypto.subtle` is secure-context-only, and this app is meant to run from
 * `file://` and plain-http LAN. It is also asynchronous, which the R6 hash loop would rather
 * it were not.
 *
 * The S-box is generated rather than written out, because a 256-entry literal is 256 chances
 * to typo a value that would only show up as one wrong byte in one unlucky document.
 */

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);

(function buildSbox() {
  const rotl8 = (x, s) => ((x << s) | (x >> (8 - s))) & 0xff;
  let p = 1;
  let q = 1;
  do {
    // p *= 3 in GF(2^8)
    p = (p ^ (p << 1) ^ (p & 0x80 ? 0x11b : 0)) & 0xff;
    // q /= 3 in GF(2^8)
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    const value = (q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63) & 0xff;
    SBOX[p] = value;
    INV_SBOX[value] = p;
  } while (p !== 1);
  SBOX[0] = 0x63;
  INV_SBOX[0x63] = 0;
})();

/** Multiply in GF(2^8) with the AES reducing polynomial. */
function gmul(a, b) {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) result ^= a;
    const high = a & 0x80;
    a = (a << 1) & 0xff;
    if (high) a ^= 0x1b;
    b >>= 1;
  }
  return result;
}

// Lookup tables for the MixColumns constants, so the inner loop is table reads rather than
// a bitwise multiply per byte.
const MUL = {};
for (const n of [2, 3, 9, 11, 13, 14]) {
  MUL[n] = new Uint8Array(256);
  for (let i = 0; i < 256; i++) MUL[n][i] = gmul(i, n);
}

const RCON = new Uint8Array(15);
(function buildRcon() {
  let value = 1;
  for (let i = 1; i < 15; i++) {
    RCON[i] = value;
    value = gmul(value, 2);
  }
})();

/**
 * Expand a 16- or 32-byte key into the round keys.
 * Returns a Uint8Array of 16 * (rounds + 1) bytes.
 */
export function expandKey(key) {
  const nk = key.length / 4;
  if (nk !== 4 && nk !== 8) {
    throw new Error(`AES key must be 16 or 32 bytes, got ${key.length}`);
  }
  const rounds = nk + 6;
  const total = 4 * (rounds + 1);
  const w = new Uint8Array(total * 4);
  w.set(key);

  for (let i = nk; i < total; i++) {
    let a = w[(i - 1) * 4];
    let b = w[(i - 1) * 4 + 1];
    let c = w[(i - 1) * 4 + 2];
    let d = w[(i - 1) * 4 + 3];

    if (i % nk === 0) {
      // RotWord then SubWord, then XOR the round constant.
      const t = a;
      a = SBOX[b] ^ RCON[i / nk];
      b = SBOX[c];
      c = SBOX[d];
      d = SBOX[t];
    } else if (nk > 6 && i % nk === 4) {
      a = SBOX[a];
      b = SBOX[b];
      c = SBOX[c];
      d = SBOX[d];
    }

    w[i * 4] = w[(i - nk) * 4] ^ a;
    w[i * 4 + 1] = w[(i - nk) * 4 + 1] ^ b;
    w[i * 4 + 2] = w[(i - nk) * 4 + 2] ^ c;
    w[i * 4 + 3] = w[(i - nk) * 4 + 3] ^ d;
  }
  return w;
}

const roundsFor = (roundKeys) => roundKeys.length / 16 - 1;

function addRoundKey(state, roundKeys, round) {
  const offset = round * 16;
  for (let i = 0; i < 16; i++) state[i] ^= roundKeys[offset + i];
}

// The state is column-major: byte i belongs to column i>>2, row i&3.
function shiftRows(s) {
  let t = s[1];
  s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
  t = s[2]; s[2] = s[10]; s[10] = t;
  t = s[6]; s[6] = s[14]; s[14] = t;
  t = s[15];
  s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
}

function invShiftRows(s) {
  let t = s[13];
  s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
  t = s[2]; s[2] = s[10]; s[10] = t;
  t = s[6]; s[6] = s[14]; s[14] = t;
  t = s[3];
  s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;
}

function mixColumns(s) {
  const m2 = MUL[2];
  const m3 = MUL[3];
  for (let c = 0; c < 16; c += 4) {
    const a0 = s[c];
    const a1 = s[c + 1];
    const a2 = s[c + 2];
    const a3 = s[c + 3];
    s[c] = m2[a0] ^ m3[a1] ^ a2 ^ a3;
    s[c + 1] = a0 ^ m2[a1] ^ m3[a2] ^ a3;
    s[c + 2] = a0 ^ a1 ^ m2[a2] ^ m3[a3];
    s[c + 3] = m3[a0] ^ a1 ^ a2 ^ m2[a3];
  }
}

function invMixColumns(s) {
  const m9 = MUL[9];
  const m11 = MUL[11];
  const m13 = MUL[13];
  const m14 = MUL[14];
  for (let c = 0; c < 16; c += 4) {
    const a0 = s[c];
    const a1 = s[c + 1];
    const a2 = s[c + 2];
    const a3 = s[c + 3];
    s[c] = m14[a0] ^ m11[a1] ^ m13[a2] ^ m9[a3];
    s[c + 1] = m9[a0] ^ m14[a1] ^ m11[a2] ^ m13[a3];
    s[c + 2] = m13[a0] ^ m9[a1] ^ m14[a2] ^ m11[a3];
    s[c + 3] = m11[a0] ^ m13[a1] ^ m9[a2] ^ m14[a3];
  }
}

/** Encrypt one 16-byte block in place. */
export function encryptBlock(state, roundKeys) {
  const rounds = roundsFor(roundKeys);
  addRoundKey(state, roundKeys, 0);
  for (let round = 1; round < rounds; round++) {
    for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]];
    shiftRows(state);
    mixColumns(state);
    addRoundKey(state, roundKeys, round);
  }
  for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]];
  shiftRows(state);
  addRoundKey(state, roundKeys, rounds);
}

/** Decrypt one 16-byte block in place. */
export function decryptBlock(state, roundKeys) {
  const rounds = roundsFor(roundKeys);
  addRoundKey(state, roundKeys, rounds);
  for (let round = rounds - 1; round > 0; round--) {
    invShiftRows(state);
    for (let i = 0; i < 16; i++) state[i] = INV_SBOX[state[i]];
    addRoundKey(state, roundKeys, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  for (let i = 0; i < 16; i++) state[i] = INV_SBOX[state[i]];
  addRoundKey(state, roundKeys, 0);
}

/**
 * AES-CBC encrypt.
 *
 * `pad: true` applies PKCS#7, which is what PDF string and stream encryption uses. `false` is
 * for the fixed-size internal steps — the R6 hash loop and key wrapping — where the input is
 * already a whole number of blocks and a padding block would corrupt the result.
 */
export function cbcEncrypt(key, iv, data, { pad = true } = {}) {
  const roundKeys = expandKey(key);
  const padLength = pad ? 16 - (data.length % 16) : 0;
  if (!pad && data.length % 16 !== 0) {
    throw new Error('cbcEncrypt without padding needs a whole number of blocks');
  }

  const out = new Uint8Array(data.length + padLength);
  const block = new Uint8Array(16);
  let previous = iv;

  const total = out.length;
  for (let offset = 0; offset < total; offset += 16) {
    for (let i = 0; i < 16; i++) {
      const index = offset + i;
      const byte = index < data.length ? data[index] : padLength;
      block[i] = byte ^ previous[i];
    }
    encryptBlock(block, roundKeys);
    out.set(block, offset);
    previous = out.subarray(offset, offset + 16);
  }
  return out;
}

/**
 * AES-CBC decrypt.
 *
 * Returns null rather than throwing when `pad` is on and the padding is not valid PKCS#7 —
 * that is the signal that the key was wrong, and callers treat it as "this stream could not be
 * decrypted" rather than as a crash.
 */
export function cbcDecrypt(key, iv, data, { pad = true } = {}) {
  if (data.length === 0) return new Uint8Array(0);
  if (data.length % 16 !== 0) return null;

  const roundKeys = expandKey(key);
  const out = new Uint8Array(data.length);
  const block = new Uint8Array(16);
  let previous = iv;

  for (let offset = 0; offset < data.length; offset += 16) {
    block.set(data.subarray(offset, offset + 16));
    decryptBlock(block, roundKeys);
    for (let i = 0; i < 16; i++) out[offset + i] = block[i] ^ previous[i];
    previous = data.subarray(offset, offset + 16);
  }

  if (!pad) return out;

  const padLength = out[out.length - 1];
  if (padLength < 1 || padLength > 16 || padLength > out.length) return null;
  for (let i = out.length - padLength; i < out.length; i++) {
    if (out[i] !== padLength) return null;
  }
  return out.subarray(0, out.length - padLength);
}

/** AES-ECB, single block, no padding. Used only for the `/Perms` check. */
export function ecbDecryptBlock(key, data) {
  const roundKeys = expandKey(key);
  const block = new Uint8Array(data.subarray(0, 16));
  decryptBlock(block, roundKeys);
  return block;
}

export function ecbEncryptBlock(key, data) {
  const roundKeys = expandKey(key);
  const block = new Uint8Array(data.subarray(0, 16));
  encryptBlock(block, roundKeys);
  return block;
}
