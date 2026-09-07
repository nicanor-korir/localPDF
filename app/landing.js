'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ACCEPTED } from '../lib/file-types';
import { READY_TOOLS } from '../lib/tools';
import { registerServiceWorker } from '../lib/register-sw';
import { useDocumentSession } from './_lib/use-document';

const HIGHLIGHTS = [
  {
    title: 'Nothing leaves your computer',
    body:
      'Your files are opened and worked on right here in the tab. They are never sent to a server, because there is no server to send them to.',
  },
  {
    title: 'Keeps working without internet',
    body:
      'Load the page once and it works on a plane, on a train, or on a locked down office laptop. You can install it and use it like any other app.',
  },
  {
    title: 'No account, no limits',
    body:
      'No sign up, no watermark on your document, no daily cap, and nothing to pay to lift a restriction we put there ourselves.',
  },
];

const QUESTIONS = [
  {
    q: 'Is this really free?',
    a: 'Yes. There is no paid tier, no trial and no watermark. Running it costs us nothing beyond hosting a few files, because your computer does all the work.',
  },
  {
    q: 'How big a file can I use?',
    a: 'As big as your computer can hold. There is no server deciding you have hit a limit, so the only ceiling is your own memory.',
  },
  {
    q: 'Do I need to install anything?',
    a: 'No. It runs in the browser you already have. If you want it in your dock or on your home screen, your browser can install it from its own menu.',
  },
  {
    q: 'Can I use it on confidential documents?',
    a: 'That is exactly what it is for. Nothing is uploaded, so a contract, a payslip or a medical letter never leaves your machine. The Private badge on every tool shows you the policy your browser is enforcing.',
  },
];

export default function Landing() {
  const session = useDocumentSession();
  const router = useRouter();
  const [dragging, setDragging] = useState(false);

  useEffect(() => registerServiceWorker(() => {}), []);

  // Dropping a file here should feel like starting work, not like filling in a form. The
  // session is shared across routes, so the files are already loaded by the time Merge opens.
  const accept = useCallback(
    (files) => {
      if (!files || files.length === 0) return;
      session.addFiles(files);
      router.push('/merge');
    },
    [session, router],
  );

  return (
    <div className="lp">
      <header className="lp-header">
        <Link href="/" className="lp-brand" aria-label="LocalPDF home">
          <span className="lp-mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M12 18v-6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9 15h6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          LocalPDF
        </Link>
        <nav className="lp-header-links" aria-label="Site">
          <a href="#tools">Tools</a>
          <a href="#privacy">Privacy</a>
          <a href="https://github.com/nicanor-korir/merge-files-locally" rel="noreferrer noopener" target="_blank">
            GitHub
          </a>
          <Link href="/merge" className="btn btn-primary btn-sm lp-header-cta">
            Open the tools
          </Link>
        </nav>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-text">
            <p className="lp-eyebrow">Free, open source, and private by design</p>
            <h1>
              Every PDF tool you need.
              <br />
              <span className="lp-accent">None of them touch your files.</span>
            </h1>
            <p className="lp-lead">
              Merge, split, compress, convert, edit, redact and more. It all happens right here
              in your browser, so your documents stay on your computer where they belong. No sign
              up, no size limits, nothing to install.
            </p>

            <ul className="lp-trust">
              <li>Nothing is uploaded</li>
              <li>Works offline</li>
              <li>No account needed</li>
            </ul>
          </div>

          <div className="lp-hero-panel">
              <label
                className={`lp-drop${dragging ? ' is-dragging' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  accept(e.dataTransfer.files);
                }}
              >
                <input
                  type="file"
                  multiple
                  accept={ACCEPTED}
                  className="sr-only"
                  onChange={(e) => {
                    accept(e.target.files);
                    e.target.value = '';
                  }}
                />
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M17 8l-5-5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="lp-drop-title">Drop a PDF here to start</span>
                <span className="lp-drop-hint">or click to pick one. PDF, PNG, JPG and WebP.</span>
              </label>

            <p className="lp-hero-panel-note">
              Your file opens here in the tab. It is never sent anywhere, and it is gone the
              moment you close it.
            </p>
          </div>
        </section>

        <section className="lp-section" id="tools">
          <div className="lp-section-head">
            <h2>Ten tools, one tab</h2>
            <p>
              Pick one and get going. Your files carry over between tools, so you can merge, then
              split, then protect without loading anything twice.
            </p>
          </div>

          <ul className="lp-tools">
            {READY_TOOLS.map((tool) => (
              <li key={tool.id}>
                <Link href={tool.href} className="lp-tool">
                  <span className="lp-tool-icon" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      {tool.icon.map((d) => (
                        <path key={d} d={d} strokeLinecap="round" strokeLinejoin="round" />
                      ))}
                    </svg>
                  </span>
                  <span className="lp-tool-name">{tool.label}</span>
                  <span className="lp-tool-blurb">{tool.blurb}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-proof" id="privacy">
          <div className="lp-proof-inner">
            <div>
              <h2>You do not have to take our word for it</h2>
              <p>
                Most PDF sites ask you to upload your document and then trust them to delete it
                later. Here there is nothing to trust. Your file is opened by the page itself and
                is never sent anywhere, because this page is not allowed to send anything
                anywhere. Your browser makes sure of it.
              </p>
              <p className="lp-proof-note">
                Want to see for yourself? Open any tool and click the <strong>Private</strong>{' '}
                badge. It shows you the rule your browser is following at that very moment,
                rather than a promise from us.
              </p>
            </div>

            <figure className="lp-journey">
              <figcaption>What happens to your file</figcaption>
              <ul>
                <li>You pick it, and it opens right here in this tab</li>
                <li>All the work happens on your own computer</li>
                <li>The finished file saves straight back to you</li>
                <li>It is never sent to us, or to anyone else</li>
              </ul>
            </figure>
          </div>
        </section>

        <section className="lp-section">
          <ul className="lp-highlights">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-section lp-faq-section">
          <div className="lp-section-head">
            <h2>Questions people ask</h2>
          </div>
          <dl className="lp-faq">
            {QUESTIONS.map((item) => (
              <div key={item.q}>
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="lp-cta">
          <h2>Your files, your computer, your call.</h2>
          <p>Start with any tool. Nothing to sign up for, nothing to lose.</p>
          <Link href="/merge" className="btn btn-primary lp-cta-button">
            Open the tools
          </Link>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <div>
            <p className="lp-footer-brand">LocalPDF</p>
            <p className="lp-footer-line">PDF tools that never upload your files.</p>
          </div>
          <nav aria-label="All tools">
            <ul className="lp-footer-tools">
              {READY_TOOLS.map((tool) => (
                <li key={tool.id}>
                  <Link href={tool.href}>{tool.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <p className="lp-footer-legal">
          Open source, MIT licensed.{' '}
          <a href="https://github.com/nicanor-korir/merge-files-locally" rel="noreferrer noopener" target="_blank">
            Read the code
          </a>{' '}
          if you would rather check than trust.
        </p>
      </footer>
    </div>
  );
}
