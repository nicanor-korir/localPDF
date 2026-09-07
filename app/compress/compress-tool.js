'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { buildDownloadName, formatSize, isAcceptedFile } from '../../lib/file-types';
import { COMPRESSION_LEVELS, DEFAULT_COMPRESSION_LEVEL } from '../../lib/pdf-images';
import { runCrypto } from '../../lib/run-pdf';
import { ToolIntro } from '../_components/tool-intro';
import { DropZone } from '../_components/drop-zone';
import { LiveRegion, ProgressOverlay, Toast } from '../_components/feedback';
import { ToolShell } from '../_components/tool-shell';
import { downloadBytes } from '../_lib/download';
import { useDocumentSession } from '../_lib/use-document';

const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * What the analysis means, in a sentence.
 *
 * Said before anything is changed, because it is the honest answer to "how much smaller can
 * this get". A document that is 4% images has almost nothing to give, and saying so beats a
 * progress bar that ends in a 2% saving.
 */
function describeAnalysis(report) {
  if (!report) return null;
  if (report.imageCount === 0) {
    return 'No images in this one, so there is very little to squeeze out.';
  }
  const share = percent(report.recodableBytes, report.total);
  const images = `${report.imageCount} image${report.imageCount === 1 ? '' : 's'}`;
  if (share < 10) {
    return `${images}, but only about ${share}% of the file. There is not much here to save.`;
  }
  return `${images}, about ${share}% of the file. That is what can be made smaller.`;
}

export default function CompressTool() {
  const session = useDocumentSession();
  const { showToast } = session;

  const [file, setFile] = useState(null);
  const [report, setReport] = useState(null);
  const [level, setLevel] = useState(DEFAULT_COMPRESSION_LEVEL);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const jobRef = useRef(null);

  const analysis = useMemo(() => describeAnalysis(report), [report]);

  const onFiles = useCallback(
    async (list) => {
      const chosen = list[0];
      if (!chosen) return;
      if (!isAcceptedFile(chosen) || !/\.pdf$/i.test(chosen.name)) {
        showToast('Choose a PDF. Only PDFs can be compressed here.', true);
        return;
      }
      setFile(chosen);
      setReport(null);
      setResult(null);
      setError('');
      setBusy(true);
      setProgress('Looking inside...');
      try {
        const buffer = await chosen.arrayBuffer();
        setReport(await runCrypto({ kind: 'analyse', bytes: buffer }).promise);
      } catch (err) {
        setError(err.message);
      } finally {
        setBusy(false);
        setProgress('');
      }
    },
    [showToast],
  );

  const cancel = useCallback(() => {
    jobRef.current?.cancel();
    setProgress('Cancelling...');
  }, []);

  const compress = useCallback(async () => {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const job = runCrypto({
        kind: 'compress',
        bytes: buffer,
        options: { level },
        onProgress: setProgress,
      });
      jobRef.current = job;
      const outcome = await job.promise;

      if (!outcome.changed) {
        // Downloading a copy of the same file, or a slightly bigger one, would be a worse
        // outcome than saying so.
        setResult(outcome);
        showToast('Already about as small as it gets - nothing worth downloading.', true);
        return;
      }

      const name = buildDownloadName(file.name, 'compressed');
      downloadBytes(outcome.bytes, name);
      setResult({ ...outcome, name });
      showToast(`${percent(outcome.before - outcome.after, outcome.before)}% smaller. Downloaded.`);
    } catch (err) {
      if (err.name === 'MergeCancelled') showToast('Cancelled');
      else setError(err.message);
    } finally {
      setBusy(false);
      setProgress('');
      jobRef.current = null;
    }
  }, [file, busy, level, showToast]);

  return (
    <ToolShell
      title="Compress a PDF"
      tagline="Make a PDF smaller - the images are re-encoded on your device, nothing is uploaded."
    >
      <main className="layout layout-centered">
        <div className="panel-left panel-centered">
          <DropZone
            onFiles={onFiles}
            multiple={false}
            accept="application/pdf,.pdf"
            label="Browse for a PDF to compress"
            hint="PDF only"
          />

          {!file && <ToolIntro id="compress" />}

          {file && (
            <section className="tool-panel" aria-label="Compression">
              <div className="tool-panel-head">
                <h2>{file.name}</h2>
                <span className="merge-meta">{formatSize(file.size)}</span>
              </div>

              {analysis && <p className="field-help">{analysis}</p>}

              <label className="setting setting-wide">
                <span className="setting-label">How hard to squeeze</span>
                <select value={level} onChange={(e) => setLevel(e.target.value)} disabled={busy}>
                  {Object.values(COMPRESSION_LEVELS).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}

              <div className="merge-bar">
                <button
                  type="button"
                  className="btn btn-primary btn-merge"
                  onClick={compress}
                  disabled={busy || !file}
                >
                  Compress &amp; Download
                </button>
              </div>

              {result && (
                <p className={result.changed ? 'field-help' : 'field-error'}>
                  {result.changed
                    ? `${formatSize(result.before)} → ${formatSize(result.after)} — ` +
                      `${percent(result.before - result.after, result.before)}% smaller, ` +
                      `${result.recoded} image${result.recoded === 1 ? '' : 's'} re-encoded. ` +
                      `Saved as ${result.name}.`
                    : 'Nothing was made smaller, so the original is still the best version.'}
                </p>
              )}

              <p className="tool-note">
                Text, links and page structure are untouched - only the pictures are re-encoded,
                and only where that actually makes the file smaller. Images this tool cannot read
                safely, like fax and JPEG 2000, are left exactly as they were.
              </p>
            </section>
          )}
        </div>

        {busy && <ProgressOverlay message={progress} onCancel={jobRef.current ? cancel : undefined} />}
        <LiveRegion message={session.liveMessage} />
        <Toast toast={session.toast} />
      </main>
    </ToolShell>
  );
}
