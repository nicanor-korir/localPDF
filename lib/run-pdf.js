import { assetUrl } from './asset-path.js';
import { MergeCancelled } from './merge-cancelled.js';

// Raised when the worker itself never gets going — a bundling problem, a blocked script, an
// environment that cannot start one. Distinct from an error the merge reports about the files,
// which must not trigger a retry.
class WorkerUnavailable extends Error {}

/**
 * How long to wait for the worker to say it is alive before giving up on it.
 *
 * The worker posts `{ type: 'ready' }` at module scope, so this only ever measures the time to
 * fetch and evaluate a script that is either already in the service worker's cache or a few
 * hundred kilobytes over the network. Generous enough for a slow phone on a bad connection,
 * and it can never interrupt a job in progress: the clock stops at the *first* message, before
 * any work has been asked for.
 */
const WORKER_STARTUP_MS = 10000;

/**
 * A worker, plus a promise that rejects if it never reports for duty.
 *
 * `onerror` catches a worker script that fails to parse. It does not catch one that never
 * loads at all — offline with the asset missing from the cache, a killed process, a blocked
 * request — and in that case nothing is ever delivered to `onmessage` either. The job's promise
 * then stays pending forever, which the user sees as a progress overlay that spins with no
 * message and no way out but closing the tab. Measured, and reported.
 *
 * The watchdog turns that silence into a WorkerUnavailable, which the callers already know how
 * to handle: finish the work on the main thread instead. Slower, but it finishes.
 */
function startWorker(onDead) {
  const worker = new Worker(assetUrl('pdf-worker.js'));
  const timer = setTimeout(
    () => onDead(new WorkerUnavailable('PDF worker did not start within 10s')),
    WORKER_STARTUP_MS,
  );
  return { worker, clearStartupTimer: () => clearTimeout(timer) };
}

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
  let settled = false;
  let rejectPromise;
  let fail;

  const { worker, clearStartupTimer } = startWorker((error) => fail(error));

  const finish = (act) => {
    settled = true;
    clearStartupTimer();
    worker.terminate();
    act();
  };

  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject;
    fail = (error) => {
      if (settled) return;
      finish(() => reject(error));
    };

    worker.onmessage = (event) => {
      const data = event.data;
      // Proof of life, sent before the worker looks at any work. Nothing to report to the
      // caller, but it is what stops the startup watchdog.
      if (data.type === 'ready') {
        clearStartupTimer();
        return;
      }
      if (data.type === 'progress') {
        clearStartupTimer();
        onProgress?.(data.message);
        return;
      }
      if (settled) return;
      finish(() => {
        if (data.type === 'done') resolve({ outputs: data.outputs });
        else reject(new Error(data.message));
      });
    };

    worker.onerror = (event) => {
      fail(new WorkerUnavailable(event.message || 'PDF worker failed to start'));
    };

    worker.postMessage({ jobs, sources, pageSize, quality });
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      // Terminating is the cancellation: it stops mid-page, with no cooperation needed from
      // the build loop and nothing left running in the background. It also means no further
      // messages arrive, so the promise has to be settled here or it would hang forever.
      finish(() => rejectPromise(new MergeCancelled()));
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
      const { bytes, skipped, overlayNotes } = await mergeDocuments(job.pages, {
        sources,
        pageSize,
        quality,
        title: job.title,
        overlays: job.overlays,
        compressImage,
        onProgress: (message) => onProgress?.(prefix + message),
        signal: controller.signal,
      });
      outputs.push({ id: job.id, name: job.name, bytes, skipped, overlayNotes });
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

  let settled = false;
  let rejectPromise;
  let fail;

  const { worker, clearStartupTimer } = startWorker((error) => fail(error));

  const finish = (act) => {
    settled = true;
    clearStartupTimer();
    worker.terminate();
    act();
  };

  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject;
    fail = (error) => {
      if (settled) return;
      finish(() => reject(error));
    };

    worker.onmessage = (event) => {
      const data = event.data;
      if (data.type === 'ready') {
        clearStartupTimer();
        return;
      }
      if (data.type === 'progress') {
        clearStartupTimer();
        onProgress?.(data.message);
        return;
      }
      if (settled) return;
      finish(() => {
        if (data.type === 'done') resolve(data.result);
        else reject(new WorkerError(data.name, data.message));
      });
    };

    worker.onerror = (event) => {
      fail(new WorkerUnavailable(event.message || 'PDF worker failed to start'));
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
      finish(() => rejectPromise(new MergeCancelled()));
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
    if (kind === 'analyse' || kind === 'compress') {
      const { analysePdf, compressPdf } = await import('./pdf-compress.js');
      if (kind === 'analyse') return analysePdf(data);
      const { recodeImageOnMainThread } = await import('./recode-image-dom.js');
      return compressPdf(data, { ...options, recodeImage: recodeImageOnMainThread });
    }
    const { decryptPdf, inspectPdf } = await import('./pdf-decrypt.js');
    if (kind === 'inspect') return inspectPdf(data);
    return decryptPdf(data, password);
  })();

  // Nothing to cancel: without a worker this is one synchronous run either way.
  return { promise, cancel: () => {} };
}

export { MergeCancelled };
