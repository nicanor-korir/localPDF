import { afterEach, describe, expect, it, vi } from 'vitest';
import { canUseWorker, runPdfJobs } from './run-pdf.js';

const ORIGINAL = {
  Worker: globalThis.Worker,
  OffscreenCanvas: globalThis.OffscreenCanvas,
  createImageBitmap: globalThis.createImageBitmap,
};

function setEnv({ worker, offscreen, bitmap }) {
  globalThis.Worker = worker ? function Worker() {} : undefined;
  globalThis.OffscreenCanvas = offscreen ? function OffscreenCanvas() {} : undefined;
  globalThis.createImageBitmap = bitmap ? () => {} : undefined;
}

afterEach(() => {
  Object.assign(globalThis, ORIGINAL);
});

describe('canUseWorker', () => {
  it('is true only when every piece is present', () => {
    setEnv({ worker: true, offscreen: true, bitmap: true });
    expect(canUseWorker()).toBe(true);
  });

  it('is false without OffscreenCanvas, which is the real gate', () => {
    // Safari only gained OffscreenCanvas in 16.4. Without it there is no canvas inside a
    // worker to re-encode image pages with, so the whole merge has to stay on the main thread.
    setEnv({ worker: true, offscreen: false, bitmap: true });
    expect(canUseWorker()).toBe(false);
  });

  it('is false without Worker or createImageBitmap', () => {
    setEnv({ worker: false, offscreen: true, bitmap: true });
    expect(canUseWorker()).toBe(false);
    setEnv({ worker: true, offscreen: true, bitmap: false });
    expect(canUseWorker()).toBe(false);
  });
});

describe('a worker that never reports for duty', () => {
  /**
   * The failure this guards against showed up as a progress overlay that spun forever with no
   * message and no error, and no way out but closing the tab.
   *
   * `onerror` covers a worker script that fails to *parse*. It does not cover one that never
   * loads at all — offline with the asset missing from the cache, a killed process, a blocked
   * request. Nothing is delivered to `onmessage` either, so the job's promise simply stays
   * pending. The worker now posts `{ type: 'ready' }` at module scope and the page gives up
   * waiting for it after ten seconds, falling back to the main thread.
   */
  function fakeWorkerEnv(behaviour) {
    const instances = [];
    globalThis.Worker = function Worker() {
      this.postMessage = () => behaviour(this);
      this.terminate = vi.fn();
      instances.push(this);
    };
    globalThis.OffscreenCanvas = function OffscreenCanvas() {};
    globalThis.createImageBitmap = () => {};
    return instances;
  }

  const JOB = { jobs: [{ id: 'a', pages: [] }], sources: [], pageSize: 'a4', quality: 'balanced' };

  it('gives up waiting and falls back rather than hanging', async () => {
    vi.useFakeTimers();
    // A worker that is constructed happily and then says nothing at all, ever.
    const instances = fakeWorkerEnv(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { promise } = runPdfJobs(JOB);
    // The main-thread fallback imports pdf-lib and builds an empty document, which is enough:
    // the point is that it settles at all.
    const settled = promise.then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    vi.useRealTimers();

    expect(instances[0].terminate).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('falling back to the main thread'),
      expect.any(Error),
    );
    // What matters is that it settles *at all* — a pending promise here is the hang. Whether
    // the main-thread build then succeeds is merge.test.js's job, and in Node it cannot: the
    // fallback imports the canvas-based image encoder.
    const result = await settled;
    expect(result).toBeDefined();
    expect(result.error).not.toBeInstanceOf(Promise);
    warn.mockRestore();
  }, 30_000);

  it('lets a worker that says hello take as long as it likes', async () => {
    vi.useFakeTimers();
    // Says "ready" immediately, then thinks for well past the startup timeout before
    // answering — exactly what a big document looks like. It must not be interrupted.
    fakeWorkerEnv((worker) => {
      worker.onmessage({ data: { type: 'ready' } });
      setTimeout(() => worker.onmessage({ data: { type: 'done', outputs: [{ id: 'a' }] } }), 60_000);
    });

    const { promise } = runPdfJobs(JOB);
    const settled = promise.then((value) => ({ ok: true, value }));

    await vi.advanceTimersByTimeAsync(60_000);
    vi.useRealTimers();

    expect((await settled).value.outputs).toEqual([{ id: 'a' }]);
  }, 30_000);
});
