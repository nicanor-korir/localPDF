'use client';

import { formatSize } from '../../lib/file-types';

export function FileItem({ entry, index, total, pageCount, failed, canReorder, onMove, onRemove }) {
  const isPdf = entry.type === 'application/pdf';
  const reorderTitle = canReorder
    ? undefined
    : 'Pages from this document are no longer together, so it cannot be moved as one block';

  return (
    <li className={`file-item${failed ? ' file-item-failed' : ''}`}>
      <span className="file-order" aria-hidden="true">
        {index + 1}
      </span>

      <div className={`file-thumb${isPdf ? ' pdf-thumb' : ''}`}>
        {entry.thumbUrl ? <img src={entry.thumbUrl} alt="" /> : 'PDF'}
      </div>

      <div className="file-info">
        <div className="file-name" title={entry.name}>
          {entry.name}
        </div>
        <div className="file-meta">
          {failed
            ? 'Could not be read'
            : `${isPdf ? 'PDF' : (entry.type.split('/')[1] || 'IMG').toUpperCase()} · ${formatSize(entry.size)} · ${pageCount} page${pageCount !== 1 ? 's' : ''}`}
        </div>
      </div>

      <button
        type="button"
        className="move-btn"
        title={reorderTitle}
        aria-label={`Move ${entry.name} earlier`}
        onClick={() => onMove(entry.id, -1)}
        disabled={index === 0 || !canReorder}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
          <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        className="move-btn"
        title={reorderTitle}
        aria-label={`Move ${entry.name} later`}
        onClick={() => onMove(entry.id, 1)}
        disabled={index === total - 1 || !canReorder}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <button type="button" className="file-remove" aria-label={`Remove ${entry.name}`} onClick={() => onRemove(entry.id)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
        </svg>
      </button>
    </li>
  );
}
