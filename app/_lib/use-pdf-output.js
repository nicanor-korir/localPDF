'use client';

import { useCallback, useRef, useState } from 'react';
import { describeSkipped } from '../../lib/describe-skipped';
import { MergeCancelled, runPdfJobs } from '../../lib/run-pdf';
import { downloadBytes } from './download';

/**
 * Running a set of PDF jobs and handing the results to the user.
 *
 * Shared by every tool that produces a document, because the awkward parts are the same
 * whichever tool asked: keeping the overlay honest while the worker runs, letting the user
 * cancel, and reporting the files that were skipped rather than quietly dropping them.
 */
export function usePdfOutput({ showToast }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const jobRef = useRef(null);

  const cancel = useCallback(() => {
    jobRef.current?.cancel();
    setProgress('Cancelling...');
  }, []);

  /**
   * Build `jobs`, then hand the outputs to `deliver`.
   *
   * `deliver` receives the finished outputs and is responsible for the download, because that
   * is the one part that genuinely differs: one PDF, or a zip of many.
   *
   * `successMessage` is called with the outputs so a tool can say something specific ("Split
   * into 5 files") rather than a generic "done".
   */
  const build = useCallback(
    async ({ jobs, sources, pageSize, quality, deliver, successMessage, failureLabel = 'Failed' }) => {
      if (busy || jobs.length === 0) return;
      setBusy(true);

      const run = runPdfJobs({ jobs, sources, pageSize, quality, onProgress: setProgress });
      jobRef.current = run;

      try {
        const { outputs } = await run.promise;
        await deliver(outputs);

        // Skips are reported per output, but a file that could not be read fails every part it
        // appears in, so de-duplicate before telling the user about it once.
        const skipped = [];
        const seen = new Set();
        for (const output of outputs) {
          for (const entry of output.skipped || []) {
            const key = `${entry.name}:${entry.reason}`;
            if (seen.has(key)) continue;
            seen.add(key);
            skipped.push(entry);
          }
        }

        // Characters the built-in fonts could not write were substituted, not dropped. Saying
        // so before the user files the document is the whole point of tracking them.
        const unwritable = [
          ...new Set(
            outputs.flatMap((output) =>
              (output.overlayNotes || [])
                .filter((note) => note.type === 'unwritable')
                .flatMap((note) => note.characters),
            ),
          ),
        ];
        if (unwritable.length) {
          showToast(
            `Downloaded, but ${unwritable.map((c) => `"${c}"`).join(', ')} could not be written ` +
              'with the built-in font and became "?".',
            true,
          );
        } else if (skipped.length) {
          // An error toast so it lingers and is announced assertively — a silently dropped
          // file is exactly what the user needs to hear about.
          showToast(
            `Done. Skipped ${skipped.length} file${skipped.length > 1 ? 's' : ''}: ${describeSkipped(skipped)}`,
            true,
          );
        } else {
          showToast(successMessage(outputs));
        }
      } catch (err) {
        if (err instanceof MergeCancelled) {
          showToast('Cancelled');
        } else {
          console.error(`${failureLabel}:`, err);
          showToast(`${failureLabel}: ${err.message}`, true);
        }
      } finally {
        setBusy(false);
        setProgress('');
        jobRef.current = null;
      }
    },
    [busy, showToast],
  );

  /** The common case: one output, downloaded as a PDF. */
  const deliverSingle = useCallback((name) => (outputs) => {
    downloadBytes(outputs[0].bytes, name);
  }, []);

  /** Many outputs, zipped. Loaded on demand so the zip writer is not in the merge bundle. */
  const deliverZip = useCallback(
    (zipName) => async (outputs) => {
      const { createZip, uniqueNames } = await import('../../lib/zip');
      const names = uniqueNames(outputs.map((o) => o.name));
      const zip = createZip(outputs.map((o, i) => ({ name: names[i], data: o.bytes })));
      downloadBytes(zip, zipName, 'application/zip');
    },
    [],
  );

  return { busy, progress, cancel, build, deliverSingle, deliverZip };
}
