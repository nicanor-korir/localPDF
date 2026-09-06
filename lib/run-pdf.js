import { assetUrl } from './asset-path.js';
import { MergeCancelled } from './merge-cancelled.js';

// Raised when the worker itself never gets going — a bundling problem, a blocked script, an
// environment that cannot start one. Distinct from an error the merge reports about the files,
// which must not trigger a retry.
class WorkerUnavailable extends Error {}

/**
 * Whether a document *build* can run off the main thread.
 *
 * OffscreenCanvas is the deciding factor, not Worker: image pages have to be re-encoded, and
 * without it there is no canvas inside a worker to do that with. Safari only gained it in
 * 16.4, so the main-thread path is a real fallback rather than dead code.
 */
export function canUseWorker() {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap !== 'undefined'
  );
}

/**
 * Build one or more PDFs in a worker when the browser allows it, otherwise on the main thread.
 *
 * A job is one output document: `{ id, name, title, pages }`. Merge passes a single job, split
 * passes one per part. Both paths share one contract: progress callbacks, a cancel function,
 * and a promise that resolves with `{ outputs }` or rejects with MergeCancelled.
 *
 * @returns {{ promise: Promise<{outputs: Array<{id, name, bytes: Uint8Array, skipped: Array}>}>,
 *            cancel: () => void }}
 */
export function runPdfJobs(options) {
  if (!canUseWorker()) return runOnMainThread(options);

  let active = runInWorker(options);
  let cancelled = false;

  // A worker that cannot start must not cost the user their document — fall back and finish
  // the job on the main thread. Only startup failures retry; an error the build itself
  // reported would fail exactly the same way a second time.
  const promise = active.promise.catch((error) => {
    if (cancelled || !(error instanceof WorkerUnavailable)) throw error;
    console.warn('PDF worker unavailable; falling back to the main thread.', error);
    active = runOnMainThread(options);
    return active.promise;
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      active.cancel();
    },
  };
}

/**
 * The single-document case, kept as its own entry point because it is by far the common one.
 * Resolves with `{ bytes, skipped }` rather than a one-element list.
 */
export function runMerge({ pages, sources, pageSize, quality, title, onProgress }) {
  const { promise, cancel } = runPdfJobs({
    jobs: [{ id: 'merged', name: null, title, pages }],
    sources,
    pageSize,
    quality,
    onProgress,
  });
  return {
    promise: promise.then(({ outputs }) => ({
      bytes: outputs[0].bytes,
      skipped: outputs[0].skipped,
    })),
    cancel,
  };
}

function runInWorker({ jobs, sources, pageSize, quality, onProgress }) {
  // A plain static asset built by scripts/build-worker.mjs. Resolved from the app root, not
  // the current document — see lib/asset-path.js for why that distinction is load-bearing.
  const worker = new Worker(assetUrl('pdf-worker.js'));
  let settled = false;
  let rejectPromise;

  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject;
    worker.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'progress') {
        onProgress?.(data.message);
        return;
      }
      settled = true;
      worker.terminate();
      if (data.type === 'done') resolve({ outputs: data.outputs });
      else reject(new Error(data.message));
    };

    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new WorkerUnavailable(event.message || 'PDF worker failed to start'));
    };

    worker.postMessage({ jobs, sources, pageSize, quality });
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      // Terminating is the cancellation: it stops mid-page, with no cooperation needed from
      // the build loop and nothing left running in the background. It also means no further
      // messages arrive, so the promise has to be settled here or it would hang forever.
      worker.terminate();
      rejectPromise(new MergeCancelled());
    },
  };
}

function runOnMainThread({ jobs, sources, pageSize, quality, onProgress }) {
  const controller = new AbortController();

  // Loaded on demand so the main bundle does not carry pdf-lib and the image encoder for a
  // path most browsers never take.
  const promise = (async () => {
    const [{ mergeDocuments }, { compressImage }] = await Promise.all([
      import('./merge.js'),
      import('./compress-image.js'),
    ]);
    const outputs = [];
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const prefix = jobs.length > 1 ? `Part ${i + 1} of ${jobs.length} — ` : '';
      const { bytes, skipped } = await mergeDocuments(job.pages, {
        sources,
        pageSize,
        quality,
        title: job.title,
        compressImage,
        onProgress: (message) => onProgress?.(prefix + message),
        signal: controller.signal,
      });
      outputs.push({ id: job.id, name: job.name, bytes, skipped });
    }
    return { outputs };
  })();

  return { promise, cancel: () => controller.abort() };
}

/**
 * An error that crossed a worker boundary.
 *
 * A structured clone drops the class, so the original name is carried explicitly: the UI shows
 * a password prompt for PasswordRequired and a "that was wrong" message for WrongPassword, and
 * without the name those would be the same generic failure.
 */
export class WorkerError extends Error {
  constructor(name, message) {
    super(message);
    this.name = name;
  }
}

/**
 * Encryption work — inspecting, unlocking and protecting.
 *
 * Gated on `Worker` alone rather than `canUseWorker()`: none of this touches a canvas, so
 * OffscreenCanvas is irrelevant. It still needs a worker badly — unlocking an 8 MB document
 * measured at 2.6 seconds, which on the main thread is a frozen tab with a progress overlay
 * that cannot repaint to explain itself.
 *
 * @returns {{ promise: Promise<object>, cancel: () => void }}
 */
export function runCrypto({ kind, bytes, password, options, onProgress }) {
  if (typeof Worker === 'undefined') return cryptoOnMainThread({ kind, bytes, password, options });

  const worker = new Worker(assetUrl('pdf-worker.js'));
  let settled = false;
  let rejectPromise;

  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject;
    worker.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'progress') {
        onProgress?.(data.message);
        return;
      }
      settled = true;
      worker.terminate();
      if (data.type === 'done') resolve(data.result);
      else reject(new WorkerError(data.name, data.message));
    };

    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new WorkerUnavailable(event.message || 'PDF worker failed to start'));
    };

    // The buffer is transferred, so the caller must not reuse it afterwards.
    worker.postMessage({ kind, bytes, password, options }, [bytes]);
  }).catch((error) => {
    if (!(error instanceof WorkerUnavailable)) throw error;
    console.warn('PDF worker unavailable; falling back to the main thread.', error);
    return cryptoOnMainThread({ kind, bytes, password, options }).promise;
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectPromise(new MergeCancelled());
    },
  };
}

function cryptoOnMainThread({ kind, bytes, password, options }) {
  // Loaded on demand: the crypto is only needed by two of the tools, and there is no reason
  // for the merge page to carry an AES implementation in its first-load bundle.
  const promise = (async () => {
    const data = new Uint8Array(bytes);
    if (kind === 'protect') {
      const { encryptPdf } = await import('./pdf-encrypt.js');
      return encryptPdf(data, options);
    }
    const { decryptPdf, inspectPdf } = await import('./pdf-decrypt.js');
    if (kind === 'inspect') return inspectPdf(data);
    return decryptPdf(data, password);
  })();

  // Nothing to cancel: without a worker this is one synchronous run either way.
  return { promise, cancel: () => {} };
}

export { MergeCancelled };
