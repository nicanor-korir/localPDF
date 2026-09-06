'use client';

import { FileItem } from './file-item';

/** The sources the user added, as opposed to the pages of the output. */
export function SourceList({ session, children }) {
  const { files, docsRef, grouped, pageCountsByFile, moveDocument, removeFile, clearAll } = session;

  return (
    <section className="file-section" aria-label="Source documents">
      <div className="section-bar">
        <h2>
          Documents <span className="count-badge">{files.length}</span>
        </h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll}>
          Clear all
        </button>
      </div>
      <ul className="file-list" aria-label="Source documents, in order">
        {files.map((entry, index) => (
          <FileItem
            key={entry.id}
            entry={entry}
            index={index}
            total={files.length}
            pageCount={pageCountsByFile.get(entry.id) ?? 0}
            failed={docsRef.current.get(entry.id)?.failed}
            canReorder={grouped}
            onMove={moveDocument}
            onRemove={removeFile}
          />
        ))}
      </ul>
      {children}
    </section>
  );
}
