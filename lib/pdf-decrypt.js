/**
 * Remove encryption from a PDF, producing a file any reader can open.
 *
 * ## Why this is written by hand
 *
 * No JavaScript PDF library will do it. pdf.js decrypts, but only into its own in-memory model
 * — it cannot write the result back out, and its `extractPages()` re-encrypts encrypted input
 * into a file that cannot be reopened (measured; see docs/ROADMAP.md). pdf-lib can write
 * anything but cannot decrypt, and its `ignoreEncryption` option opens an encrypted file
 * *without* decrypting it, so the pages copy as unreadable rubbish rather than failing loudly.
 *
 * pdf-lib is also no good as a front end here: it expands `/ObjStm` object streams eagerly at
 * load, and an encrypted one inflates to noise and takes the whole load down with it. Acrobat
 * writes object streams as a matter of course, so that is the common case, not an edge case.
 *
 * ## What this does and does not do
 *
 * It removes protection from a document the user can already open — either because it is only
 * owner-restricted (no password needed to read it, which is most "protected" PDFs in
 * circulation) or because they supplied the password. **It is not a password cracker and must
 * not become one.** There is no guessing, no wordlist, no brute force; a wrong password is
 * reported as wrong and that is the end of it.
 */

import {
  UnreadablePdf,
  concat,
  nameOf,
  pdfVersion,
  readTrailer,
  resolve,
  rewriteObjects,
  scanObjects,
  serialise,
  textOf,
  toHexString,
} from './pdf-rewrite.js';
import { PdfString, Ref } from './pdf-lexer.js';
import {
  CFM_AES128,
  CFM_AES256,
  CFM_NONE,
  CFM_RC4,
  PasswordRequired,
  UnsupportedEncryption,
  WrongPassword,
  authenticate,
  decryptBytes,
  permsAgree,
} from './pdf-security.js';

export { PasswordRequired, UnreadablePdf, UnsupportedEncryption, WrongPassword };

/** The document carries no encryption, so there is nothing to remove. */
export class NotEncrypted extends Error {
  constructor() {
    super('This PDF is not password-protected or restricted.');
    this.name = 'NotEncrypted';
  }
}

/**
 * Normalise the /Encrypt dictionary into the flat shape pdf-security.js works with.
 *
 * The crypt-filter indirection (/CF, /StmF, /StrF) exists only for /V 4 and /V 5; earlier
 * versions are always RC4 with the key length given by /Length.
 */
function readEncryptDict(dict, idFirst, bytes, objects) {
  const version = Number(resolve(dict.get('V'), bytes, objects) ?? 0);
  const revision = Number(resolve(dict.get('R'), bytes, objects) ?? 0);
  const lengthBits = Number(resolve(dict.get('Length'), bytes, objects) ?? 40);
  const o = resolve(dict.get('O'), bytes, objects);
  const u = resolve(dict.get('U'), bytes, objects);
  const oe = resolve(dict.get('OE'), bytes, objects);
  const ue = resolve(dict.get('UE'), bytes, objects);
  const perms = resolve(dict.get('Perms'), bytes, objects);
  const p = Number(resolve(dict.get('P'), bytes, objects) ?? 0);
  const encryptMetadata = resolve(dict.get('EncryptMetadata'), bytes, objects);

  if (!(o instanceof PdfString) || !(u instanceof PdfString)) {
    throw new UnsupportedEncryption('its /O or /U entry is missing');
  }

  let streamCipher = CFM_RC4;
  let stringCipher = CFM_RC4;

  if (version >= 4) {
    const cf = resolve(dict.get('CF'), bytes, objects);
    const cfmFor = (which) => {
      const filterName = nameOf(resolve(dict.get(which), bytes, objects));
      if (!filterName || filterName === 'Identity') return CFM_NONE;
      const filter = cf instanceof Map ? resolve(cf.get(filterName), bytes, objects) : null;
      const cfm = filter instanceof Map ? nameOf(resolve(filter.get('CFM'), bytes, objects)) : null;
      if (cfm === 'AESV2') return CFM_AES128;
      if (cfm === 'AESV3') return CFM_AES256;
      if (cfm === 'V2') return CFM_RC4;
      if (cfm === 'None' || cfm === null) return CFM_NONE;
      throw new UnsupportedEncryption(`crypt filter method ${cfm}`);
    };
    streamCipher = cfmFor('StmF');
    stringCipher = cfmFor('StrF');
  }

  return {
    filter: nameOf(resolve(dict.get('Filter'), bytes, objects)) ?? 'Standard',
    version,
    revision,
    // /Length is in bits; every internal use wants bytes.
    keyLength: version === 5 ? 32 : Math.max(5, Math.floor(lengthBits / 8)),
    o: o.bytes,
    u: u.bytes,
    oe: oe instanceof PdfString ? oe.bytes : null,
    ue: ue instanceof PdfString ? ue.bytes : null,
    perms: perms instanceof PdfString ? perms.bytes : null,
    p,
    encryptMetadata: encryptMetadata === undefined || encryptMetadata === null ? true : !!encryptMetadata,
    idFirst,
    streamCipher,
    stringCipher,
  };
}

function loadEncrypt(bytes, objects, trailer) {
  const dict = resolve(trailer.encrypt, bytes, objects);
  if (!(dict instanceof Map)) throw new UnsupportedEncryption('its /Encrypt entry is unreadable');

  let idFirst = new Uint8Array(0);
  if (Array.isArray(trailer.id) && trailer.id[0] instanceof PdfString) idFirst = trailer.id[0].bytes;
  return readEncryptDict(dict, idFirst, bytes, objects);
}

export function describeAlgorithm(encrypt) {
  if (encrypt.revision >= 5) return 'AES-256';
  if (encrypt.streamCipher === CFM_AES128) return 'AES-128';
  return `RC4 ${encrypt.keyLength * 8}-bit`;
}

// Bit positions are 1-based in the specification; bit 3 is the low bit of the byte.
const PERMISSION_BITS = [
  [3, 'print'],
  [4, 'modify'],
  [5, 'copy'],
  [6, 'annotate'],
  [9, 'fillForms'],
  [10, 'extractForAccessibility'],
  [11, 'assemble'],
  [12, 'printHighQuality'],
];

/** Decode /P into named permissions. A set bit means allowed. */
export function describePermissions(p) {
  const flags = {};
  for (const [bit, name] of PERMISSION_BITS) flags[name] = ((p >> (bit - 1)) & 1) === 1;
  return flags;
}

/**
 * What kind of protection a file carries, without needing the password.
 *
 * Lets the UI say "this needs a password" or "this only has restrictions" *before* asking for
 * one, rather than making the user guess which situation they are in.
 */
export function inspectPdf(bytes) {
  const objects = scanObjects(bytes);
  if (objects.size === 0) throw new UnreadablePdf('no objects found');

  const trailer = readTrailer(bytes, objects);
  if (!trailer.encrypt) return { encrypted: false };

  const encrypt = loadEncrypt(bytes, objects, trailer);

  // An owner-restricted document opens with the empty password; a user-password one does not.
  let needsPassword = true;
  try {
    authenticate(encrypt, '');
    needsPassword = false;
  } catch (err) {
    if (!(err instanceof PasswordRequired)) throw err;
  }

  return {
    encrypted: true,
    needsPassword,
    revision: encrypt.revision,
    algorithm: describeAlgorithm(encrypt),
    permissions: describePermissions(encrypt.p),
  };
}

/**
 * Decrypt `bytes` with `password`, returning a PDF with no encryption at all.
 *
 * Throws NotEncrypted, PasswordRequired, WrongPassword, UnsupportedEncryption or UnreadablePdf,
 * each of which the UI turns into a sentence the user can act on.
 */
export async function decryptPdf(bytes, password = '') {
  const objects = scanObjects(bytes);
  if (objects.size === 0) throw new UnreadablePdf('no objects found');

  const trailer = readTrailer(bytes, objects);
  if (!trailer.encrypt) throw new NotEncrypted();

  const encrypt = loadEncrypt(bytes, objects, trailer);
  const { key, isOwner } = authenticate(encrypt, password);
  const encryptObjectNum = trailer.encrypt instanceof Ref ? trailer.encrypt.num : -1;

  const written = await rewriteObjects(bytes, objects, {
    skip: (entry, type) =>
      // The /Encrypt dictionary describes encryption the output will not have, and
      // cross-reference streams are rebuilt from scratch. Neither is ever encrypted itself.
      entry.num === encryptObjectNum || type === 'XRef',
    transformString: (data, num, gen) => decryptBytes(data, key, num, gen, encrypt.stringCipher),
    transformStream: (data, num, gen, type) =>
      // A metadata stream is left in the clear when /EncryptMetadata is false, so decrypting
      // it would turn readable XML into noise.
      !encrypt.encryptMetadata && type === 'Metadata'
        ? data
        : decryptBytes(data, key, num, gen, encrypt.streamCipher),
  });

  if (written.length === 0) throw new UnreadablePdf('nothing decrypted');

  let trailerParts = '';
  if (trailer.root instanceof Ref) trailerParts += ` /Root ${trailer.root.num} 0 R`;
  if (trailer.info instanceof Ref) trailerParts += ` /Info ${trailer.info.num} 0 R`;
  if (Array.isArray(trailer.id) && trailer.id.every((part) => part instanceof PdfString)) {
    trailerParts += ` /ID [${trailer.id.map((part) => textOf(toHexString(part.bytes))).join(' ')}]`;
  }
  if (!trailerParts.includes('/Root')) throw new UnreadablePdf('no document catalogue');

  return {
    bytes: serialise(pdfVersion(bytes), written, trailerParts),
    isOwner,
    algorithm: describeAlgorithm(encrypt),
    permissions: describePermissions(encrypt.p),
    permissionsVerified: permsAgree(encrypt, key),
  };
}

export { concat };
