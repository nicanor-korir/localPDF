/**
 * SHA-256, SHA-384 and SHA-512.
 *
 * Needed by the AES-256 security handler (revision 6): its key-derivation loop picks between
 * the three based on the running digest, so all three have to be here.
 *
 * Not Web Crypto, deliberately. `crypto.subtle` exists only in secure contexts, and this app is
 * meant to run from `file://` and plain-http LAN — the same reason `generateId()` does not call
 * `crypto.randomUUID()` directly. It is also synchronous here, which the R6 loop wants.
 *
 * SHA-384/512 work on 64-bit words, held as high/low 32-bit pairs rather than BigInt: the R6
 * loop hashes about 400 KB across its rounds, and BigInt makes that visibly slow.
 */

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr32 = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

export function sha256(input) {
  const message = input instanceof Uint8Array ? input : new Uint8Array(input);
  const bitLength = message.length * 8;
  const padded = new Uint8Array(((message.length + 8) >> 6 << 6) + 64);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, H[i]);
  return out;
}

// --- SHA-512 / SHA-384 -----------------------------------------------------------------
// 64-bit words as [high, low] pairs of 32-bit halves.

const K512 = [
  '428a2f98d728ae22', '7137449123ef65cd', 'b5c0fbcfec4d3b2f', 'e9b5dba58189dbbc',
  '3956c25bf348b538', '59f111f1b605d019', '923f82a4af194f9b', 'ab1c5ed5da6d8118',
  'd807aa98a3030242', '12835b0145706fbe', '243185be4ee4b28c', '550c7dc3d5ffb4e2',
  '72be5d74f27b896f', '80deb1fe3b1696b1', '9bdc06a725c71235', 'c19bf174cf692694',
  'e49b69c19ef14ad2', 'efbe4786384f25e3', '0fc19dc68b8cd5b5', '240ca1cc77ac9c65',
  '2de92c6f592b0275', '4a7484aa6ea6e483', '5cb0a9dcbd41fbd4', '76f988da831153b5',
  '983e5152ee66dfab', 'a831c66d2db43210', 'b00327c898fb213f', 'bf597fc7beef0ee4',
  'c6e00bf33da88fc2', 'd5a79147930aa725', '06ca6351e003826f', '142929670a0e6e70',
  '27b70a8546d22ffc', '2e1b21385c26c926', '4d2c6dfc5ac42aed', '53380d139d95b3df',
  '650a73548baf63de', '766a0abb3c77b2a8', '81c2c92e47edaee6', '92722c851482353b',
  'a2bfe8a14cf10364', 'a81a664bbc423001', 'c24b8b70d0f89791', 'c76c51a30654be30',
  'd192e819d6ef5218', 'd69906245565a910', 'f40e35855771202a', '106aa07032bbd1b8',
  '19a4c116b8d2d0c8', '1e376c085141ab53', '2748774cdf8eeb99', '34b0bcb5e19b48a8',
  '391c0cb3c5c95a63', '4ed8aa4ae3418acb', '5b9cca4f7763e373', '682e6ff3d6b2b8a3',
  '748f82ee5defb2fc', '78a5636f43172f60', '84c87814a1f0ab72', '8cc702081a6439ec',
  '90befffa23631e28', 'a4506cebde82bde9', 'bef9a3f7b2c67915', 'c67178f2e372532b',
  'ca273eceea26619c', 'd186b8c721c0c207', 'eada7dd6cde0eb1e', 'f57d4f7fee6ed178',
  '06f067aa72176fba', '0a637dc5a2c898a6', '113f9804bef90dae', '1b710b35131c471b',
  '28db77f523047d84', '32caab7b40c72493', '3c9ebe0a15c9bebc', '431d67c49c100d4c',
  '4cc5d4becb3e42b6', '597f299cfc657e2a', '5fcb6fab3ad6faec', '6c44198c4a475817',
].map((hex) => [Number.parseInt(hex.slice(0, 8), 16), Number.parseInt(hex.slice(8), 16)]);

const IV512 = [
  '6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1',
  '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179',
];
const IV384 = [
  'cbbb9d5dc1059ed8', '629a292a367cd507', '9159015a3070dd17', '152fecd8f70e5939',
  '67332667ffc00b31', '8eb44a8768581511', 'db0c2e0d64f98fa7', '47b5481dbefa4fa4',
];
const toWords = (list) =>
  list.map((hex) => [Number.parseInt(hex.slice(0, 8), 16), Number.parseInt(hex.slice(8), 16)]);

function sha512Core(input, iv, outBytes) {
  const message = input instanceof Uint8Array ? input : new Uint8Array(input);
  const bitLength = message.length * 8;
  // Pad to 112 mod 128, then a 16-byte big-endian bit length (the top 8 bytes are always 0
  // for any input this app will ever see).
  const padded = new Uint8Array(((message.length + 16) >> 7 << 7) + 128);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const H = toWords(iv);
  const wHi = new Int32Array(80);
  const wLo = new Int32Array(80);

  for (let offset = 0; offset < padded.length; offset += 128) {
    for (let i = 0; i < 16; i++) {
      wHi[i] = view.getUint32(offset + i * 8) | 0;
      wLo[i] = view.getUint32(offset + i * 8 + 4) | 0;
    }
    for (let i = 16; i < 80; i++) {
      // s0 = ROTR1 ^ ROTR8 ^ SHR7 of w[i-15]
      const h15 = wHi[i - 15];
      const l15 = wLo[i - 15];
      const s0hi = ((h15 >>> 1) | (l15 << 31)) ^ ((h15 >>> 8) | (l15 << 24)) ^ (h15 >>> 7);
      const s0lo = ((l15 >>> 1) | (h15 << 31)) ^ ((l15 >>> 8) | (h15 << 24)) ^ ((l15 >>> 7) | (h15 << 25));
      // s1 = ROTR19 ^ ROTR61 ^ SHR6 of w[i-2]
      const h2 = wHi[i - 2];
      const l2 = wLo[i - 2];
      const s1hi = ((h2 >>> 19) | (l2 << 13)) ^ ((l2 >>> 29) | (h2 << 3)) ^ (h2 >>> 6);
      const s1lo = ((l2 >>> 19) | (h2 << 13)) ^ ((h2 >>> 29) | (l2 << 3)) ^ ((l2 >>> 6) | (h2 << 26));

      let lo = (wLo[i - 16] >>> 0) + (s0lo >>> 0);
      let hi = (wHi[i - 16] >>> 0) + (s0hi >>> 0) + Math.floor(lo / 0x100000000);
      lo = (lo >>> 0) + (wLo[i - 7] >>> 0);
      hi = hi + (wHi[i - 7] >>> 0) + Math.floor(lo / 0x100000000);
      lo = (lo >>> 0) + (s1lo >>> 0);
      hi = hi + (s1hi >>> 0) + Math.floor(lo / 0x100000000);
      wLo[i] = lo | 0;
      wHi[i] = hi | 0;
    }

    let [aH, aL] = H[0];
    let [bH, bL] = H[1];
    let [cH, cL] = H[2];
    let [dH, dL] = H[3];
    let [eH, eL] = H[4];
    let [fH, fL] = H[5];
    let [gH, gL] = H[6];
    let [hH, hL] = H[7];

    for (let i = 0; i < 80; i++) {
      const S1hi = ((eH >>> 14) | (eL << 18)) ^ ((eH >>> 18) | (eL << 14)) ^ ((eL >>> 9) | (eH << 23));
      const S1lo = ((eL >>> 14) | (eH << 18)) ^ ((eL >>> 18) | (eH << 14)) ^ ((eH >>> 9) | (eL << 23));
      const chHi = (eH & fH) ^ (~eH & gH);
      const chLo = (eL & fL) ^ (~eL & gL);
      const S0hi = ((aH >>> 28) | (aL << 4)) ^ ((aL >>> 2) | (aH << 30)) ^ ((aL >>> 7) | (aH << 25));
      const S0lo = ((aL >>> 28) | (aH << 4)) ^ ((aH >>> 2) | (aL << 30)) ^ ((aH >>> 7) | (aL << 25));
      const majHi = (aH & bH) ^ (aH & cH) ^ (bH & cH);
      const majLo = (aL & bL) ^ (aL & cL) ^ (bL & cL);

      let t1lo = (hL >>> 0) + (S1lo >>> 0);
      let t1hi = (hH >>> 0) + (S1hi >>> 0) + Math.floor(t1lo / 0x100000000);
      t1lo = (t1lo >>> 0) + (chLo >>> 0);
      t1hi = t1hi + (chHi >>> 0) + Math.floor(t1lo / 0x100000000);
      t1lo = (t1lo >>> 0) + K512[i][1];
      t1hi = t1hi + K512[i][0] + Math.floor(t1lo / 0x100000000);
      t1lo = (t1lo >>> 0) + (wLo[i] >>> 0);
      t1hi = t1hi + (wHi[i] >>> 0) + Math.floor(t1lo / 0x100000000);
      t1lo = t1lo >>> 0;
      t1hi = t1hi >>> 0;

      let t2lo = (S0lo >>> 0) + (majLo >>> 0);
      let t2hi = (S0hi >>> 0) + (majHi >>> 0) + Math.floor(t2lo / 0x100000000);
      t2lo = t2lo >>> 0;
      t2hi = t2hi >>> 0;

      hH = gH; hL = gL;
      gH = fH; gL = fL;
      fH = eH; fL = eL;
      let lo = (dL >>> 0) + t1lo;
      eH = ((dH >>> 0) + t1hi + Math.floor(lo / 0x100000000)) | 0;
      eL = lo | 0;
      dH = cH; dL = cL;
      cH = bH; cL = bL;
      bH = aH; bL = aL;
      lo = t1lo + t2lo;
      aH = (t1hi + t2hi + Math.floor(lo / 0x100000000)) | 0;
      aL = lo | 0;
    }

    const add = (idx, hi, lo) => {
      const l = (H[idx][1] >>> 0) + (lo >>> 0);
      H[idx][0] = ((H[idx][0] >>> 0) + (hi >>> 0) + Math.floor(l / 0x100000000)) | 0;
      H[idx][1] = l | 0;
    };
    add(0, aH, aL); add(1, bH, bL); add(2, cH, cL); add(3, dH, dL);
    add(4, eH, eL); add(5, fH, fL); add(6, gH, gL); add(7, hH, hL);
  }

  const out = new Uint8Array(64);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    outView.setUint32(i * 8, H[i][0] >>> 0);
    outView.setUint32(i * 8 + 4, H[i][1] >>> 0);
  }
  return out.subarray(0, outBytes);
}

export function sha512(input) {
  return sha512Core(input, IV512, 64);
}

export function sha384(input) {
  return sha512Core(input, IV384, 48);
}
