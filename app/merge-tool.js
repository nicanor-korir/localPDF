'use client';

import { useCallback, useState } from 'react';
import { buildDownloadName } from '../lib/file-types';
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_QUALITY,
  PAGE_SIZES,
  QUALITY_PRESETS,
  sanitizeDownloadName,
} from '../lib/output-settings';
import { ToolIntro } from './_components/tool-intro';
import { DropZone } from './_components/drop-zone';
import { LiveRegion, ProgressOverlay, Toast } from './_components/feedback';
import { PageGrid } from './_components/page-grid';
import { SourceList } from './_components/source-list';
import { ToolShell } from './_components/tool-shell';
import { useDocumentSession } from './_lib/use-document';
import { usePdfOutput } from './_lib/use-pdf-output';

const DownloadIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function MergeTool() {
  const session = useDocumentSession();
  const { files, pages, totalPages, showToast, addFiles, onCancelCrop } = session;
  const output = usePdfOutput({ showToast });

  const [quality, setQuality] = useState(DEFAULT_QUALITY);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // Empty means "use the derived name", which the placeholder shows.
  const [fileName, setFileName] = useState('');

  const merge = useCallback(() => {
    if (pages.length === 0) return;
    onCancelCrop();
    const derived = buildDownloadName(files[0]?.name);
    const downloadName = sanitizeDownloadName(fileName || derived, derived);
    output.build({
      jobs: [{ id: 'merged', name: downloadName, title: downloadName, pages }],
      sources: session.asSources(),
      pageSize,
      quality,
      deliver: output.deliverSingle(downloadName),
      successMessage: () => 'PDF merged and downloaded!',
      failureLabel: 'Merge failed',
    });
  }, [pages, files, fileName, pageSize, quality, output, session, onCancelCrop]);

  return (
    <ToolShell
      title="Merge PDFs"
      tagline="Combine PDFs &amp; images locally - your files never leave your device."
      actions={
        totalPages > 0 && (
          <button type="button" className="btn btn-primary btn-header-merge" onClick={merge} disabled={output.busy}>
            <DownloadIcon size={14} />
            Merge &amp; Download
          </button>
        )
      }
    >
      <main className={`layout${files.length === 0 ? ' layout-centered' : ''}`}>
        <div className={`panel-left${files.length === 0 ? ' panel-centered' : ''}`}>
          <DropZone onFiles={addFiles} label="Browse for PDF or image files to merge" />

          {files.length === 0 && <ToolIntro id="merge" />}

          {files.length > 0 && (
            <SourceList session={session}>
              <div className="output-settings">
                <label className="setting">
                  <span className="setting-label">Image quality</span>
                  <select value={quality} onChange={(e) => setQuality(e.target.value)}>
                    {Object.values(QUALITY_PRESETS).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="setting">
                  <span className="setting-label">Page size</span>
                  <select value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
                    {Object.values(PAGE_SIZES).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="setting setting-wide">
                  <span className="setting-label">File name</span>
                  <input
                    type="text"
                    value={fileName}
                    placeholder={buildDownloadName(files[0]?.name)}
                    onChange={(e) => setFileName(e.target.value)}
                  />
                </label>
              </div>

              <div className="merge-bar">
                <button type="button" className="btn btn-primary btn-merge" onClick={merge} disabled={output.busy || totalPages === 0}>
                  <DownloadIcon />
                  Merge &amp; Download PDF
                </button>
                <span className="merge-meta">
                  {totalPages} page{totalPages !== 1 ? 's' : ''} total
                </span>
              </div>
            </SourceList>
          )}
        </div>

        {files.length > 0 && (
          <PageGrid session={session} hint="Drag a page to reorder, or use the buttons on each page" />
        )}

        {output.busy && <ProgressOverlay message={output.progress} onCancel={output.cancel} />}
        <LiveRegion message={session.liveMessage} />
        <Toast toast={session.toast} />
      </main>
    </ToolShell>
  );
}
