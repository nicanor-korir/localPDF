'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { registerServiceWorker } from '../../lib/register-sw';
import { useTermsAcceptance } from '../_lib/use-terms';
import { PrivacyBadge } from './privacy-badge';
import { TermsGate } from './terms-gate';
import { ToolNav } from './tool-nav';

/**
 * The frame every tool sits in: the mark, the tool row, the privacy badge, and a slot for
 * whatever primary action the tool wants in the header.
 *
 * Each tool supplies its own `<h1>`, because the heading is the thing a search engine and a
 * screen reader use to say what this page is — "PDF Tools" would tell neither of them anything.
 */
export function ToolShell({ title, tagline, actions, children }) {
  // Held in an object because the value *is* a function, and a bare setState would treat it
  // as an updater and call it immediately.
  const [update, setUpdate] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  // `pending` is null for the first frame, while the browser is asked what it remembers. See
  // use-terms.js: this is a static export, so neither answer is known at build time.
  const { pending, accept } = useTermsAcceptance();

  useEffect(() => registerServiceWorker((apply) => setUpdate({ apply })), []);

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <Link href="/" className="header-brand" aria-label="LocalPDF home">
            <span className="header-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 18v-6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9 15h6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </Link>
          <div className="header-titles">
            <h1>{title}</h1>
            <p>{tagline}</p>
          </div>
          <div className="header-actions">
            {actions}
            <PrivacyBadge />
          </div>
        </div>
        <ToolNav />
      </header>

      {/*
        The worker deliberately has no skipWaiting(): the app imports pdf.js on demand, and
        activating a new version early could 404 a chunk out from under a page that is still
        running. The cost is that a returning visitor keeps the old build until every tab for
        the site has closed — which, with tools shipping regularly, is long enough to be worth
        one line. Dismissible, and it only ever appears when an update is genuinely waiting.
      */}
      {update && !dismissed && (
        <div className="update-banner" role="status">
          <span>A newer version of these tools is ready.</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={update.apply}>
            Reload
          </button>
          <button
            type="button"
            className="update-dismiss"
            aria-label="Dismiss the update notice"
            onClick={() => setDismissed(true)}
          >
            &times;
          </button>
        </div>
      )}
      {/*
        Marked inert rather than unmounted, so the tool's intro and questions stay in the
        prerendered HTML where a search engine can read them. Inert takes it out of the tab
        order and out of the accessibility tree for as long as the agreement is up.
      */}
      <div className="tool-shell-body" inert={pending === true}>
        {children}
      </div>

      {pending === true && <TermsGate onAccept={accept} />}
    </>
  );
}
