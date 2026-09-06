'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { registerServiceWorker } from '../../lib/register-sw';
import { PrivacyBadge } from './privacy-badge';
import { ToolNav } from './tool-nav';

/**
 * The frame every tool sits in: the mark, the tool row, the privacy badge, and a slot for
 * whatever primary action the tool wants in the header.
 *
 * Each tool supplies its own `<h1>`, because the heading is the thing a search engine and a
 * screen reader use to say what this page is — "PDF Tools" would tell neither of them anything.
 */
export function ToolShell({ title, tagline, actions, children }) {
  useEffect(registerServiceWorker, []);

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <Link href="/" className="header-brand" aria-label="PDF Tools home">
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
      {children}
    </>
  );
}
