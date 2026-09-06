import { describe, expect, it } from 'vitest';
import { assetUrl } from './asset-path';

describe('assetUrl', () => {
  it('resolves from the app root, not the current page', () => {
    // The bug this exists to prevent: resolving against document.baseURI gave
    // /split/pdf-worker.js on the split route, which 404s. runMerge treats a worker that
    // will not start as a bundling problem and silently finishes on the main thread, so every
    // tool but the home page froze the tab on large documents with only a console warning.
    expect(assetUrl('pdf-worker.js')).toBe('/pdf-worker.js');
    expect(assetUrl('pdf.worker.min.js')).toBe('/pdf.worker.min.js');
  });

  it('never returns a relative URL', () => {
    for (const name of ['pdf-worker.js', 'pdf.worker.min.js']) {
      expect(assetUrl(name).startsWith('/')).toBe(true);
    }
  });
});
