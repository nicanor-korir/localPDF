'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ACCEPTED } from '../lib/file-types';
import { HOME_FAQ } from '../lib/tool-content';
import { READY_TOOLS } from '../lib/tools';
import { registerServiceWorker } from '../lib/register-sw';
import { LocalDemo } from './_components/local-demo';
import { useDocumentSession } from './_lib/use-document';

const THE_USUAL_WAY = [
  'You upload your document to a company you have never met',
  'It is processed on their computers, somewhere you cannot see',
  'You download the result and hope that was the end of it',
  'You trust a retention policy you almost certainly did not read',
];

const THE_LOCAL_WAY = [
  'You open your document, and it stays where it already was',
  'Your own computer does the work, the same way a desktop app would',
  'The finished file saves straight back to you',
  'There is nothing to delete afterwards, because nothing was ever sent',
];

const REASONS = [
  {
    title: 'A server that never had your file cannot leak it',
    body: 'Breaches happen to careful companies too. The only document that can never turn up in one is the document that was never uploaded in the first place.',
  },
  {
    title: 'Good enough for the documents that matter',
    body: 'Contracts, payslips, bank statements, medical letters, passports. The things you would hesitate to hand to a stranger are exactly what this was built for.',
  },
  {
    title: 'No queue, no cap, no upsell',
    body: 'Nobody is paying for servers, so nobody needs to ration you. No daily limit, no file size ceiling, no watermark, and no paid plan to remove one.',
  },
  {
    title: 'Still there when the wifi is not',
    body: 'Once the page has loaded it keeps working with no connection at all. On a plane, on a train, or on a machine that is locked down on purpose.',
  },
];

const STEPS = [
  {
    title: 'Pick your file',
    body: 'Drag it in or click to browse. It opens inside this tab, not on somebody else’s computer.',
  },
  {
    title: 'Do the work',
    body: 'Merge, split, compress, sign, redact, whatever you came for. Your own machine handles it, so it is quick.',
  },
  {
    title: 'Save it back',
    body: 'The finished file goes straight to your downloads. Close the tab and nothing is left behind.',
  },
];

export default function Landing() {
  const session = useDocumentSession();
  const router = useRouter();
  const [dragging, setDragging] = useState(false);

  useEffect(() => registerServiceWorker(() => {}), []);

  // Dropping here should feel like starting work, not filling in a form. The session is shared
  // across routes, so the files are already open by the time Merge appears.
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
          <a href="#demo">See it work</a>
          <a href="#why">Why local</a>
          <a href="#tools">Tools</a>
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
            <p className="lp-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M12 3l7 3v6c0 4.4-2.9 8.3-7 9.5C7.9 20.3 5 16.4 5 12V6z" strokeLinejoin="round" />
                <path d="M9.2 12.2l2 2 3.6-3.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {/* Deliberately not about where the files go: the headline directly below now
                  says that, and the two read as a stutter when they both open "Your files". */}
              Everything runs in your browser
            </p>

            {/*
              "Never leave this device" rather than "never touch your files": the second says
              nothing a reader can picture, while the first names the boundary every other part
              of this page draws. The lead then restates the promise in plainer words before it
              lists a single tool, because the promise is the reason anyone is still reading.
            */}
            <h1>
              Every PDF tool you need.
              <br />
              <span className="lp-accent">Your files never leave this device.</span>
            </h1>

            <p className="lp-lead">
              Your file opens in this tab and stays there. Merge, split, compress, convert, edit
              and redact, all on your own machine.
            </p>

            <ul className="lp-trust">
              <li>Nothing is uploaded</li>
              <li>Works offline</li>
              <li>No account needed</li>
              <li>Free, with no limits</li>
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
              {/*
                A laptop, not a cloud. Every other PDF site puts a cloud here, and a cloud is a
                picture of your file going somewhere else, which is the one thing that does not
                happen here.
              */}
              <span className="lp-drop-icon" aria-hidden="true">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="4" width="18" height="12" rx="2" strokeLinejoin="round" />
                  <path d="M2 20h20" strokeLinecap="round" />
                  <path d="M12 12V7" strokeLinecap="round" />
                  <path d="M9.5 9.5L12 7l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="lp-drop-title">Drop a PDF here to start</span>
              <span className="lp-drop-hint">PDF, PNG, JPG and WebP</span>
              <span className="btn btn-primary lp-drop-button">Or choose a file</span>
            </label>
            {/* The lead already says the file opens here and stays, so this adds the half it
                does not cover: nothing is kept either. */}
            <p className="lp-hero-panel-note">
              Read from your disk, never copied off it, and gone when you close the tab.
            </p>
          </div>
        </section>

        <section className="lp-section lp-demo-section" id="demo">
          <div className="lp-section-head">
            <p className="lp-kicker">See it work</p>
            <h2>All of it happens inside your machine</h2>
            <p>
              Pick a tool and watch what it does. The frame is the edge of your own computer, and
              nothing crosses it at any point.
            </p>
          </div>
          <LocalDemo />
        </section>

        <section className="lp-why" id="why">
          <div className="lp-why-inner">
            <div className="lp-section-head lp-why-head">
              <p className="lp-kicker">Why local</p>
              <h2>Two ways to edit a PDF. Only one keeps it yours.</h2>
            </div>

            <div className="lp-compare">
              <div className="lp-compare-col is-usual">
                <h3>
                  <span className="lp-compare-tag">The usual way</span>
                  Upload and hope
                </h3>
                <ol>
                  {THE_USUAL_WAY.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
              </div>

              <div className="lp-compare-col is-local">
                <h3>
                  <span className="lp-compare-tag">This way</span>
                  It never goes anywhere
                </h3>
                <ol>
                  {THE_LOCAL_WAY.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
              </div>
            </div>

            <ul className="lp-reasons">
              {REASONS.map((reason) => (
                <li key={reason.title}>
                  <h3>{reason.title}</h3>
                  <p>{reason.body}</p>
                </li>
              ))}
            </ul>

            <p className="lp-why-proof">
              You do not have to believe any of this. Open any tool and click the{' '}
              <strong>Private</strong> badge: it shows you the rule your browser is following at
              that moment, which is what actually stops this page sending anything anywhere.
            </p>
          </div>
        </section>

        <section className="lp-section" id="tools">
          <div className="lp-section-head">
            <p className="lp-kicker">The toolkit</p>
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

        <section className="lp-section lp-steps-section">
          <div className="lp-steps">
            <div className="lp-steps-text">
              <p className="lp-kicker">How it works</p>
              <h2>Three steps, and none of them are an upload</h2>
              <ol className="lp-steps-list">
                {STEPS.map((step, index) => (
                  <li key={step.title}>
                    <span className="lp-step-number" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span>
                      <strong>{step.title}</strong>
                      {step.body}
                    </span>
                  </li>
                ))}
              </ol>
              <Link href="/merge" className="btn btn-primary lp-steps-cta">
                Try it now
              </Link>
            </div>

            {/* The same boundary idea as the demo, held still: your machine on the inside,
                the internet on the outside, and no line between them. */}
            <div className="lp-boundary" aria-hidden="true">
              <div className="lp-boundary-outside">
                <span>The internet</span>
              </div>
              {/*
                The whole point of the picture, drawn rather than claimed: a sealed line between
                the internet and the box your document sits in. Every other PDF site puts a cloud
                here with arrows going up into it.
              */}
              <div className="lp-boundary-gate">
                <span className="lp-boundary-block">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                    <line x1="6" y1="18" x2="18" y2="6" />
                  </svg>
                  Nothing gets out
                </span>
              </div>
              <div className="lp-boundary-inside">
                <span className="lp-boundary-label">Your computer</span>
                <div className="lp-boundary-doc">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="lp-boundary-tools">
                  <span>Merge</span>
                  <span>Split</span>
                  <span>Redact</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-section lp-faq-section">
          <div className="lp-section-head">
            <h2>Questions people ask</h2>
          </div>
          <dl className="lp-faq">
            {HOME_FAQ.map((item) => (
              <div key={item.question}>
                <dt>{item.question}</dt>
                <dd>{item.answer}</dd>
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
