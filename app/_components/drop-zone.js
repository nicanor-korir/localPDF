'use client';

import { useRef, useState } from 'react';
import { ACCEPTED } from '../../lib/file-types';

/**
 * The file intake.
 *
 * Drag/drop is a mouse affordance; the "browse" button is the keyboard entry point, so the
 * wrapper is deliberately not itself a `role="button"` — that would nest interactive controls
 * and give assistive technology two entry points where there is really one.
 */
export function DropZone({ onFiles, multiple = true, label, hint = 'PDF, PNG, JPG, JPEG, WebP' }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`drop-zone${dragOver ? ' drag-over' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onFiles(e.dataTransfer.files);
      }}
    >
      <svg className="drop-zone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" focusable="false">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17 8l-5-5-5 5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="drop-zone-text">
        Drop {multiple ? 'files' : 'a file'} here or{' '}
        <button
          type="button"
          className="browse-link"
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          browse
        </button>
      </p>
      <p className="drop-zone-hint">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={ACCEPTED}
        style={{ display: 'none' }}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
