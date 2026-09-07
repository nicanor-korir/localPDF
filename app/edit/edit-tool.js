'use client';

import { useCallback, useMemo, useState } from 'react';
import { buildDownloadName } from '../../lib/file-types';
import { sanitizeDownloadName } from '../../lib/output-settings';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_COLOURS,
  addImage,
  addText,
  groupOverlays,
  removeOverlay,
  setBox,
  unwritableCharacters,
  updateOverlay,
} from '../../lib/overlays';
import { DropZone } from '../_components/drop-zone';
import { LiveRegion, ProgressOverlay, Toast } from '../_components/feedback';
import { SourceList } from '../_components/source-list';
import { ToolShell } from '../_components/tool-shell';
import { useDocumentSession } from '../_lib/use-document';
import { usePdfOutput } from '../_lib/use-pdf-output';
import { EditPage } from './edit-page';

const EMPTY = [];
// Where a new box lands: near the top-left, wide enough to type into, out of the way of itself.
const NEW_TEXT_BOX = { x: 0.08, y: 0.08, width: 0.5, height: 0.06 };
const NEW_IMAGE_BOX = { x: 0.3, y: 0.35, width: 0.4, height: 0.25 };

export default function EditTool() {
  const session = useDocumentSession();
  const { files, pages, overlays, totalPages, showToast, addFiles, editOverlays } = session;
  const output = usePdfOutput({ showToast });

  const [selectedId, setSelectedId] = useState(null);

  const grouped = useMemo(() => groupOverlays(overlays), [overlays]);
  const selected = useMemo(() => overlays.find((o) => o.id === selectedId) ?? null, [overlays, selectedId]);
  const imageSources = useMemo(() => files.filter((f) => f.type !== 'application/pdf'), [files]);

  const onAddText = useCallback(
    (pageId) => {
      let created = null;
      editOverlays((list) => {
        const next = addText(list, pageId, NEW_TEXT_BOX, { text: '' });
        created = next[next.length - 1];
        return next;
      }, 'Added a text box');
      if (created) setSelectedId(created.id);
    },
    [editOverlays],
  );

  const onAddImage = useCallback(
    (pageId) => {
      const picture = imageSources[0];
      if (!picture) return;
      let created = null;
      editOverlays((list) => {
        const next = addImage(list, pageId, NEW_IMAGE_BOX, picture.id);
        created = next[next.length - 1];
        return next;
      }, `Placed ${picture.name}`);
      if (created) setSelectedId(created.id);
    },
    [editOverlays, imageSources],
  );

  const onChangeBox = useCallback(
    (id, box) => editOverlays((list) => setBox(list, id, box)),
    [editOverlays],
  );

  const onUpdate = useCallback(
    (changes) => {
      if (!selectedId) return;
      editOverlays((list) => updateOverlay(list, selectedId, changes));
    },
    [editOverlays, selectedId],
  );

  const onRemove = useCallback(() => {
    if (!selectedId) return;
    editOverlays((list) => removeOverlay(list, selectedId), 'Removed it');
    setSelectedId(null);
  }, [editOverlays, selectedId]);

  const save = useCallback(() => {
    if (pages.length === 0) return;
    const derived = buildDownloadName(files[0]?.name, 'edited');
    const name = sanitizeDownloadName(derived, derived);
    output.build({
      jobs: [{ id: 'edited', name, title: name, pages, overlays }],
      sources: session.asSources(),
      pageSize: 'original',
      deliver: output.deliverSingle(name),
      successMessage: () => 'Saved and downloaded!',
      failureLabel: 'Could not save',
    });
  }, [pages, overlays, files, output, session]);

  const unwritable = selected?.type === 'text' ? unwritableCharacters(selected.text) : EMPTY;

  return (
    <ToolShell
      title="Edit a PDF"
      tagline="Add text and images to a page - all on your device."
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
          <DropZone onFiles={addFiles} label="Browse for a PDF or image to edit" />

          {files.length > 0 && (
            <SourceList session={session}>
              {selected ? (
                <div className="overlay-editor">
                  <div className="section-bar">
                    <h2>{selected.type === 'text' ? 'Text' : 'Image'}</h2>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
                      Remove
                    </button>
                  </div>

                  {selected.type === 'text' ? (
                    <>
                      <label className="setting setting-wide">
                        <span className="setting-label">What it says</span>
                        <input
                          type="text"
                          value={selected.text}
                          autoFocus
                          placeholder="Type something"
                          onChange={(e) => onUpdate({ text: e.target.value })}
                        />
                      </label>
                      {unwritable.length > 0 && (
                        <p className="field-error" role="alert">
                          {unwritable.map((c) => `"${c}"`).join(', ')} cannot be written with the
                          built-in font and will come out as &ldquo;?&rdquo;.
                        </p>
                      )}
                      <div className="output-settings">
                        <label className="setting">
                          <span className="setting-label">Size</span>
                          <input
                            type="number"
                            min="6"
                            max="96"
                            value={selected.size ?? DEFAULT_TEXT_SIZE}
                            onChange={(e) => onUpdate({ size: Number(e.target.value) || DEFAULT_TEXT_SIZE })}
                          />
                        </label>
                        <label className="setting">
                          <span className="setting-label">Colour</span>
                          <select value={selected.colour} onChange={(e) => onUpdate({ colour: e.target.value })}>
                            {TEXT_COLOURS.map((colour) => (
                              <option key={colour.id} value={colour.id}>
                                {colour.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </>
                  ) : (
                    <label className="setting setting-wide">
                      <span className="setting-label">Which image</span>
                      <select value={selected.fileId} onChange={(e) => onUpdate({ fileId: e.target.value })}>
                        {imageSources.map((image) => (
                          <option key={image.id} value={image.id}>
                            {image.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <p className="field-help">Drag it to move, or pull the corner to resize.</p>
                </div>
              ) : (
                <p className="field-help">
                  Use <strong>+ Text</strong> or <strong>+ Image</strong> under any page, then click
                  what you added to change it.
                </p>
              )}

              <div className="merge-bar">
                <button
                  type="button"
                  className="btn btn-primary btn-merge"
                  onClick={save}
                  disabled={output.busy || totalPages === 0}
                >
                  Save &amp; Download PDF
                </button>
                <span className="merge-meta">
                  {overlays.length} added
                </span>
              </div>
              <p className="tool-note">
                This adds things on top of a page. It cannot change the text that is already
                there - that would need the document&rsquo;s own fonts, which a PDF does not
                carry in an editable form.
              </p>
            </SourceList>
          )}
        </div>

        {files.length > 0 && (
          <section className="panel-right" aria-labelledby="edit-heading">
            <div className="preview-scroll">
              <div className="preview-header">
                <h2 id="edit-heading" className="preview-title">
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
              <p className="reorder-hint">Add text or an image under any page, then drag it into place</p>

              <div className="preview-pages-list">
                {pages.map((page, index) => (
                  <EditPage
                    key={page.id}
                    page={page}
                    index={index}
                    source={files.find((f) => f.id === page.fileId)}
                    getBitmap={session.getBitmap}
                    overlays={grouped.get(page.id) ?? EMPTY}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onChangeBox={onChangeBox}
                    onAddText={onAddText}
                    onAddImage={onAddImage}
                    canAddImage={imageSources.length > 0}
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
