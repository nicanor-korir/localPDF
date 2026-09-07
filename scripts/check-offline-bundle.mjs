// Verifies that the built export can actually work offline.
//
// The README promises it does, and that promise rests entirely on out/sw.js: a service worker
// that precaches a file which is not there fails to install *at all*, silently taking offline
// support with it. None of that shows up in a passing build, so it is asserted here instead.
//
// Run by CI after `bun run build`; also runnable locally with `bun run check:offline`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { READY_TOOLS } from '../lib/tools.js';

// `framework: null` means Vercel serves out/ as raw files with no clean-URL resolution, so
// /organise 404s unless vercel.json rewrites it to organise.html. It is a rewrite rather than
// `cleanUrls: true` on purpose: cleanUrls answers /organise.html with a 308, and
// `cache.put` rejects a redirected response — so the service worker's precache would fail to
// install and offline support would vanish without a word.
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const rewrites = new Map((vercel.rewrites || []).map((r) => [r.source, r.destination]));
const needRewrite = READY_TOOLS.filter((tool) => tool.href !== '/');
const badRewrites = needRewrite.filter((tool) => rewrites.get(tool.href) !== `${tool.href}.html`);
if (badRewrites.length) {
  throw new Error(
    `vercel.json is missing a rewrite for: ${badRewrites.map((t) => t.href).join(', ')} — ` +
      'those routes will 404 in production.',
  );
}

const OUT = 'out';
const sw = readFileSync(join(OUT, 'sw.js'), 'utf8');

const match = sw.match(/const ASSETS = (\[[\s\S]*?\]);/);
if (!match) throw new Error('sw.js has no ASSETS list — the generator did not run.');
const assets = JSON.parse(match[1]);

// Every tool in the registry must have a shell in the export. Without this, adding a tool to
// lib/tools.js and forgetting the route ships a nav link to a 404.
// The landing page plus one shell per tool. It is listed separately because no tool claims
// "/" any more, and a home page missing from the precache is an offline visit that fails at
// the front door.
const shells = ['./index.html', ...READY_TOOLS.map((tool) => `.${tool.href}.html`)];

const required = [
  ...shells,
  './pdf.worker.min.js',
  // The PDF worker is built by esbuild, not by Next, so nothing else in the pipeline would
  // notice if it stopped being emitted.
  './pdf-worker.js',
  './manifest.webmanifest',
];

const missing = required.filter((file) => !assets.includes(file));
if (missing.length) throw new Error(`sw.js is missing: ${missing.join(', ')}`);

if (!assets.some((file) => file.startsWith('./_next'))) {
  throw new Error('sw.js precached no app chunks');
}

// A syntax error here disables offline support and nothing says so.
new Function(sw.replace(/\bself\b/g, 'globalThis'));

// The navigation handler has to map /organise to organise.html; without it every tool route
// falls back to index.html offline and quietly serves the merge page.
if (!/async function navigate\(/.test(sw)) {
  throw new Error('sw.js has no navigation handler — tool routes would 404 offline.');
}

JSON.parse(readFileSync(join(OUT, 'manifest.webmanifest'), 'utf8'));

console.log(
  `offline bundle ok: ${assets.length} assets precached, ${shells.length} tool shells ` +
    `(${shells.join(', ')}), ${needRewrite.length} route rewrites`,
);
