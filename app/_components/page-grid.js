'use client';

import { PageCard } from './page-card';

/**
 * The output preview: one card per page of the document being built.
 *
 * Not virtualised, on purpose. `.preview-page` carries `content-visibility: auto`, so the
 * browser skips layout and paint for pages nowhere near the viewport — on a 2000-page document
 * that took a forced layout from 2793ms to 290ms. True windowing was rejected because it would
 * break find-in-page and complicate drag-and-drop, for a case two CSS declarations handle with
 * graceful degradation on browsers that lack them.
 */
export function PageGrid({ session, heading = 'Pages', hint, selection = null, children }) {
  const {
    files,
    pages,
    totalPages,
    getBitmap,
    undo,
    historyDepth,
    croppingId,
    onStartCrop,
    onCancelCrop,
    onApplyCrop,
    onRotate,
    onDeletePage,
    onMovePage,
    draggedId,
    dragTargetId,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDragEnd,
    onItemDrop,
  } = session;

  return (
    <section className="panel-right" aria-labelledby="preview-heading">
      <div className="preview-scroll">
        <div className="preview-header">
          <h2 id="preview-heading" className="preview-title">
            {heading}
          </h2>
          <div className="preview-header-actions">
            {children}
            {historyDepth > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={undo}
                title="Undo the last page change (Ctrl or Cmd + Z)"
              >
                Undo
              </button>
            )}
            <span className="preview-pages">
              {totalPages} page{totalPages !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        {hint && <p className="reorder-hint">{hint}</p>}

        {totalPages === 0 ? (
          <p className="preview-empty">No pages yet.</p>
        ) : (
          <div className="preview-pages-list">
            {pages.map((page, index) => (
              <PageCard
                key={page.id}
                page={page}
                index={index}
                total={pages.length}
                source={files.find((f) => f.id === page.fileId)}
                getBitmap={getBitmap}
                cropping={croppingId === page.id}
                onStartCrop={onStartCrop}
                onCancelCrop={onCancelCrop}
                onApplyCrop={onApplyCrop}
                onRotate={onRotate}
                onDelete={onDeletePage}
                onMove={onMovePage}
                isDragging={draggedId === page.id}
                isDragTarget={dragTargetId === page.id}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onItemDrop}
                onDragEnd={onDragEnd}
                selectable={!!selection}
                selected={selection ? selection.selected.has(page.id) : false}
                onToggleSelect={selection ? selection.toggle : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
