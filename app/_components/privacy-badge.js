'use client';

import { useEffect, useRef, useState } from 'react';

// Reads the policy actually in force rather than restating it. The claim that files never
// leave the device is the whole reason to choose this over an upload-based tool, and a claim
// nobody can check is just marketing — so the badge opens into the live CSP and tells you how
// to confirm it in thirty seconds.
export function PrivacyBadge() {
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    setPolicy(
      document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ??
        'Served as an HTTP header by the host.',
    );

    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  // Pulled out and shown on its own because it is the load-bearing directive: it blocks every
  // outbound fetch, XHR and beacon.
  const connectSrc = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('connect-src'));

  return (
    <div className="privacy" ref={wrapRef}>
      <button
        type="button"
        className="privacy-badge"
        aria-expanded={open}
        aria-label="Private. How this is enforced"
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" focusable="false">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
        Private
      </button>

      {open && (
        <div className="privacy-panel" role="dialog" aria-label="How privacy is enforced">
          <p className="privacy-lead">Your files never leave this device.</p>
          <ul className="privacy-points">
            <li>There is no server. This is a static page with no backend, no database and no analytics.</li>
            <li>The page is not permitted to send anything out, by policy the browser enforces.</li>
            <li>The offline cache only ever stores this app&apos;s own files, never your documents.</li>
          </ul>

          <p className="privacy-heading">Don&apos;t take our word for it</p>
          <p className="privacy-check">
            Open your browser&apos;s developer tools, switch to the Network tab, then add files and
            merge them. Nothing leaves, so you&apos;ll see requests for this page&apos;s own assets and
            nothing else.
          </p>

          <p className="privacy-heading">The policy in force right now</p>
          {connectSrc && <code className="privacy-directive">{connectSrc}</code>}
          <pre className="privacy-csp">{policy}</pre>
        </div>
      )}
    </div>
  );
}
