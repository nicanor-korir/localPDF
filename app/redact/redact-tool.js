'use client';

import { useCallback, useMemo, useState } from 'react';
import { buildDownloadName, generateId } from '../../lib/file-types';
import { sanitizeDownloadName } from '../../lib/output-settings';
import {
  addRedaction,
  groupOverlays,
  redactedPageIds,
  redactionsForPage,
  removeOverlay,
  setBox,
} from '../../lib/overlays';
import { ToolIntro } from '../_components/tool-intro';
import { DropZone } from '../_components/drop-zone';
import { LiveRegion, ProgressOverlay, Toast } from '../_components/feedback';
import { SourceList } from '../_components/source-list';
import { ToolShell } from '../_components/tool-shell';
import { withTimerDrivenFrames } from '../_lib/convert';
import { rasteriseRedactedPage, verifyRedaction } from '../_lib/redact';
import { useDocumentSession } from '../_lib/use-document';
import { usePdfOutput } from '../_lib/use-pdf-output';
import { RedactPage } from './redact-page';

const EMPTY = [];

export default function RedactTool() {
  const session = useDocumentSession();
  const { files, pages, overlays, totalPages, showToast, addFiles, editOverlays, docs } = session;
  const output = usePdfOutput({ showToast });

  const [selectedId, setSelectedId] = useState(null);
  const [result, setResult] = useState(null);

  const grouped = useMemo(() => groupOverlays(overlays), [overlays]);
  const redactedPages = useMemo(() => redactedPageIds(overlays), [overlays]);
  const regionCount = useMemo(
    () => overlays.filter((o) => o.type === 'redaction').length,
    [overlays],
  );

  const onDraw = useCallback(
    (pageId, box) => {
      editOverlays((list) => addRedaction(list, pageId, box), 'Marked a region');
    },
    [editOverlays],
  );

  const onChangeBox = useCallback(
    (id, box) => editOverlays((list) => setBox(list, id, box)),
    [editOverlays],
  );

  const onRemove = useCallback(
    (id) => {
      editOverlays((list) => removeOverlay(list, id), 'Unmarked a region');
      setSelectedId(null);
    },
    [editOverlays],
  );

  /**
   * Replace every redacted page with a picture of itself, boxes burned in.
   *
   * The replacement carries no rotation or crop of its own: those are already in the pixels,
   * and applying them a second time would turn the page twice. `pageBox` keeps the output page
   * exactly the size the original was.
   */
  const buildReplacements = useCallback(async () => {
    const sources = session.asSources();
    const outPages = [];
    const redactedIndexes = [];

    await withTimerDrivenFrames(async () => {
      for (let index = 0; index < pages.length; index++) {
        const page = pages[index];
        const regions = redactionsForPage(overlays, page.id);
        if (regions.length === 0) {
          outPages.push(page);
          continue;
        }

        output.setProgress(`Removing content from page ${index + 1}`);
        const source = files.find((file) => file.id === page.fileId);
        const { blob, width, height } = await rasteriseRedactedPage(
          page,
          source,
          docs.get(page.fileId)?.pdf,
          regions,
        );

        const fileId = generateId();
        sources.push({
          fileId,
          name: `redacted-page-${index + 1}.png`,
          type: 'image/png',
          file: new File([blob], `redacted-page-${index + 1}.png`, { type: 'image/png' }),
        });
        outPages.push({
          id: page.id,
          fileId,
          sourceIndex: 0,
          rotation: 0,
          crop: null,
          pageBox: { width, height },
        });
        redactedIndexes.push(index);
      }
    });

    return { sources, outPages, redactedIndexes };
  }, [pages, overlays, files, docs, session, output]);

  const apply = useCallback(async () => {
    if (regionCount === 0 || output.busy) return;
    setResult(null);

    let prepared;
    output.setBusy(true);
    try {
      prepared = await buildReplacements();
    } catch (err) {
      console.error('Could not prepare the redaction:', err);
      showToast(`Could not redact: ${err.message}`, true);
      return;
    } finally {
      output.setBusy(false);
      output.setProgress('');
    }

    const derived = buildDownloadName(files[0]?.name, 'redacted');
    const name = sanitizeDownloadName(derived, derived);

    await output.build({
      jobs: [{ id: 'redacted', name, title: name, pages: prepared.outPages, overlays }],
      sources: prepared.sources,
      pageSize: 'original',
      // Nothing is downloaded until the removal has been checked.
      deliver: async (outputs) => {
        const leaked = await verifyRedaction(outputs[0].bytes, prepared.redactedIndexes);
        if (leaked.length > 0) {
          setResult({ ok: false, leaked });
          throw new Error(
            `text is still readable on page ${leaked.map((i) => i + 1).join(', ')} — nothing was downloaded`,
          );
        }
        setResult({ ok: true, pages: prepared.redactedIndexes.length });
        output.deliverSingle(name)(outputs);
      },
      successMessage: () => 'Redacted and downloaded.',
      failureLabel: 'Redaction failed',
    });
  }, [regionCount, output, buildReplacements, files, overlays, showToast]);

  return (
    <ToolShell
      title="Redact a PDF"
      tagline="Remove content for good - not a black box over it."
      actions={
        regionCount > 0 && (
          <button type="button" className="btn btn-primary btn-header-merge" onClick={apply} disabled={output.busy}>
            Redact {regionCount}
          </button>
        )
      }
    >
      <main className={`layout${files.length === 0 ? ' layout-centered' : ''}`}>
        <div className={`panel-left${files.length === 0 ? ' panel-centered' : ''}`}>
          <DropZone onFiles={addFiles} label="Browse for a PDF to redact" />

          {files.length === 0 && <ToolIntro id="redact" />}

          {files.length > 0 && (
            <SourceList session={session}>
              <p className="field-help">
                Drag across a page to mark what should go. {regionCount === 0
                  ? 'Nothing is marked yet.'
                  : `${regionCount} region${regionCount === 1 ? '' : 's'} on ${redactedPages.size} page${
                      redactedPages.size === 1 ? '' : 's'
                    }.`}
              </p>

              {result && (
                <p className={result.ok ? 'field-help' : 'field-error'} role={result.ok ? undefined : 'alert'}>
                  {result.ok
                    ? `Checked: no text remains on ${result.pages} redacted page${result.pages === 1 ? '' : 's'}.`
                    : `Text is still readable on page ${result.leaked.map((i) => i + 1).join(', ')}. Nothing was downloaded.`}
                </p>
              )}

              <div className="merge-bar">
                <button
                  type="button"
                  className="btn btn-primary btn-merge"
                  onClick={apply}
                  disabled={output.busy || regionCount === 0}
                >
                  Redact &amp; Download
                </button>
                <span className="merge-meta">
                  {totalPages} page{totalPages !== 1 ? 's' : ''}
                </span>
              </div>

              <p className="tool-note">
                A black rectangle drawn over text in a PDF hides nothing - the words are still in
                the file, and anyone can select or copy them. So a redacted page is turned into a
                picture of itself instead: what was under the box stops existing. The cost is
                real and worth knowing - <strong>a redacted page loses its selectable text and
                its links</strong>, including the parts you did not mark. Pages you left alone
                are untouched. The result is checked before it downloads.
              </p>
            </SourceList>
          )}
        </div>

        {files.length > 0 && (
          <section className="panel-right" aria-labelledby="redact-heading">
            <div className="preview-scroll">
              <div className="preview-header">
                <h2 id="redact-heading" className="preview-title">
                  Pages
                </h2>
                <div className="preview-header-actions">
                  {session.historyDepth > 0 && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={session.undo}>
                      Undo
                    </button>
                  )}
                  <span className="preview-pages">
                    {totalPages} page{totalPages !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
              <p className="reorder-hint">Drag across anything that should not be in the document</p>

              <div className="preview-pages-list">
                {pages.map((page, index) => (
                  <RedactPage
                    key={page.id}
                    page={page}
                    index={index}
                    source={files.find((file) => file.id === page.fileId)}
                    getBitmap={session.getBitmap}
                    redactions={(grouped.get(page.id) ?? EMPTY).filter((o) => o.type === 'redaction')}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onDraw={onDraw}
                    onChangeBox={onChangeBox}
                    onRemove={onRemove}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        {output.busy && <ProgressOverlay message={output.progress} onCancel={output.cancel} />}
        <LiveRegion message={session.liveMessage} />
        <Toast toast={session.toast} />
      </main>
    </ToolShell>
  );
}
