// Guards the first-load bundle.
//
// pdf-lib and pdf.js are both meant to be lazily loaded: the app should render before either
// arrives. A single top-level import anywhere the UI can reach undoes that silently, and the
// only symptom is a slower first paint that nobody attributes to a one-line import.
//
// This once caught 425 KB of pdf-lib on every route, pulled in by two lines of arithmetic.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'out';
const MARKERS = [
  ['UnexpectedObjectTypeError', 'pdf-lib'],
  ['PrivateConstructorError', 'pdf-lib'],
  ['AnnotationEditorUIManager', 'pdf.js'],
];
// Room to grow, but not room to swallow a PDF library. pdf-lib alone is ~425 KB.
const LIMIT_KB = 750;

const html = readdirSync(OUT).filter((name) => name.endsWith('.html') && name !== '404.html');
if (html.length === 0) throw new Error('no built pages found — run the build first');

let worst = { route: null, kb: 0 };
for (const page of html) {
  const text = readFileSync(join(OUT, page), 'utf8');
  const srcs = [...text.matchAll(/<script[^>]+src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
  let bytes = 0;
  for (const src of new Set(srcs)) {
    const file = join(OUT, src.replace(/^\//, ''));
    bytes += statSync(file).size;
    const contents = readFileSync(file, 'utf8');
    // Markers from inside the libraries themselves, not names our own code mentions. The
    // first version of this check used 'GlobalWorkerOptions' and flagged app/_lib/pdf-render.js
    // for containing the words it uses to configure pdf.js lazily.
    for (const [marker, library] of MARKERS) {
      if (contents.includes(marker)) {
        throw new Error(`${page} loads ${library} before it can render (${src}) — see CLAUDE.md`);
      }
    }
  }
  const kb = bytes / 1024;
  if (kb > worst.kb) worst = { route: page, kb };
}

if (worst.kb > LIMIT_KB) {
  throw new Error(`first-load JS is ${worst.kb.toFixed(0)} KB on ${worst.route}, over the ${LIMIT_KB} KB limit`);
}

console.log(`bundle ok: ${worst.kb.toFixed(0)} KB first-load JS at worst (${worst.route}), no PDF library in it`);
