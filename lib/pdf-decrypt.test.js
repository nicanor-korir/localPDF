import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  NotEncrypted,
  PasswordRequired,
  UnreadablePdf,
  WrongPassword,
  decryptPdf,
  describePermissions,
  inspectPdf,
} from './pdf-decrypt.js';

// Written by pypdf + cryptography, not by us — see scripts/generate-crypto-fixtures.py. A
// decryptor tested only against its own encryptor proves the two agree, not that either is
// right.
const fixture = (name) =>
  new Uint8Array(readFileSync(new URL(`./__fixtures__/encrypted/${name}`, import.meta.url)));

/**
 * Read a decrypted file with pdf.js — Mozilla's implementation, not ours.
 *
 * This is the assertion that matters. Stripping /Encrypt from a file whose streams are still
 * ciphertext would satisfy "pdf-lib opens it" and produce a document of blank pages; only
 * pulling real text back out proves the streams were genuinely decrypted.
 */
async function textOfEveryPage(bytes) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      pages.push(content.items.map((item) => item.str).join(' '));
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

const OPEN_PASSWORD = 'open123';
const OWNER_PASSWORD = 'owner456';

// Every fixture is the same three-page document, so the same assertions apply to all of them.
const VARIANTS = [
  ['enc-rc4-40.pdf', 'RC4 40-bit', OPEN_PASSWORD, true],
  ['enc-rc4-128.pdf', 'RC4 128-bit', OPEN_PASSWORD, true],
  ['enc-aes-128.pdf', 'AES-128', OPEN_PASSWORD, true],
  ['enc-aes-256.pdf', 'AES-256', OPEN_PASSWORD, true],
  ['enc-owner-only-rc4128.pdf', 'RC4 128-bit', '', false],
  ['enc-owner-only-aes128.pdf', 'AES-128', '', false],
];

describe('inspectPdf', () => {
  it('reports a plain document as unencrypted', () => {
    expect(inspectPdf(fixture('base.pdf'))).toEqual({ encrypted: false });
  });

  it.each(VARIANTS)('describes %s without needing the password', (name, algorithm, _pw, needsPassword) => {
    const info = inspectPdf(fixture(name));
    expect(info.encrypted).toBe(true);
    expect(info.algorithm).toBe(algorithm);
    // The distinction the UI is built on: a user-password document cannot be opened at all,
    // an owner-restricted one opens fine and only the permissions are set.
    expect(info.needsPassword).toBe(needsPassword);
  });

  it('reports the restrictions the fixtures were built with', () => {
    const { permissions } = inspectPdf(fixture('enc-aes-128.pdf'));
    expect(permissions.print).toBe(false);
    expect(permissions.copy).toBe(false);
    expect(permissions.modify).toBe(false);
  });

  it('refuses a file that is not a PDF', () => {
    expect(() => inspectPdf(new Uint8Array([1, 2, 3, 4]))).toThrow(UnreadablePdf);
  });
});

describe('decryptPdf', () => {
  it.each(VARIANTS)('unlocks %s into a file with no encryption left', async (name, algorithm, password) => {
    const result = await decryptPdf(fixture(name), password);
    expect(result.algorithm).toBe(algorithm);

    // The real assertion: pdf-lib opens it with no ignoreEncryption escape hatch, which it
    // cannot do for a file that is still encrypted.
    const doc = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(doc.isEncrypted).toBe(false);
    expect(doc.getPageCount()).toBe(3);
    expect(new TextDecoder('latin1').decode(result.bytes)).not.toContain('/Encrypt');
  });

  it.each(VARIANTS)('recovers the page text from %s', async (name, _algorithm, password) => {
    const { bytes } = await decryptPdf(fixture(name), password);
    const pages = await textOfEveryPage(bytes);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain('CONFIDENTIAL PAGE 1');
    expect(pages[1]).toContain('CONFIDENTIAL PAGE 2');
    expect(pages[2]).toContain('CONFIDENTIAL PAGE 3');
    expect(pages[0]).toContain('12,345.67');
  });

  it('keeps the document metadata, which lives in encrypted strings', async () => {
    const { bytes } = await decryptPdf(fixture('enc-aes-256.pdf'), OPEN_PASSWORD);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getTitle()).toBe('Quarterly Statement');
    expect(doc.getAuthor()).toBe('Nicanor');
  });

  it('keeps the link annotations, whose URL lives in an encrypted string', async () => {
    const { bytes } = await decryptPdf(fixture('enc-aes-128.pdf'), OPEN_PASSWORD);
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
    try {
      const doc = await task.promise;
      const annotations = await (await doc.getPage(1)).getAnnotations();
      expect(annotations.map((a) => a.url)).toContain('https://example.com/policy');
    } finally {
      await task.destroy();
    }
  });

  it('opens a user-password document with the owner password too, and says so', async () => {
    const asUser = await decryptPdf(fixture('enc-aes-128.pdf'), OPEN_PASSWORD);
    const asOwner = await decryptPdf(fixture('enc-aes-128.pdf'), OWNER_PASSWORD);
    expect(asUser.isOwner).toBe(false);
    expect(asOwner.isOwner).toBe(true);
    const doc = await PDFDocument.load(asOwner.bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(3);
  });

  it.each([['enc-rc4-128.pdf'], ['enc-aes-256.pdf']])(
    'tells an empty password apart from a wrong one for %s',
    async (name) => {
      await expect(decryptPdf(fixture(name), '')).rejects.toBeInstanceOf(PasswordRequired);
      await expect(decryptPdf(fixture(name), 'nope')).rejects.toBeInstanceOf(WrongPassword);
    },
  );

  it('refuses a document that was never encrypted rather than rewriting it', async () => {
    await expect(decryptPdf(fixture('base.pdf'))).rejects.toBeInstanceOf(NotEncrypted);
  });

  it('confirms the permission block against the recovered key on AES-256', async () => {
    const result = await decryptPdf(fixture('enc-aes-256.pdf'), OPEN_PASSWORD);
    // /Perms binds /P to the file key. Agreement is strong evidence the key is genuinely right.
    expect(result.permissionsVerified).toBe(true);
  });

  it('drops the restrictions along with the encryption', async () => {
    const before = inspectPdf(fixture('enc-owner-only-aes128.pdf'));
    expect(before.permissions.print).toBe(false);
    const { bytes } = await decryptPdf(fixture('enc-owner-only-aes128.pdf'), '');
    // No /Encrypt means no /P, so nothing is restricted any more.
    expect(inspectPdf(bytes)).toEqual({ encrypted: false });
  });
});

describe('describePermissions', () => {
  it('reads a set bit as allowed', () => {
    // -1 is every bit set: everything permitted.
    const all = describePermissions(-1);
    expect(Object.values(all).every(Boolean)).toBe(true);
  });

  it('reads print and copy from their specified bit positions', () => {
    expect(describePermissions(0b100).print).toBe(true);
    expect(describePermissions(0b100).copy).toBe(false);
    expect(describePermissions(0b10000).copy).toBe(true);
  });
});
