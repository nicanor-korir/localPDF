import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  ALL_ALLOWED,
  AlreadyEncrypted,
  buildPermissions,
  buildSecurityDictionary,
  encryptPdf,
} from './pdf-encrypt.js';
import { decryptPdf, describePermissions, inspectPdf } from './pdf-decrypt.js';

const fixture = (name) =>
  new Uint8Array(readFileSync(new URL(`./__fixtures__/encrypted/${name}`, import.meta.url)));

/**
 * Open a document with pdf.js — Mozilla's security handler, not ours.
 *
 * This is what makes the encryption tests worth anything. A round-trip through our own
 * decryptor would only prove the two halves agree with each other; it would pass just as
 * happily if both were wrong in the same way.
 */
async function openWithPdfjs(bytes, password) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), password, verbosity: 0 });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      pages.push(content.items.map((item) => item.str).join(' '));
    }
    return { pages, permissions: await doc.getPermissions() };
  } finally {
    await task.destroy();
  }
}

describe('buildPermissions', () => {
  it('sets the reserved bits the specification demands', () => {
    const p = buildPermissions(ALL_ALLOWED);
    // Bits 1 and 2 must be zero; every other reserved bit must be one.
    expect(p & 0b11).toBe(0);
    expect((p >> 6) & 0b11).toBe(0b11);
    expect(p >>> 12).toBe(0xfffff);
  });

  it('clears exactly the flag that was denied', () => {
    const denied = buildPermissions({ ...ALL_ALLOWED, print: false });
    expect(describePermissions(denied).print).toBe(false);
    expect(describePermissions(denied).copy).toBe(true);
    expect(describePermissions(buildPermissions(ALL_ALLOWED)).print).toBe(true);
  });

  it('round-trips through the decoder for every single-flag denial', () => {
    for (const id of Object.keys(ALL_ALLOWED)) {
      const flags = describePermissions(buildPermissions({ ...ALL_ALLOWED, [id]: false }));
      expect(flags[id], id).toBe(false);
      const others = Object.entries(flags).filter(([key]) => key !== id);
      expect(others.every(([, value]) => value), id).toBe(true);
    }
  });
});

describe('buildSecurityDictionary', () => {
  it('produces the field sizes the specification fixes', () => {
    const s = buildSecurityDictionary({ userPassword: 'x', random: (n) => new Uint8Array(n).fill(7) });
    expect(s.fileKey).toHaveLength(32);
    expect(s.u).toHaveLength(48);
    expect(s.o).toHaveLength(48);
    expect(s.ue).toHaveLength(32);
    expect(s.oe).toHaveLength(32);
    expect(s.perms).toHaveLength(16);
  });

  it('never reuses a file key', () => {
    const keys = new Set();
    for (let i = 0; i < 5; i++) {
      keys.add(Buffer.from(buildSecurityDictionary({ userPassword: 'x' }).fileKey).toString('hex'));
    }
    expect(keys.size).toBe(5);
  });
});

describe('encryptPdf', () => {
  it('produces a document pdf.js will not open without the password', async () => {
    const { bytes } = await encryptPdf(fixture('base.pdf'), { userPassword: 'hunter2' });

    await expect(openWithPdfjs(bytes)).rejects.toMatchObject({ name: 'PasswordException' });
    await expect(openWithPdfjs(bytes, 'wrong')).rejects.toMatchObject({ name: 'PasswordException' });

    const { pages } = await openWithPdfjs(bytes, 'hunter2');
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain('CONFIDENTIAL PAGE 1');
  });

  it('opens with the owner password as well as the user one', async () => {
    const { bytes } = await encryptPdf(fixture('base.pdf'), {
      userPassword: 'open-me',
      ownerPassword: 'the-owner',
    });
    expect((await openWithPdfjs(bytes, 'open-me')).pages[0]).toContain('CONFIDENTIAL PAGE 1');
    expect((await openWithPdfjs(bytes, 'the-owner')).pages[0]).toContain('CONFIDENTIAL PAGE 1');
  });

  it('can restrict a document that still opens without a password', async () => {
    const { bytes } = await encryptPdf(fixture('base.pdf'), {
      ownerPassword: 'the-owner',
      permissions: { ...ALL_ALLOWED, print: false, copy: false },
    });

    // No user password, so it opens with no prompt...
    const { pages, permissions } = await openWithPdfjs(bytes);
    expect(pages[0]).toContain('CONFIDENTIAL PAGE 1');
    // ...but pdf.js reports the restrictions, which is how a reader learns about them.
    expect(permissions).not.toBeNull();

    const info = inspectPdf(bytes);
    expect(info.needsPassword).toBe(false);
    expect(info.permissions.print).toBe(false);
    expect(info.permissions.copy).toBe(false);
    expect(info.permissions.annotate).toBe(true);
  });

  it('announces itself as AES-256 whatever the input was', async () => {
    const { bytes } = await encryptPdf(fixture('base.pdf'), { userPassword: 'x' });
    expect(inspectPdf(bytes).algorithm).toBe('AES-256');
    expect(inspectPdf(bytes).revision).toBe(6);
  });

  it('refuses to double-protect an already encrypted file', async () => {
    await expect(encryptPdf(fixture('enc-aes-128.pdf'), { userPassword: 'x' })).rejects.toBeInstanceOf(
      AlreadyEncrypted,
    );
  });
});

describe('protect then unlock', () => {
  it('returns the document to something pdf.js reads with no password', async () => {
    const protectedPdf = await encryptPdf(fixture('base.pdf'), { userPassword: 'round-trip' });
    const unlocked = await decryptPdf(protectedPdf.bytes, 'round-trip');

    const { pages } = await openWithPdfjs(unlocked.bytes);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain('CONFIDENTIAL PAGE 1');
    expect(pages[2]).toContain('CONFIDENTIAL PAGE 3');
    expect(inspectPdf(unlocked.bytes)).toEqual({ encrypted: false });
  });

  it('keeps the metadata, which lives in strings the round trip re-encodes twice', async () => {
    const protectedPdf = await encryptPdf(fixture('base.pdf'), { userPassword: 'meta' });
    const unlocked = await decryptPdf(protectedPdf.bytes, 'meta');
    const doc = await PDFDocument.load(unlocked.bytes, { updateMetadata: false });
    expect(doc.getTitle()).toBe('Quarterly Statement');
    expect(doc.getAuthor()).toBe('Nicanor');
  });
});

describe('documents that use object streams', () => {
  /**
   * The case pdf-lib cannot handle as a front end, and the one Acrobat actually produces:
   * a cross-reference stream with the objects packed into /ObjStm. pypdf does not write these
   * when encrypting, so the fixture is built here — pdf-lib writes object streams by default.
   */
  async function withObjectStreams() {
    const doc = await PDFDocument.load(fixture('base.pdf'), { updateMetadata: false });
    return doc.save({ useObjectStreams: true });
  }

  it('the fixture really does contain object streams', async () => {
    const raw = new TextDecoder('latin1').decode(await withObjectStreams());
    expect(raw).toContain('/ObjStm');
    expect(raw).toContain('/XRef');
  });

  it('encrypts and decrypts a document whose objects live inside object streams', async () => {
    const source = await withObjectStreams();

    const protectedPdf = await encryptPdf(source, { userPassword: 'objstm' });
    await expect(openWithPdfjs(protectedPdf.bytes)).rejects.toMatchObject({ name: 'PasswordException' });
    expect((await openWithPdfjs(protectedPdf.bytes, 'objstm')).pages[0]).toContain('CONFIDENTIAL PAGE 1');

    const unlocked = await decryptPdf(protectedPdf.bytes, 'objstm');
    const { pages } = await openWithPdfjs(unlocked.bytes);
    expect(pages).toHaveLength(3);
    expect(pages[1]).toContain('CONFIDENTIAL PAGE 2');
  });
});
