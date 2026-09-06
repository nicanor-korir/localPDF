// Runs the heavy PDF work off the main thread.
//
// Both kinds of work here are synchronous and CPU-bound, and both would freeze the tab if they
// ran on the main thread — measured at 2.6s to unlock an 8 MB document, during which the
// progress overlay could not even repaint to show it was doing anything. Here they compete
// with nothing. Cancellation is the caller terminating this worker, which is instant and needs
// no cooperation from the loop.
//
// A "job" is one output document. Merge sends one; split sends one per part. Doing them all in
// a single worker trip matters more than it looks: the sources are read and parsed once per
// job, and spinning up a worker per part would also mean re-sending every source file to each.
//
// User files arrive as structured-cloned File objects or byte arrays. They are read here and
// never sent anywhere — the CSP forbids egress from workers exactly as it does from the page.

import { compressImageInWorker } from './compress-image-worker.js';
import { mergeDocuments } from './merge.js';
import { analysePdf, compressPdf } from './pdf-compress.js';
import { decryptPdf, inspectPdf } from './pdf-decrypt.js';
import { encryptPdf } from './pdf-encrypt.js';
import { recodeImageInWorker } from './recode-image-worker.js';

const post = (message, transfer) => self.postMessage(message, transfer || []);
const progress = (message) => post({ type: 'progress', message });

async function runJobs({ jobs, sources, pageSize, quality }) {
  const outputs = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    // Only say "part 2 of 5" when there is more than one, so the merge overlay keeps reading
    // the way it always has.
    const prefix = jobs.length > 1 ? `Part ${i + 1} of ${jobs.length} — ` : '';
    const { bytes, skipped } = await mergeDocuments(job.pages, {
      sources,
      pageSize,
      quality,
      title: job.title,
      compressImage: compressImageInWorker,
      onProgress: (message) => progress(prefix + message),
    });
    outputs.push({ id: job.id, name: job.name, bytes, skipped });
  }
  // Transfer rather than copy: the outputs can be tens of megabytes between them.
  post({ type: 'done', outputs }, outputs.map((o) => o.bytes.buffer));
}

async function runUnlock({ bytes, password }) {
  progress('Removing protection...');
  const result = await decryptPdf(new Uint8Array(bytes), password);
  post({ type: 'done', result: { ...result, bytes: result.bytes } }, [result.bytes.buffer]);
}

async function runProtect({ bytes, options }) {
  progress('Protecting...');
  const result = await encryptPdf(new Uint8Array(bytes), options);
  post({ type: 'done', result: { ...result, bytes: result.bytes } }, [result.bytes.buffer]);
}

function runInspect({ bytes }) {
  post({ type: 'done', result: inspectPdf(new Uint8Array(bytes)) });
}

function runAnalyse({ bytes }) {
  post({ type: 'done', result: analysePdf(new Uint8Array(bytes)) });
}

async function runCompress({ bytes, options }) {
  progress('Looking at the images...');
  const result = await compressPdf(new Uint8Array(bytes), {
    ...options,
    recodeImage: recodeImageInWorker,
    onProgress: progress,
  });
  post({ type: 'done', result }, [result.bytes.buffer]);
}

const HANDLERS = {
  jobs: runJobs,
  unlock: runUnlock,
  protect: runProtect,
  inspect: runInspect,
  analyse: runAnalyse,
  compress: runCompress,
};

self.onmessage = async (event) => {
  const data = event.data;
  const handler = HANDLERS[data.kind ?? 'jobs'];
  try {
    if (!handler) throw new Error(`Unknown work: ${data.kind}`);
    await handler(data);
  } catch (error) {
    // The name travels with the message: the page turns PasswordRequired and WrongPassword
    // into different prompts, and an Error crossing a worker boundary loses its class.
    post({
      type: 'error',
      name: error?.name ?? 'Error',
      message: error?.message ?? 'Something went wrong',
    });
  }
};
