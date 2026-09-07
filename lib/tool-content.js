/**
 * The words on each tool page, shown only while it is empty.
 *
 * Two jobs, and they happen to be the same job. A page that is nothing but a drop zone tells a
 * search engine nothing about what it does, and it tells a first-time visitor nothing either.
 * The moment a file is loaded this all disappears, so the working state stays as bare as it
 * has always been.
 *
 * Everything here has to be **true**. It is the page that answers "will this upload my
 * contract", and an answer that is nearly right would be worse than no page at all.
 */

const NEVER_UPLOADED = {
  question: 'Do my files get uploaded anywhere?',
  answer:
    'No. Every tool here runs inside your browser tab, on your own machine. The page also ships ' +
    'a Content-Security-Policy that blocks outbound requests entirely, so uploading is not ' +
    'something the app declines to do — it is something it cannot do. Click the "Private" badge ' +
    'to read the policy actually in force.',
};

const OFFLINE = {
  question: 'Does it work offline?',
  answer:
    'Yes. After your first visit the whole app is stored by your browser, so it keeps working ' +
    'with no connection at all. You can install it from the browser menu and use it like any ' +
    'other application.',
};

const SIZE_LIMIT = {
  question: 'Is there a file size limit?',
  answer:
    'There is no limit imposed by us, because there is no server to impose one. The practical ' +
    'ceiling is your device’s memory — large scans are handled off the main thread so the page ' +
    'stays responsive while they are worked on.',
};

export const TOOL_CONTENT = {
  merge: {
    intro:
      'Combine several PDFs, or a mix of PDFs and images, into one document. Drag the pages into ' +
      'the order you want, rotate or crop any of them, then download the result.',
    faq: [
      NEVER_UPLOADED,
      {
        question: 'Can I merge images and PDFs together?',
        answer:
          'Yes. PNG, JPEG and WebP images are placed on their own pages and can be mixed freely ' +
          'with PDF pages in any order.',
      },
      {
        question: 'Will the links and form fields still work?',
        answer:
          'Links keep working and stay in the right place. Form fields are flattened into the ' +
          'page — copying a page without its document’s form definition would otherwise leave ' +
          'boxes that look editable and are not.',
      },
      OFFLINE,
    ],
  },

  organise: {
    intro:
      'Reorder, rotate, crop and delete pages, or insert a blank one. Every page keeps its ' +
      'original size, so a document you are only rearranging comes out the shape it went in.',
    faq: [
      NEVER_UPLOADED,
      {
        question: 'Can I undo a change?',
        answer:
          'Yes — the Undo button, or Ctrl/Cmd + Z. Every page edit can be walked back, including ' +
          'deletions.',
      },
      {
        question: 'What does cropping actually do?',
        answer:
          'It sets the page’s crop box, which is what a reader displays. The content outside it ' +
          'is no longer shown. If you need it genuinely removed rather than hidden, use Redact.',
      },
    ],
  },

  extract: {
    intro:
      'Pick the pages you want and save them as a new PDF. Tick them in the preview, or type a ' +
      'range like 1-3, 5, 9-end.',
    faq: [
      NEVER_UPLOADED,
      {
        question: 'Does the order I type the pages matter?',
        answer:
          'Yes. Typing "3, 1" extracts page 3 first — someone writing them in that order meant ' +
          'it. Ticking pages in the preview keeps the document’s own order.',
      },
      SIZE_LIMIT,
    ],
  },

  split: {
    intro:
      'Break one PDF into several files — by page range, every N pages, or one file per page. ' +
      'The parts arrive together in a single zip.',
    faq: [
      NEVER_UPLOADED,
      {
        question: 'How are the files named?',
        answer:
          'Each part is named after the original document and the pages it holds, such as ' +
          'report-pages-4-6.pdf, so they sort and read sensibly in a folder.',
      },
      OFFLINE,
    ],
  },

  unlock: {
    intro:
      'Remove a password from a PDF you can already open, or lift restrictions on printing and ' +
      'copying that need no password at all — which is most "protected" PDFs in circulation.',
    faq: [
      {
        question: 'Can it open a PDF whose password I have forgotten?',
        answer:
          'No, and it never will. This removes a password you supply, or restrictions that need ' +
          'no password. It does not guess, and it is not a password cracker.',
      },
      {
        question: 'What kinds of protection can it read?',
        answer:
          'RC4 40-bit and 128-bit, AES-128 and AES-256 — the whole range the PDF format has ' +
          'used, so documents encrypted years ago still open.',
      },
      NEVER_UPLOADED,
    ],
  },

  protect: {
    intro:
      'Add a password to a PDF with AES-256 encryption, and restrict printing, copying or ' +
      'editing. The encryption happens on your device, so the unprotected file is never sent ' +
      'anywhere.',
    faq: [
      {
        question: 'What if I forget the password?',
        answer:
          'The document cannot be opened — not by us, not by anyone. There is no recovery and no ' +
          'back door. Keep the password somewhere safe before you download the file.',
      },
      {
        question: 'Do the restriction checkboxes really stop anyone?',
        answer:
          'Not the way the password does. Permissions are recorded in the file and every ' +
          'well-behaved reader obeys them, but nothing enforces them. The password genuinely ' +
          'keeps the contents unreadable; the checkboxes are a request.',
      },
      NEVER_UPLOADED,
    ],
  },

  compress: {
    intro:
      'Make a PDF smaller by re-encoding the images inside it, which is where nearly all the ' +
      'bytes of a large document are. Text, links and page structure are left exactly as they ' +
      'were.',
    faq: [
      {
        question: 'Will it ever make my file bigger?',
        answer:
          'No. Re-encoding an already-optimised image often would, so the result is compared ' +
          'with the original and the original is kept whenever it is smaller. You are told when ' +
          'that happens rather than handed a pointless download.',
      },
      {
        question: 'How much smaller will my file get?',
        answer:
          'It depends entirely on how much of it is pictures. The page tells you before you ' +
          'start — a document that is 90% images has a great deal to give, and one that is 4% ' +
          'images has almost none.',
      },
      NEVER_UPLOADED,
    ],
  },

  convert: {
    intro:
      'Turn a PDF into PNG or JPEG images, plain text, Markdown, or a Word document. Images are ' +
      'faithful to the page; text formats recover the words and a rough shape.',
    faq: [
      {
        question: 'Why does my scanned PDF convert to an empty document?',
        answer:
          'A scan is a picture of text, not text, and there is no OCR here. Convert it to images ' +
          'instead — the page will tell you when it finds nothing to extract rather than handing ' +
          'you a blank file.',
      },
      {
        question: 'How faithful is the Word conversion?',
        answer:
          'It recovers headings, paragraphs and lists as flowing, editable text. It does not ' +
          'reproduce the layout — columns, tables and exact positioning are lost, because that ' +
          'is what converting a fixed page to a flowing document means. If you need the layout, ' +
          'convert to images.',
      },
      NEVER_UPLOADED,
    ],
  },

  edit: {
    intro:
      'Add text and images on top of a page, then drag them into place. Useful for signing, ' +
      'dating, stamping or annotating a document you have been sent.',
    faq: [
      {
        question: 'Can I change the text that is already in the PDF?',
        answer:
          'No. That would need the document’s own fonts in an editable form, which a PDF does ' +
          'not carry. You can add text on top of it, and you can cover or remove what is there ' +
          'with Redact.',
      },
      {
        question: 'Which characters can I type?',
        answer:
          'Anything in the Latin-1 range plus the usual typographic extras — accents, curly ' +
          'quotes, dashes, the euro sign. Characters outside that cannot be written with the ' +
          'built-in fonts, and the page names them as you type rather than dropping them quietly.',
      },
      NEVER_UPLOADED,
    ],
  },

  redact: {
    intro:
      'Remove content from a PDF for good. Drag across anything that should not be in the ' +
      'document, and it stops existing — rather than being covered by a rectangle that anyone ' +
      'can select underneath.',
    faq: [
      {
        question: 'Is this different from drawing a black box over the text?',
        answer:
          'Completely. A black rectangle drawn over text in a PDF hides nothing: the words are ' +
          'still objects in the file and can be selected, copied or read with a parser. That is ' +
          'why names keep appearing in supposedly redacted documents. Here the page is turned ' +
          'into a picture of itself, so what was underneath is gone.',
      },
      {
        question: 'What do I lose by redacting a page?',
        answer:
          'That page stops having selectable text or working links — including the parts you did ' +
          'not mark, because the whole page becomes an image. Pages you left alone are untouched.',
      },
      {
        question: 'How do I know it worked?',
        answer:
          'The result is checked before it downloads: the finished document is reopened and the ' +
          'redacted pages are confirmed to carry no text at all. If any still does, nothing is ' +
          'downloaded and the page tells you which.',
      },
    ],
  },
};

export const contentFor = (id) => TOOL_CONTENT[id] ?? null;
