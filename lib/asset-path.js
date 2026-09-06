/**
 * URLs for the two static assets loaded by path rather than through the bundler: the pdf.js
 * worker and our own PDF worker.
 *
 * They live at the root of the deployed app, so they **cannot** be resolved against
 * `document.baseURI`. On /split that yields /split/pdf-worker.js, which 404s — and the
 * failure is silent: `runMerge` treats a worker that will not start as a bundling problem and
 * quietly finishes on the main thread. The only trace is a console warning, so every tool
 * except the home page was freezing the tab on large documents with nothing to show for it.
 *
 * One knob, in one place. Hosting the app under a sub-path needs Next's `basePath` set and
 * this to match it; two scattered string literals were how it drifted the first time.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

export function assetUrl(name) {
  return `${BASE_PATH}/${name}`;
}
