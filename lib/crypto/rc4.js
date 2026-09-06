/**
 * RC4.
 *
 * Broken as a cipher, and here only because PDFs encrypted before about 2008 use it — a file
 * someone has on disk today does not stop existing because the algorithm was retired. It is
 * used to *read* those documents. Nothing this app writes uses RC4: `protect` emits AES-256
 * only, because shipping a "Protect" button that applies known-broken crypto would be worse
 * than not shipping one.
 *
 * Symmetric, so the same function encrypts and decrypts.
 */
export function rc4(key, data) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;

  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
  }

  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
    out[n] = data[n] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}
