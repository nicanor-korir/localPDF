/**
 * Add password protection to a PDF.
 *
 * **AES-256 (revision 6) only.** The specification still allows RC4 and AES-128, and
 * `pdf-decrypt.js` reads both because documents encrypted years ago exist and people need to
 * open them. Writing them is a different question: a "Protect" button that applies
 * known-broken encryption gives the user a false belief about their document, which is worse
 * than no button. So there is deliberately no algorithm choice here.
 *
 * The document is encrypted at the byte level, in place, the same way `pdf-decrypt.js` removes
 * it: only strings and stream data change, and everything else is copied through untouched.
 *
 * ISO 32000-2 §7.6.4 — Algorithms 8, 9 and 10.
 */

import {
  UnreadablePdf,
  concat,
  pdfVersion,
  readTrailer,
  rewriteObjects,
  scanObjects,
  serialise,
  textOf,
  toHexString,
} from './pdf-rewrite.js';
import { PdfString, Ref } from './pdf-lexer.js';
import {
  CFM_AES256,
  encryptBytes,
  hash2B,
  randomBytes,
} from './pdf-security.js';
import { cbcEncrypt, ecbEncryptBlock } from './crypto/aes.js';

/** The input is already encrypted; it has to be unlocked before it can be re-protected. */
export class AlreadyEncrypted extends Error {
  constructor() {
    super('This PDF is already protected. Unlock it first, then protect it again.');
    this.name = 'AlreadyEncrypted';
  }
}

/**
 * The permission flags a protected document can carry, in /P bit order.
 *
 * Worth being honest about what these are: **permissions are advisory.** They are recorded in
 * the file and every well-behaved reader obeys them, but nothing enforces them — anyone with
 * the document and a determined tool can ignore them. A password, on the other hand, really
 * does keep the content unreadable. The UI says so rather than implying otherwise.
 */
export const PERMISSION_FLAGS = [
  { id: 'print', bit: 3, label: 'Printing' },
  { id: 'modify', bit: 4, label: 'Changing the document' },
  { id: 'copy', bit: 5, label: 'Copying text and images' },
  { id: 'annotate', bit: 6, label: 'Adding comments and annotations' },
  { id: 'fillForms', bit: 9, label: 'Filling in form fields' },
  { id: 'extractForAccessibility', bit: 10, label: 'Extracting for accessibility' },
  { id: 'assemble', bit: 11, label: 'Assembling pages' },
  { id: 'printHighQuality', bit: 12, label: 'High-quality printing' },
];

/** Everything allowed — the default, because protection should mean a password, not a nuisance. */
export const ALL_ALLOWED = Object.fromEntries(PERMISSION_FLAGS.map((flag) => [flag.id, true]));

/**
 * Build the /P value.
 *
 * Bits 1 and 2 are reserved and must be 0; every other reserved bit must be 1. Getting the
 * reserved bits wrong makes readers treat the whole value as untrustworthy.
 */
export function buildPermissions(allowed = ALL_ALLOWED) {
  let p = 0xfffffffc; // all ones, with bits 1 and 2 cleared
  for (const flag of PERMISSION_FLAGS) {
    if (!allowed[flag.id]) p &= ~(1 << (flag.bit - 1));
  }
  return p | 0; // /P is a signed 32-bit integer
}

const EMPTY = new Uint8Array(0);
const ZERO_IV = new Uint8Array(16);

/**
 * Algorithms 8 and 9: build /U, /UE, /O and /OE around a freshly generated file key.
 *
 * `random` is injectable so tests can be deterministic. Nothing else should pass it.
 */
export function buildSecurityDictionary({
  userPassword = '',
  ownerPassword = '',
  permissions = ALL_ALLOWED,
  encryptMetadata = true,
  random = randomBytes,
} = {}) {
  const fileKey = random(32);
  const encode = (password) => new TextEncoder().encode(String(password ?? '')).subarray(0, 127);
  const user = encode(userPassword);
  // An owner password that is not set falls back to the user password, which is what makes
  // "no owner password" mean "the user password is the only one".
  const owner = encode(ownerPassword || userPassword);

  // Algorithm 8 — the user key.
  const userValidationSalt = random(8);
  const userKeySalt = random(8);
  const u = concat([
    hash2B(user, userValidationSalt, EMPTY, 6),
    userValidationSalt,
    userKeySalt,
  ]);
  const ue = cbcEncrypt(hash2B(user, userKeySalt, EMPTY, 6), ZERO_IV, fileKey, { pad: false });

  // Algorithm 9 — the owner key, which is bound to /U so the two cannot be mixed and matched.
  const ownerValidationSalt = random(8);
  const ownerKeySalt = random(8);
  const o = concat([
    hash2B(owner, ownerValidationSalt, u, 6),
    ownerValidationSalt,
    ownerKeySalt,
  ]);
  const oe = cbcEncrypt(hash2B(owner, ownerKeySalt, u, 6), ZERO_IV, fileKey, { pad: false });

  // Algorithm 10 — /Perms ties the permission flags to the file key, so editing /P by hand in
  // a hex editor no longer silently works.
  const p = buildPermissions(permissions);
  const permsBlock = new Uint8Array(16);
  new DataView(permsBlock.buffer).setInt32(0, p, true);
  permsBlock.set([0xff, 0xff, 0xff, 0xff], 4);
  permsBlock[8] = encryptMetadata ? 0x54 : 0x46; // 'T' or 'F'
  permsBlock.set([0x61, 0x64, 0x62], 9); // "adb"
  permsBlock.set(random(4), 12);
  const perms = ecbEncryptBlock(fileKey, permsBlock);

  return { fileKey, u, ue, o, oe, perms, p, encryptMetadata };
}

function encryptDictionary({ u, ue, o, oe, perms, p, encryptMetadata }) {
  const hex = (bytes) => textOf(toHexString(bytes));
  return (
    '<< /Filter /Standard /V 5 /R 6 /Length 256\n' +
    '   /CF << /StdCF << /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >>\n' +
    '   /StmF /StdCF /StrF /StdCF\n' +
    `   /P ${p}\n` +
    `   /EncryptMetadata ${encryptMetadata ? 'true' : 'false'}\n` +
    `   /O ${hex(o)}\n` +
    `   /U ${hex(u)}\n` +
    `   /OE ${hex(oe)}\n` +
    `   /UE ${hex(ue)}\n` +
    `   /Perms ${hex(perms)} >>`
  );
}

/**
 * Protect `bytes` with AES-256.
 *
 * `userPassword` is the one needed to open the document; leave it empty to produce a document
 * that opens freely but carries permission restrictions. `ownerPassword` lifts those
 * restrictions; if it is not given, the user password serves as both.
 */
export async function encryptPdf(bytes, options = {}) {
  const objects = scanObjects(bytes);
  if (objects.size === 0) throw new UnreadablePdf('no objects found');

  const trailer = readTrailer(bytes, objects);
  if (trailer.encrypt) throw new AlreadyEncrypted();

  const security = buildSecurityDictionary(options);
  const { fileKey } = security;

  // AES-256 uses the file key for every object, so the object and generation numbers passed
  // here are ignored — they are kept in the signature only because RC4 and AES-128 need them.
  const written = await rewriteObjects(bytes, objects, {
    // An object stream here is plaintext: expand it first, then encrypt the members as
    // ordinary objects. See rewriteObjects for why the order matters.
    objectStreamOrder: 'expand-then-transform',
    skip: (entry, type) => type === 'XRef',
    transformString: (data, num, gen) => encryptBytes(data, fileKey, num, gen, CFM_AES256),
    transformStream: (data, num, gen, type) =>
      !security.encryptMetadata && type === 'Metadata'
        ? data
        : encryptBytes(data, fileKey, num, gen, CFM_AES256),
  });

  if (written.length === 0) throw new UnreadablePdf('nothing to protect');

  // The /Encrypt dictionary itself is never encrypted, and needs an object number of its own.
  const encryptNum = written.reduce((max, entry) => Math.max(max, entry.num), 0) + 1;
  written.push({
    num: encryptNum,
    body: Uint8Array.from(encryptDictionary(security), (c) => c.charCodeAt(0)),
  });

  // /ID is not used by revision 6's key derivation, but readers expect it. The first half is
  // meant to be stable for the life of a document, so an existing one is kept.
  const existingId =
    Array.isArray(trailer.id) && trailer.id[0] instanceof PdfString ? trailer.id[0].bytes : null;
  const idFirst = existingId && existingId.length > 0 ? existingId : randomBytes(16);

  let trailerParts = '';
  if (trailer.root instanceof Ref) trailerParts += ` /Root ${trailer.root.num} 0 R`;
  if (trailer.info instanceof Ref) trailerParts += ` /Info ${trailer.info.num} 0 R`;
  trailerParts += ` /Encrypt ${encryptNum} 0 R`;
  trailerParts += ` /ID [${textOf(toHexString(idFirst))} ${textOf(toHexString(randomBytes(16)))}]`;
  if (!trailerParts.includes('/Root')) throw new UnreadablePdf('no document catalogue');

  return {
    bytes: serialise(pdfVersion(bytes), written, trailerParts),
    algorithm: 'AES-256',
    permissions: options.permissions ?? ALL_ALLOWED,
    hasUserPassword: String(options.userPassword ?? '') !== '',
  };
}
