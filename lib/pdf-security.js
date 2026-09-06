/**
 * PDF's standard security handler: turning a password into the file encryption key, and using
 * that key on strings and streams.
 *
 * Covers revisions 2 through 6 — RC4-40, RC4-128, AES-128 and AES-256 — because a document
 * someone has on disk today does not stop existing when an algorithm is retired. What this app
 * *writes* is a separate decision, and it writes AES-256 (revision 6) only.
 *
 * Specified in ISO 32000-1 §7.6 (revisions 2-4) and ISO 32000-2 §7.6.4 (revisions 5-6). The
 * algorithm numbers in the comments below are that specification's.
 *
 * Pure and DOM-free: it takes a plain description of the /Encrypt dictionary, so the whole
 * thing runs under Vitest in Node against real encrypted files.
 */

import { cbcDecrypt, cbcEncrypt, ecbDecryptBlock, ecbEncryptBlock } from './crypto/aes.js';
import { md5 } from './crypto/md5.js';
import { rc4 } from './crypto/rc4.js';
import { sha256, sha384, sha512 } from './crypto/sha2.js';

/** The document is encrypted and needs a password we were not given. */
export class PasswordRequired extends Error {
  constructor() {
    super('This PDF needs a password to open.');
    this.name = 'PasswordRequired';
  }
}

/** A password was supplied and it was not the right one. */
export class WrongPassword extends Error {
  constructor() {
    super('That password did not work.');
    this.name = 'WrongPassword';
  }
}

/** Encrypted in a way this app does not implement — a custom handler, or a future revision. */
export class UnsupportedEncryption extends Error {
  constructor(detail) {
    super(`This PDF uses encryption this app cannot read (${detail}).`);
    this.name = 'UnsupportedEncryption';
  }
}

// The 32-byte padding string from Algorithm 2. Every revision-2-to-4 password is padded or
// truncated to 32 bytes with it, which is why an empty password is not the same as no password.
export const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

export const CFM_NONE = 'None';
export const CFM_RC4 = 'V2';
export const CFM_AES128 = 'AESV2';
export const CFM_AES256 = 'AESV3';

const concat = (...parts) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const equal = (a, b, length = a.length) => {
  if (a.length < length || b.length < length) return false;
  let diff = 0;
  for (let i = 0; i < length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

const int32le = (value) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, value | 0, true);
  return out;
};

/** Pad or truncate to the 32 bytes Algorithm 2 wants. */
function padPassword(bytes) {
  const out = new Uint8Array(32);
  const used = Math.min(bytes.length, 32);
  out.set(bytes.subarray(0, used));
  out.set(PAD.subarray(0, 32 - used), used);
  return out;
}

/**
 * Encode a password the way the revision expects.
 *
 * Revisions 2-4 use PDFDocEncoding, which agrees with Latin-1 over everything a password
 * realistically contains. Revisions 5-6 use UTF-8, truncated to 127 bytes.
 *
 * SASLprep normalisation (RFC 4013), which revision 6 also specifies, is not applied: it only
 * changes passwords containing non-ASCII whitespace or unassigned code points, and getting it
 * subtly wrong would reject correct passwords. If a document ever fails to open with a password
 * that is definitely right, this is the first place to look.
 */
export function encodePassword(password, revision) {
  const text = String(password ?? '');
  if (revision >= 5) {
    return new TextEncoder().encode(text).subarray(0, 127);
  }
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

// --- Revisions 2 to 4 -------------------------------------------------------------------

/** Algorithm 2: the file encryption key from the (already padded) user password. */
function fileKeyLegacy(encrypt, paddedPassword) {
  const { revision, keyLength, o, p, idFirst, encryptMetadata } = encrypt;
  const parts = [paddedPassword, o.subarray(0, 32), int32le(p), idFirst];
  if (revision >= 4 && !encryptMetadata) {
    parts.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
  }

  let hash = md5(concat(...parts));
  const n = revision === 2 ? 5 : keyLength;
  if (revision >= 3) {
    for (let i = 0; i < 50; i++) hash = md5(hash.subarray(0, n));
  }
  return hash.subarray(0, n);
}

/** Algorithms 4 and 5: what /U should contain for this key. */
function expectedU(encrypt, key) {
  if (encrypt.revision === 2) return rc4(key, PAD);

  let x = rc4(key, md5(concat(PAD, encrypt.idFirst)));
  const shifted = new Uint8Array(key.length);
  for (let i = 1; i <= 19; i++) {
    for (let j = 0; j < key.length; j++) shifted[j] = key[j] ^ i;
    x = rc4(shifted, x);
  }
  return x; // 16 bytes; only the first 16 of /U are meaningful for revisions 3 and 4
}

function checkUserLegacy(encrypt, passwordBytes) {
  const key = fileKeyLegacy(encrypt, padPassword(passwordBytes));
  const compareLength = encrypt.revision === 2 ? 32 : 16;
  return equal(expectedU(encrypt, key), encrypt.u, compareLength) ? key : null;
}

/** Algorithm 7: recover the user password from the owner password. */
function userPasswordFromOwner(encrypt, ownerBytes) {
  let hash = md5(padPassword(ownerBytes));
  const n = encrypt.revision === 2 ? 5 : encrypt.keyLength;
  if (encrypt.revision >= 3) {
    for (let i = 0; i < 50; i++) hash = md5(hash);
  }
  const rc4Key = hash.subarray(0, n);

  if (encrypt.revision === 2) return rc4(rc4Key, encrypt.o.subarray(0, 32));

  let x = encrypt.o.subarray(0, 32);
  const shifted = new Uint8Array(n);
  for (let i = 19; i >= 0; i--) {
    for (let j = 0; j < n; j++) shifted[j] = rc4Key[j] ^ i;
    x = rc4(shifted, x);
  }
  return x;
}

// --- Revisions 5 and 6 ------------------------------------------------------------------

/**
 * Algorithm 2.B: the revision-6 hash.
 *
 * Deliberately expensive — 64 or more rounds, each AES-encrypting 64 copies of the running
 * state — so that guessing passwords costs something. Revision 5 was an Adobe extension that
 * used a single SHA-256 and is superseded; it is still read here because files carrying it
 * exist.
 */
function hash2B(password, salt, userData, revision) {
  let k = sha256(concat(password, salt, userData));
  if (revision === 5) return k;

  let round = 0;
  let e = null;
  for (;;) {
    const block = concat(password, k, userData);
    const k1 = new Uint8Array(block.length * 64);
    for (let i = 0; i < 64; i++) k1.set(block, i * block.length);

    e = cbcEncrypt(k.subarray(0, 16), k.subarray(16, 32), k1, { pad: false });

    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i];
    const mod = sum % 3;
    k = mod === 0 ? sha256(e) : mod === 1 ? sha384(e) : sha512(e);

    round++;
    // The loop runs at least 64 times, then until the last byte of E is small enough.
    if (round >= 64 && e[e.length - 1] <= round - 32) break;
  }
  return k.subarray(0, 32);
}

function checkAes256(encrypt, passwordBytes) {
  const { u, o, ue, oe, revision } = encrypt;

  // Owner first: an owner password also opens the document, and checking it first means a
  // document where both are the same still reports the stronger of the two.
  if (o.length >= 48 && oe && oe.length >= 32) {
    const validationSalt = o.subarray(32, 40);
    const keySalt = o.subarray(40, 48);
    const uData = u.subarray(0, 48);
    if (equal(hash2B(passwordBytes, validationSalt, uData, revision), o, 32)) {
      const intermediate = hash2B(passwordBytes, keySalt, uData, revision);
      const key = cbcDecrypt(intermediate, new Uint8Array(16), oe.subarray(0, 32), { pad: false });
      if (key) return { key, isOwner: true };
    }
  }

  if (u.length >= 48 && ue && ue.length >= 32) {
    const validationSalt = u.subarray(32, 40);
    const keySalt = u.subarray(40, 48);
    const empty = new Uint8Array(0);
    if (equal(hash2B(passwordBytes, validationSalt, empty, revision), u, 32)) {
      const intermediate = hash2B(passwordBytes, keySalt, empty, revision);
      const key = cbcDecrypt(intermediate, new Uint8Array(16), ue.subarray(0, 32), { pad: false });
      if (key) return { key, isOwner: false };
    }
  }

  return null;
}

/**
 * Check the /Perms block, which revision 6 uses to bind the permission flags to the file key.
 *
 * A mismatch means the file key is wrong or /P has been tampered with. It is a diagnostic, not
 * a gate: a file that decrypts correctly but has a damaged /Perms is still readable, and
 * refusing it would help nobody.
 */
export function permsAgree(encrypt, key) {
  if (encrypt.revision < 5 || !encrypt.perms || encrypt.perms.length < 16) return true;
  const plain = ecbDecryptBlock(key, encrypt.perms);
  if (plain[9] !== 0x61 || plain[10] !== 0x64 || plain[11] !== 0x62) return false; // "adb"
  const p = new DataView(plain.buffer, plain.byteOffset).getInt32(0, true);
  const metadataFlag = plain[8] === 0x54; // 'T'
  return p === (encrypt.p | 0) && metadataFlag === !!encrypt.encryptMetadata;
}

// --- Public entry points ----------------------------------------------------------------

/**
 * Work out the file encryption key for `password`.
 *
 * Throws PasswordRequired when the document needs one and the empty password does not work —
 * which is the common, benign case of an owner-restricted PDF being the *other* case: those
 * open with the empty password and only the permissions are set.
 *
 * @returns {{ key: Uint8Array, isOwner: boolean, streamCipher: string, stringCipher: string }}
 */
export function authenticate(encrypt, password = '') {
  if (encrypt.filter && encrypt.filter !== 'Standard') {
    throw new UnsupportedEncryption(`the ${encrypt.filter} security handler`);
  }
  if (![1, 2, 4, 5].includes(encrypt.version)) {
    throw new UnsupportedEncryption(`/V ${encrypt.version}`);
  }
  if (![2, 3, 4, 5, 6].includes(encrypt.revision)) {
    throw new UnsupportedEncryption(`/R ${encrypt.revision}`);
  }

  const supplied = encodePassword(password, encrypt.revision);
  const found = encrypt.revision >= 5 ? authenticateAes256(encrypt, supplied) : authenticateLegacy(encrypt, supplied);

  if (!found) {
    // An empty password that fails means the document is genuinely locked; a non-empty one
    // that fails means the user typed the wrong thing. Saying which is the difference between
    // a useful prompt and a dead end.
    throw String(password ?? '') === '' ? new PasswordRequired() : new WrongPassword();
  }

  return {
    ...found,
    streamCipher: encrypt.streamCipher,
    stringCipher: encrypt.stringCipher,
  };
}

function authenticateAes256(encrypt, supplied) {
  const found = checkAes256(encrypt, supplied);
  if (!found) return null;
  return found;
}

function authenticateLegacy(encrypt, supplied) {
  // The owner password is tried first: it also opens the document, and someone who typed it
  // should be told they have owner access rather than being silently downgraded.
  const asUser = userPasswordFromOwner(encrypt, supplied);
  const ownerKey = checkUserLegacy(encrypt, asUser);
  if (ownerKey) return { key: ownerKey, isOwner: true };

  const userKey = checkUserLegacy(encrypt, supplied);
  if (userKey) return { key: userKey, isOwner: false };

  return null;
}

/**
 * Algorithm 1: the key for one object's strings or streams.
 *
 * AES-256 skips this entirely — every object uses the file key directly, which is why a
 * revision-6 document can be decrypted without knowing which object a stream came from.
 */
export function objectKey(fileKey, num, gen, cfm) {
  if (cfm === CFM_AES256) return fileKey;

  const extra = cfm === CFM_AES128 ? 4 : 0;
  const input = new Uint8Array(fileKey.length + 5 + extra);
  input.set(fileKey);
  input[fileKey.length] = num & 0xff;
  input[fileKey.length + 1] = (num >> 8) & 0xff;
  input[fileKey.length + 2] = (num >> 16) & 0xff;
  input[fileKey.length + 3] = gen & 0xff;
  input[fileKey.length + 4] = (gen >> 8) & 0xff;
  if (extra) input.set([0x73, 0x41, 0x6c, 0x54], fileKey.length + 5); // "sAlT"

  return md5(input).subarray(0, Math.min(fileKey.length + 5, 16));
}

/** Decrypt one string or stream. Returns null when the bytes cannot be decrypted with this key. */
export function decryptBytes(data, fileKey, num, gen, cfm) {
  if (cfm === CFM_NONE) return data;
  const key = objectKey(fileKey, num, gen, cfm);
  if (cfm === CFM_RC4) return rc4(key, data);
  // AES: the first 16 bytes are the initialisation vector.
  if (data.length < 16) return new Uint8Array(0);
  return cbcDecrypt(key, data.subarray(0, 16), data.subarray(16));
}

/** Encrypt one string or stream. `iv` is injectable so tests can be deterministic. */
export function encryptBytes(data, fileKey, num, gen, cfm, iv) {
  if (cfm === CFM_NONE) return data;
  const key = objectKey(fileKey, num, gen, cfm);
  if (cfm === CFM_RC4) return rc4(key, data);
  const vector = iv || randomBytes(16);
  return concat(vector, cbcEncrypt(key, vector, data));
}

/**
 * Random bytes for IVs, salts and keys.
 *
 * `crypto.getRandomValues` is available in every context this app runs in, including
 * `file://` — unlike `crypto.randomUUID` and `crypto.subtle`, which are secure-context only.
 * There is deliberately no Math.random fallback: silently generating a predictable key would
 * be far worse than refusing to protect the document at all.
 */
export function randomBytes(length) {
  const source = globalThis.crypto;
  if (!source?.getRandomValues) {
    throw new Error('This browser cannot generate secure random numbers, so it cannot protect a PDF.');
  }
  return source.getRandomValues(new Uint8Array(length));
}

export { hash2B, fileKeyLegacy, expectedU, userPasswordFromOwner, padPassword };
