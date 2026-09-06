'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { createZip } from '../../lib/zip';
import { createDocx } from '../../lib/docx';
import { toMarkdown, toPlainText } from '../../lib/text-layout';
import { DropZone } from '../_components/drop-zone';
import { LiveRegion, ProgressOverlay, Toast } from '../_components/feedback';
import { PageGrid } from '../_components/page-grid';
import { SourceList } from '../_components/source-list';
import { ToolShell } from '../_components/tool-shell';
import { downloadBytes } from '../_lib/download';
import {
  DEFAULT_FORMAT,
  DEFAULT_RESOLUTION,
  FORMATS,
  RESOLUTIONS,
  extractPageBlocks,
  formatById,
  renderPagesToImages,
} from '../_lib/convert';
import { useDocumentSession } from '../_lib/use-document';

/** `quarterly-report.pdf` → `quarterly-report`. */
const stemOf = (name) => (name || 'document').replace(/\.[^.]+$/, '').trim() || 'document';

export default function ConvertTool() {
  const session = useDocumentSession();
  const { files, pages, totalPages, showToast, addFiles, docs } = session;

  const [format, setFormat] = useState(DEFAULT_FORMAT);
  const [resolution, setResolution] = useState(DEFAULT_RESOLUTION);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const abortRef = useRef(null);

  const spec = useMemo(() => formatById(format), [format]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setProgress('Cancelling...');
  }, []);

  const convert = useCallback(async () => {
    if (busy || pages.length === 0) return;
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const stem = stemOf(files[0]?.name);

    try {
      if (spec.kind === 'image') {
        const dpi = Number(RESOLUTIONS.find((r) => r.id === resolution)?.dpi ?? 150);
        const images = await renderPagesToImages(pages, {
          files,
          docs,
          format: spec.id,
          dpi,
          baseName: `${stem}-page`,
          onProgress: setProgress,
          signal: controller.signal,
        });
        if (images.length === 0) throw new Error('Nothing to convert');

        // One page comes out as one image, not a zip of one.
        if (images.length === 1) {
          downloadBytes(images[0].data, images[0].name, spec.mime);
        } else {
          setProgress('Packing...');
          downloadBytes(createZip(images), `${stem}-${spec.extension}.zip`, 'application/zip');
        }
        showToast(
          images.length === 1
            ? 'Converted and downloaded!'
            : `Converted ${images.length} pages and downloaded.`,
        );
        return;
      }

      const blocks = await extractPageBlocks(pages, {
        files,
        docs,
        onProgress: setProgress,
        signal: controller.signal,
      });

      if (blocks.length === 0) {
        // Almost always a scan: pages of pixels with no text layer to find.
        showToast(
          'No text found. This looks like a scanned document — convert it to images instead.',
          true,
        );
        return;
      }

      const name = `${stem}.${spec.extension}`;
      if (spec.id === 'docx') {
        downloadBytes(createDocx(blocks, { title: stem }), name, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      } else {
        const text = spec.id === 'md' ? toMarkdown(blocks) : toPlainText(blocks);
        downloadBytes(new TextEncoder().encode(text), name, spec.id === 'md' ? 'text/markdown' : 'text/plain');
      }
      showToast(`Converted ${blocks.length} page${blocks.length === 1 ? '' : 's'} and downloaded.`);
    } catch (err) {
      if (err.name === 'MergeCancelled') showToast('Cancelled');
      else {
        console.error('Convert failed:', err);
        showToast(`Could not convert: ${err.message}`, true);
      }
    } finally {
      setBusy(false);
      setProgress('');
      abortRef.current = null;
    }
  }, [busy, pages, files, docs, spec, resolution, showToast]);

  return (
    <ToolShell
      title="Convert a PDF"
      tagline="Turn a PDF into images, text or Word - all on your device."
      actions={
        totalPages > 0 && (
          <button type="button" className="btn btn-primary btn-header-merge" onClick={convert} disabled={busy}>
            Convert
          </button>
        )
      }
    >
      <main className={`layout${files.length === 0 ? ' layout-centered' : ''}`}>
        <div className={`panel-left${files.length === 0 ? ' panel-centered' : ''}`}>
          <DropZone onFiles={addFiles} label="Browse for a PDF or image to convert" />

          {files.length > 0 && (
            <SourceList session={session}>
              <div className="output-settings">
                <label className="setting setting-wide">
                  <span className="setting-label">Convert to</span>
                  <select value={format} onChange={(e) => setFormat(e.target.value)}>
                    {FORMATS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                {spec.kind === 'image' && (
                  <label className="setting setting-wide">
                    <span className="setting-label">Resolution</span>
                    <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
                      {RESOLUTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <p className="field-help">
                {spec.kind === 'image'
                  ? 'Every page becomes an image, exactly as you see it here. More than one page downloads as a zip.'
                  : 'This recovers the words and a rough shape - headings, paragraphs and lists. It does not reproduce the layout, and a scanned page has no text to find.'}
              </p>

              <div className="merge-bar">
                <button
                  type="button"
                  className="btn btn-primary btn-merge"
                  onClick={convert}
                  disabled={busy || totalPages === 0}
                >
                  Convert &amp; Download
                </button>
                <span className="merge-meta">
                  {totalPages} page{totalPages !== 1 ? 's' : ''}
                </span>
              </div>
            </SourceList>
          )}
        </div>

        {files.length > 0 && (
          <PageGrid session={session} hint="Rearrange or crop first if you want to - the output follows what you see" />
        )}

        {busy && <ProgressOverlay message={progress} onCancel={cancel} />}
        <LiveRegion message={session.liveMessage} />
        <Toast toast={session.toast} />
      </main>
    </ToolShell>
  );
}
