# Roadmap — from "PDF merger" to "local-first PDF workspace"

The goal is the Acrobat toolset, with the three original constraints intact and
non‑negotiable: **local‑first** (no file ever leaves the machine), **secure**
(the CSP enforces that, it is not a promise), and **fast**.

Everything below is judged against those three first and features second. A
feature that would require egress, a secure‑context‑only API with no fallback,
or a multi‑megabyte binary is redesigned or dropped, not smuggled in.

---

## 1. Engine decision (settled by measurement, 2026‑09‑06)

| Candidate | Verdict |
|---|---|
| **pdf-lib** (already shipping) | **Write engine.** Parses/serialises the object graph, copies pages, embeds images, draws text. Cannot encrypt or decrypt. |
| **pdf.js** (already shipping) | **Read/render engine.** Rasterises pages, extracts text, and *does* decrypt (R2–R6) — but only into its own in-memory model. |
| pdf.js `extractPages()` (new in v6) | **Rejected.** Undocumented, `pageIndices` means destination slots rather than a filter, and on encrypted input it re-encrypts the output *incorrectly* — the file it produced could not be reopened (`Invalid object ref`). Measured, not assumed. |
| **mupdf-wasm** | **Rejected on licence.** AGPL‑3.0. For a hosted web app that means source‑disclosure obligations. Also ~10 MB. |
| **qpdf-wasm** | **Rejected on weight.** 2–4 MB of wasm, no first‑party npm build. Fails "fast" and complicates offline precache. |
| **Our own crypto layer** | **Chosen for encrypt/decrypt.** ~1 kLOC of pure, DOM‑free, fully unit‑testable JavaScript. No new dependency, no bundle cliff, works from `file://`. |

### Why we must write the crypto ourselves

No JS PDF library in the ecosystem both **decrypts and encrypts** without a wasm
blob. Measured facts behind the design:

- **pdf-lib parses encrypted PDFs fine.** Structure (dicts, names, numbers,
  refs) is never encrypted — only strings and streams are. All six fixtures
  loaded with the object graph intact and a readable `/Encrypt` dictionary.
- **…except when object streams are present.** pdf-lib expands `/ObjStm`
  *eagerly at load*. An encrypted one inflates to garbage and the load dies with
  `Cannot read properties of undefined (reading 'Pages')`. Acrobat writes object
  streams as a matter of course, so this is the common case, not an edge case.

So decryption is a **raw byte pre-pass that runs before pdf-lib ever sees the
file**: walk the xref chain, decrypt streams and strings, expand the (now
readable) object streams into top-level objects, drop `/Encrypt`, emit a clean
classic-xref PDF. pdf-lib then loads it like any other document.

That pre-pass needs a *targeted* reader, not a full PDF parser: enough to read
the trailer, the xref chain and the `/Encrypt` dictionary, plus byte-slicing for
object bodies. It never has to understand what an object *means*.

### Testing this without trusting ourselves

Crypto that only round-trips against its own implementation proves nothing. Both
directions are pinned against an independent implementation:

- **Decrypt** is tested against fixtures produced by **pypdf + cryptography**
  (RC4‑40/R2, RC4‑128/R3, AES‑128/R4, AES‑256/R6, and owner‑password‑only).
- **Encrypt** is tested by reopening our output with **pdf.js**, whose security
  handler is Mozilla's, not ours.

Fixtures are generated once by `scripts/generate-crypto-fixtures.py` and checked
in as bytes, so CI needs no Python.

---

## 2. What is already built

Six of the eleven requested tools are largely **already implemented**, because
the page model generalises further than the merge feature that motivated it:

```javascript
{ id, fileId, sourceIndex, rotation, crop }   // one page of the OUTPUT
```

Reorder, rotate, crop and delete are already O(1) pure operations over that
array, with undo, and they are already covered by tests. Organise, reorder,
delete, crop, extract and split are therefore mostly **surfacing** work, not new
engines. That is why they come first.

---

## 3. Phases

Ordered so value lands early and the two features where "looks right but is
silently wrong" is dangerous (crypto, redaction) get built when there is time to
do them properly.

### Phase 1 — Workspace shell + page tools — **DONE**
The app stops being one page and becomes a tool hub: a shared document session,
one preview surface, one route per tool (deep‑linkable, individually precached).
- Organise / Reorder / Rotate / Delete — surface the existing model
- **Extract** — selected pages → a new PDF
- **Split** — by range, by every N pages, or one file per page → a zip
- **Crop** — existing crop UI, applied without a merge
- New: `lib/zip.js` (store‑only zip writer, no dependency)

### Phase 2 — Protect / Unprotect — **DONE**
- `lib/crypto/*` — MD5, RC4, AES‑CBC, SHA‑2
- `lib/pdf-security.js` — standard security handler, R2–R6 key derivation
- `lib/pdf-decrypt.js` — the raw pre‑pass described above
- `lib/pdf-encrypt.js` — **AES‑256 (R6) only** on output; shipping RC4 would mean
  shipping known‑broken crypto
- **Scope of "unprotect":** removes owner/permissions restrictions (no password
  needed — this is most real‑world "protected" PDFs), and removes an open
  password *that the user supplies*. It is not a password cracker and will not
  become one.

Shipped as `/unlock` and `/protect`. Reads RC4‑40, RC4‑128, AES‑128 and AES‑256;
writes AES‑256 only. Both run in the PDF worker — an 8 MB document takes about
2.6s, which on the main thread would be a frozen tab. Object streams expand in
both directions, so output is slightly larger than input; that is the trade for
a plain cross‑reference table that is easy to be sure is correct.

### Phase 3 — Convert + Compress — **DONE**
- **To images** — PNG/JPEG per page → zip
- **To text / Markdown** — pdf.js text content plus layout heuristics
- **To Word (.docx)** — generated OOXML; honest about being flowed text, not
  pixel-faithful layout
- **Compress** — shipped as `/compress`. Re‑encodes the large images and leaves
  everything else alone, because that is where the bytes are. Refuses to return
  a larger file, and skips formats it cannot read safely (fax, JBIG2, JPEG 2000,
  indexed, CMYK) rather than guessing. Measured 72% on an image‑heavy document
  with no visible difference.

Convert shipped as `/convert`: PNG and JPEG at 96/150/300 dpi, plus plain text,
Markdown and Word. Images are faithful — each page rendered at the chosen
resolution with its rotation and crop. Text is heuristic and the page says so;
there is no OCR, so a scan converts to images or not at all.

### Phase 4 — Edit — **mostly done**
Shipped as `/edit`: add text and images on top of a page, drag to move, pull the
corner to resize, with undo. Text uses the built‑in WinAnsi fonts, so anything
they cannot write is substituted *and reported* rather than dropped.

**Still to do:** inserting a blank page. That needs a page‑model change — every
`pages[]` entry currently points at a source — so it is a separate piece of work
rather than more UI.

It deliberately does not edit text that is already on the page. That would need
the document's own fonts in an editable form, which a PDF does not carry.

### Phase 5 — Redact — **DONE**
Last, deliberately. A redaction that draws a black box over text is a **data
leak**, and this app's whole claim is that it does not leak.

Shipped as `/redact`, and not by the route first considered. Stripping individual
text‑showing operators out of a content stream needs glyph widths from the
embedded fonts to know where each string ends, and getting that subtly wrong
produces a document that *looks* redacted — the one failure mode that matters
here. So a redacted page is rendered to pixels and replaced by that image
instead: total removal, at the cost of that page's selectable text and links,
which the page says plainly. Pages with no regions are untouched.

`verifyRedaction()` then re‑opens the finished document with pdf.js and confirms
those pages carry no text at all. Nothing downloads until that passes.

---

## 4. Rules that survive every phase

- No egress. `connect-src 'self'` stays.
- No secure‑context‑only API without a fallback (`file://` and plain‑http LAN are
  supported targets).
- Every engine module stays DOM‑free and unit‑tested in Node. The CSP means there
  is no error reporting and never will be; tests are the only safety net.
- The UI stays simple. A tool row and one working surface — not a file manager.
