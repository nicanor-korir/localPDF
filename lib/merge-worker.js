// Runs the PDF jobs off the main thread.
//
// pdf-lib work is synchronous and CPU-bound: on the main thread a large batch freezes the tab,
// and the progress overlay cannot repaint to show it is doing anything. Here it competes with
// nothing. Cancellation is the caller terminating this worker, which is instant and needs no
// cooperation from the build loop.
//
// A "job" is one output document. Merge sends one; split sends one per part. Doing them all in
// a single worker trip matters more than it looks: the sources are read and parsed once per
// job, and spinning up a worker per part would also mean re-sending every source file to each.
//
// User files arrive as structured-cloned File objects. They are read here and never sent
// anywhere — the CSP forbids egress from workers exactly as it does from the page.

import { compressImageInWorker } from './compress-image-worker.js';
import { mergeDocuments } from './merge.js';

self.onmessage = async (event) => {
  const { jobs, sources, pageSize, quality } = event.data;

  try {
    const outputs = [];
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      // Only say "part 2 of 5" when there is more than one, so the merge overlay keeps
      // reading the way it always has.
      const prefix = jobs.length > 1 ? `Part ${i + 1} of ${jobs.length} — ` : '';
      const { bytes, skipped } = await mergeDocuments(job.pages, {
        sources,
        pageSize,
        quality,
        title: job.title,
        compressImage: compressImageInWorker,
        onProgress: (message) => self.postMessage({ type: 'progress', message: prefix + message }),
      });
      outputs.push({ id: job.id, name: job.name, bytes, skipped });
    }

    // Transfer rather than copy: the outputs can be tens of megabytes between them.
    self.postMessage({ type: 'done', outputs }, outputs.map((o) => o.bytes.buffer));
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message ?? 'Could not build the PDF' });
  }
};
