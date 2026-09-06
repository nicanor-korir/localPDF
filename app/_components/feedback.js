'use client';

/**
 * The three ways the app says something: a blocking progress overlay, a transient toast, and a
 * permanently-mounted live region for screen readers.
 *
 * The live region is always in the tree, never conditionally rendered — a live region that
 * appears at the same moment its text does is not reliably announced.
 */

export function ProgressOverlay({ message, onCancel }) {
  return (
    <div className="progress-overlay" role="status" aria-live="polite" aria-busy="true">
      <div className="progress-card">
        <div className="spinner" aria-hidden="true" />
        <p className="progress-text">{message || 'Working...'}</p>
        {onCancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export function LiveRegion({ message }) {
  return (
    <div className="sr-only" role="status" aria-live="polite">
      {message}
    </div>
  );
}

export function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div
      className={`toast${toast.isError ? ' toast-error' : ''}`}
      role={toast.isError ? 'alert' : 'status'}
      aria-live={toast.isError ? 'assertive' : 'polite'}
    >
      {toast.message}
    </div>
  );
}
