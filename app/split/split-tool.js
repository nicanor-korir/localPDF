'use client';

import { useCallback, useMemo, useState } from 'react';
import { buildDownloadName } from '../../lib/file-types';
import { DEFAULT_SPLIT_MODE, SPLIT_MODES, planSplit, splitPartName } from '../../lib/page-selection';
import { sanitizeDownloadName } from '../../lib/output-settings';
import { DropZone } from '../_components/drop-zone';
import { LiveRegion, ProgressOverlay, Toast } from '../_components/feedback';
import { PageGrid } from '../_components/page-grid';
import { SourceList } from '../_components/source-list';
import { ToolShell } from '../_components/tool-shell';
import { useDocumentSession } from '../_lib/use-document';
import { usePdfOutput } from '../_lib/use-pdf-output';

export default function SplitTool() {
  const session = useDocumentSession();
  const { files, pages, totalPages, showToast, addFiles, onCancelCrop } = session;
  const output = usePdfOutput({ showToast });

  const [mode, setMode] = useState(DEFAULT_SPLIT_MODE);
  const [ranges, setRanges] = useState('');
  const [every, setEvery] = useState('2');

  // Planned as you type, so the plan below the controls is always what the button will do.
  // A plan that cannot be built shows its reason rather than failing at download time.
  const plan = useMemo(() => {
    if (totalPages === 0) return { parts: [], error: '' };
    // An empty range box is not a mistake, it is the starting state. Showing the parser's
    // complaint in red before the user has typed anything reads as though they broke something.
    if (mode === 'ranges' && !ranges.trim()) return { parts: [], error: '' };
    try {
      return { parts: planSplit({ mode, pageCount: totalPages, ranges, every: Number(every) }), error: '' };
    } catch (err) {
      return { parts: [], error: err.message };
    }
  }, [mode, totalPages, ranges, every]);

  const baseName = files[0]?.name || 'document.pdf';

  const split = useCallback(() => {
    if (plan.parts.length === 0) return;
    onCancelCrop();
    const stem = sanitizeDownloadName(buildDownloadName(baseName, 'split'), 'document.pdf').replace(
      /(-split)?\.pdf$/i,
      '',
    );
    const jobs = plan.parts.map((part) => {
      const name = splitPartName(stem, part.label);
      return {
        id: part.label,
        name,
        title: name,
        pages: part.indices.map((i) => pages[i]).filter(Boolean),
      };
    });
    output.build({
      jobs,
      sources: session.asSources(),
      pageSize: 'original',
      deliver: output.deliverZip(`${stem}-split.zip`),
      successMessage: (outputs) => `Split into ${outputs.length} files.`,
      failureLabel: 'Could not split',
    });
  }, [plan, pages, baseName, output, session, onCancelCrop]);

  return (
    <ToolShell
      title="Split a PDF"
      tagline="Break one PDF into several files - entirely on your device."
      actions={
        plan.parts.length > 0 && (
          <button type="button" className="btn btn-primary btn-header-merge" onClick={split} disabled={output.busy}>
            Split into {plan.parts.length}
          </button>
        )
      }
    >
      <main className={`layout${files.length === 0 ? ' layout-centered' : ''}`}>
        <div className={`panel-left${files.length === 0 ? ' panel-centered' : ''}`}>
          <DropZone onFiles={addFiles} label="Browse for a PDF to split" />

          {files.length > 0 && (
            <SourceList session={session}>
              <div className="output-settings">
                <label className="setting setting-wide">
                  <span className="setting-label">Split</span>
                  <select value={mode} onChange={(e) => setMode(e.target.value)}>
                    {Object.values(SPLIT_MODES).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>

                {mode === 'ranges' && (
                  <label className="setting setting-wide">
                    <span className="setting-label">Ranges — one file each</span>
                    <input
                      type="text"
                      value={ranges}
                      placeholder="e.g. 1-3, 4-6, 7-end"
                      onChange={(e) => setRanges(e.target.value)}
                    />
                  </label>
                )}

                {mode === 'every' && (
                  <label className="setting">
                    <span className="setting-label">Pages per file</span>
                    <input
                      type="number"
                      min="1"
                      max={Math.max(1, totalPages - 1)}
                      value={every}
                      onChange={(e) => setEvery(e.target.value)}
                    />
                  </label>
                )}
              </div>

              {plan.error ? (
                <p className="field-error" role="alert">
                  {plan.error}
                </p>
              ) : plan.parts.length === 0 ? (
                <p className="field-help">Enter the ranges you want - one file each.</p>
              ) : (
                <p className="field-help">
                  {plan.parts.length} file{plan.parts.length === 1 ? '' : 's'}: pages{' '}
                  {plan.parts.map((p) => p.label).join(', ')}
                </p>
              )}

              <div className="merge-bar">
                <button
                  type="button"
                  className="btn btn-primary btn-merge"
                  onClick={split}
                  disabled={output.busy || plan.parts.length === 0}
                >
                  Split &amp; Download zip
                </button>
                <span className="merge-meta">
                  {totalPages} page{totalPages !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="tool-note">Downloads one zip containing every part.</p>
            </SourceList>
          )}
        </div>

        {files.length > 0 && <PageGrid session={session} hint="Drag a page to reorder before splitting" />}

        {output.busy && <ProgressOverlay message={output.progress} onCancel={output.cancel} />}
        <LiveRegion message={session.liveMessage} />
        <Toast toast={session.toast} />
      </main>
    </ToolShell>
  );
}
