'use client';

import { useCallback } from 'react';
import { buildDownloadName } from '../../lib/file-types';
import { sanitizeDownloadName } from '../../lib/output-settings';
import { insertBlankPage } from '../../lib/pages';
import { ToolIntro } from '../_components/tool-intro';
import { DropZone } from '../_components/drop-zone';
import { LiveRegion, ProgressOverlay, Toast } from '../_components/feedback';
import { PageGrid } from '../_components/page-grid';
import { SourceList } from '../_components/source-list';
import { ToolShell } from '../_components/tool-shell';
import { useDocumentSession } from '../_lib/use-document';
import { usePdfOutput } from '../_lib/use-pdf-output';

/**
 * Rearranging a document you already have.
 *
 * The same page model as merge, with one deliberate difference: the output is built with
 * `pageSize: 'original'`, so every page keeps the size it had. Someone reordering a scanned
 * contract has not asked for it to be refitted to A4, and doing that silently would be the
 * kind of change to their document this app must never make on its own.
 */
export default function OrganiseTool() {
  const session = useDocumentSession();
  const { files, pages, totalPages, showToast, addFiles, onCancelCrop } = session;
  const output = usePdfOutput({ showToast });

  // Appended rather than inserted at a chosen point: the pages already drag into place, and a
  // per-page "insert here" button would put two more controls under every card in the app.
  const addBlank = useCallback(() => {
    session.mutate((prev) => insertBlankPage(prev, prev.length - 1), 'Added a blank page');
  }, [session]);

  const save = useCallback(() => {
    if (pages.length === 0) return;
    onCancelCrop();
    const derived = buildDownloadName(files[0]?.name, 'organised');
    const name = sanitizeDownloadName(derived, derived);
    output.build({
      jobs: [{ id: 'organised', name, title: name, pages }],
      sources: session.asSources(),
      pageSize: 'original',
      deliver: output.deliverSingle(name),
      successMessage: () => 'Saved and downloaded!',
      failureLabel: 'Could not save',
    });
  }, [pages, files, output, session, onCancelCrop]);

  return (
    <ToolShell
      title="Organise pages"
      tagline="Reorder, rotate, crop and delete pages - all on your device."
      actions={
        totalPages > 0 && (
          <button type="button" className="btn btn-primary btn-header-merge" onClick={save} disabled={output.busy}>
            Save &amp; Download
          </button>
        )
      }
    >
      <main className={`layout${files.length === 0 ? ' layout-centered' : ''}`}>
        <div className={`panel-left${files.length === 0 ? ' panel-centered' : ''}`}>
          <DropZone onFiles={addFiles} label="Browse for PDF or image files to organise" />

          {files.length === 0 && <ToolIntro id="organise" />}

          {files.length > 0 && (
            <SourceList session={session}>
              <div className="merge-bar">
                <button type="button" className="btn btn-primary btn-merge" onClick={save} disabled={output.busy || totalPages === 0}>
                  Save &amp; Download PDF
                </button>
                <span className="merge-meta">
                  {totalPages} page{totalPages !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="tool-note">Pages keep their original size.</p>
            </SourceList>
          )}
        </div>

        {files.length > 0 && (
          <PageGrid session={session} hint="Drag a page to reorder, or use the buttons on each page">
            <button type="button" className="btn btn-ghost btn-sm" onClick={addBlank}>
              Add blank page
            </button>
          </PageGrid>
        )}

        {output.busy && <ProgressOverlay message={output.progress} onCancel={output.cancel} />}
        <LiveRegion message={session.liveMessage} />
        <Toast toast={session.toast} />
      </main>
    </ToolShell>
  );
}
