'use client';

import { useCallback, useState } from 'react';
import { buildDownloadName } from '../../lib/file-types';
import { sanitizeDownloadName } from '../../lib/output-settings';
import { formatPageRanges, parsePageRanges } from '../../lib/page-selection';
import { DropZone } from '../_components/drop-zone';
import { LiveRegion, ProgressOverlay, Toast } from '../_components/feedback';
import { PageGrid } from '../_components/page-grid';
import { SourceList } from '../_components/source-list';
import { ToolShell } from '../_components/tool-shell';
import { useDocumentSession } from '../_lib/use-document';
import { usePageSelection } from '../_lib/use-selection';
import { usePdfOutput } from '../_lib/use-pdf-output';

export default function ExtractTool() {
  const session = useDocumentSession();
  const { files, pages, totalPages, showToast, addFiles, announce, onCancelCrop } = session;
  const output = usePdfOutput({ showToast });
  const selection = usePageSelection(pages);
  const { selectedPages, selectedIndices } = selection;

  // The range box is a bulk selector, not a mirror of the tick boxes. Keeping it one-way means
  // it never fights the user mid-keystroke; what is actually selected is shown below it.
  const [rangeText, setRangeText] = useState('');
  const [rangeError, setRangeError] = useState('');

  const applyRange = useCallback(
    (event) => {
      event?.preventDefault();
      try {
        const { indices } = parsePageRanges(rangeText, totalPages);
        selection.selectIndices(indices);
        setRangeError('');
        announce(`Selected ${indices.length} page${indices.length === 1 ? '' : 's'}`);
      } catch (err) {
        setRangeError(err.message);
      }
    },
    [rangeText, totalPages, selection, announce],
  );

  const extract = useCallback(() => {
    if (selectedPages.length === 0) return;
    onCancelCrop();
    const derived = buildDownloadName(files[0]?.name, 'extracted');
    const name = sanitizeDownloadName(derived, derived);
    output.build({
      jobs: [{ id: 'extracted', name, title: name, pages: selectedPages }],
      sources: session.asSources(),
      pageSize: 'original',
      deliver: output.deliverSingle(name),
      successMessage: () =>
        `Extracted ${selectedPages.length} page${selectedPages.length === 1 ? '' : 's'}.`,
      failureLabel: 'Could not extract',
    });
  }, [selectedPages, files, output, session, onCancelCrop]);

  const count = selectedPages.length;

  return (
    <ToolShell
      title="Extract pages"
      tagline="Make a new PDF from the pages you pick - without uploading anything."
      actions={
        count > 0 && (
          <button type="button" className="btn btn-primary btn-header-merge" onClick={extract} disabled={output.busy}>
            Extract {count}
          </button>
        )
      }
    >
      <main className={`layout${files.length === 0 ? ' layout-centered' : ''}`}>
        <div className={`panel-left${files.length === 0 ? ' panel-centered' : ''}`}>
          <DropZone onFiles={addFiles} label="Browse for a PDF to extract pages from" />

          {files.length > 0 && (
            <SourceList session={session}>
              <form className="range-form" onSubmit={applyRange}>
                <label className="setting setting-wide">
                  <span className="setting-label">Pages to extract</span>
                  <div className="range-row">
                    <input
                      type="text"
                      value={rangeText}
                      placeholder="e.g. 1-3, 5, 9-end"
                      aria-describedby="extract-range-help"
                      onChange={(e) => {
                        setRangeText(e.target.value);
                        setRangeError('');
                      }}
                    />
                    <button type="submit" className="btn btn-ghost btn-sm">
                      Select
                    </button>
                  </div>
                </label>
                {rangeError ? (
                  <p className="field-error" role="alert">
                    {rangeError}
                  </p>
                ) : (
                  <p id="extract-range-help" className="field-help">
                    Or tick pages in the preview. Order follows the document.
                  </p>
                )}
              </form>

              <div className="select-bar">
                <button type="button" className="btn btn-ghost btn-sm" onClick={selection.selectAll}>
                  Select all
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={selection.selectNone}>
                  Clear
                </button>
                <span className="merge-meta">
                  {count === 0 ? 'Nothing selected' : `Selected: ${formatPageRanges(selectedIndices)}`}
                </span>
              </div>

              <div className="merge-bar">
                <button type="button" className="btn btn-primary btn-merge" onClick={extract} disabled={output.busy || count === 0}>
                  Extract &amp; Download
                </button>
                <span className="merge-meta">
                  {count} of {totalPages} page{totalPages !== 1 ? 's' : ''}
                </span>
              </div>
            </SourceList>
          )}
        </div>

        {files.length > 0 && (
          <PageGrid
            session={session}
            hint="Tick the pages you want to keep"
            selection={selection}
          />
        )}

        {output.busy && <ProgressOverlay message={output.progress} onCancel={output.cancel} />}
        <LiveRegion message={session.liveMessage} />
        <Toast toast={session.toast} />
      </main>
    </ToolShell>
  );
}
