"""Regenerate the encrypted PDF fixtures in lib/__fixtures__/encrypted/.

Run once, by hand, when the fixture set needs to change; the output is checked in, so neither
CI nor a normal install needs Python.

    python3 -m venv /tmp/pdfvenv
    /tmp/pdfvenv/bin/pip install pypdf reportlab cryptography
    /tmp/pdfvenv/bin/python scripts/generate-crypto-fixtures.py

pypdf writes these, and lib/pdf-decrypt.js reads them. That is the point: a decryptor tested
only against its own encryptor proves the two agree, not that either is right. The other
direction is covered the same way — lib/pdf-encrypt.js writes, and pdf.js (Mozilla's security
handler, not ours) reads.
"""

import io, os

OUT = "lib/__fixtures__/encrypted/"
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from pypdf import PdfWriter, PdfReader

buf = io.BytesIO()
c = canvas.Canvas(buf, pagesize=A4)
c.setTitle("Quarterly Statement")
c.setAuthor("Nicanor")
for i in range(3):
    c.drawString(72, 760, f"CONFIDENTIAL PAGE {i+1}")
    c.drawString(72, 730, "Account balance: 12,345.67")
    c.linkURL("https://example.com/policy", (72, 700, 300, 720), relative=0)
    c.showPage()
c.save()
base = buf.getvalue()
open(OUT + "base.pdf","wb").write(base)

variants = [
    ("rc4-40",  "RC4-40",  "open123", "owner456"),
    ("rc4-128", "RC4-128", "open123", "owner456"),
    ("aes-128", "AES-128", "open123", "owner456"),
    ("aes-256", "AES-256", "open123", "owner456"),
    # owner-password only: empty user password -> opens with no prompt, but restricted
    ("owner-only-aes128", "AES-128", "", "owner456"),
    ("owner-only-rc4128", "RC4-128", "", "owner456"),
]
for name, algo, user, owner in variants:
    w = PdfWriter(clone_from=io.BytesIO(base))
    w.encrypt(user_password=user, owner_password=owner, algorithm=algo,
              permissions_flag=0b1111_1111_1111_1111_1111_1111_0000_0000)
    out = OUT + f"enc-{name}.pdf"
    with open(out,"wb") as f: w.write(f)
    r = PdfReader(out)
    print(f"{out:28s} {os.path.getsize(out):7d}B  encrypted={r.is_encrypted}")
