'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { TERMS } from '../../lib/terms';

/**
 * The agreement, shown over the tool until it is accepted.
 *
 * Two deliberate choices about how it blocks:
 *
 * **It covers the page rather than replacing it.** The tool underneath still renders, and still
 * ships in the prerendered HTML, because each tool page carries an intro and real questions
 * that are most of what a search engine has to go on. Swapping that for a modal would hand
 * every crawler an empty page. The content is marked `inert` instead, so it cannot be clicked,
 * tabbed into, or read out while the agreement is up.
 *
 * **Escape does not dismiss it.** A dialog you cannot escape is normally a bad idea, and this
 * is the exception the rule exists for: there is a real way out on the page ("Not now" goes
 * back to the home page), so nobody is trapped, and a gate that closes on a stray keypress is
 * not a gate.
 */
export function TermsGate({ onAccept }) {
  const acceptRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => {
    acceptRef.current?.focus();

    // Keep Tab inside the dialog. Without this the focus ring walks off into the tool behind,
    // which `inert` hides from the keyboard but which browsers without it would still expose.
    const onKeyDown = (event) => {
      if (event.key !== 'Tab') return;
      const focusable = cardRef.current?.querySelectorAll('a[href], button');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="terms-gate">
      <div
        className="terms-card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-title"
        aria-describedby="terms-lead"
      >
        <p className="terms-kicker">Before you start</p>
        <h2 id="terms-title">How these tools use your files</h2>
        <p className="terms-lead" id="terms-lead">
          This is the whole agreement. It is short because there is very little to agree to.
        </p>

        <ul className="terms-points">
          {TERMS.map((point) => (
            <li key={point.title}>
              <span className="terms-point-title">{point.title}</span>
              <span className="terms-point-body">{point.body}</span>
            </li>
          ))}
        </ul>

        <div className="terms-actions">
          <button type="button" className="btn btn-primary" ref={acceptRef} onClick={onAccept}>
            I understand, let me in
          </button>
          {/* A real way out, so the dialog is a choice rather than a trap. */}
          <Link href="/" className="btn btn-ghost">
            Not now
          </Link>
        </div>

        <p className="terms-foot">
          You can read the policy your browser is enforcing at any time from the Private badge
          in the header.
        </p>
      </div>
    </div>
  );
}
