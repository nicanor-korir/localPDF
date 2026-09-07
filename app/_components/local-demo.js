'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A small, honest demonstration of what each tool does.
 *
 * Deliberately an illustration rather than a screenshot, and deliberately not the real engine:
 * loading pdf-lib to animate a landing page would put half a megabyte in front of the first
 * paint for something nobody asked for yet. It is drawn with elements and transforms, so it
 * costs nothing and stays sharp at any size.
 *
 * The frame around it is the whole point of the design. Every other PDF site draws a cloud;
 * this one draws the edge of your own machine, and nothing ever crosses it.
 */

const STEPS = [
  {
    id: 'merge',
    label: 'Merge',
    line: 'Three documents become one, in the order you choose.',
  },
  {
    id: 'split',
    label: 'Split',
    line: 'One document becomes several, cut wherever you like.',
  },
  {
    id: 'compress',
    label: 'Compress',
    line: 'The pictures inside get re-encoded. The words stay sharp.',
  },
  {
    id: 'redact',
    label: 'Redact',
    line: 'The hidden words are removed, not covered over.',
  },
  {
    id: 'protect',
    label: 'Protect',
    line: 'A password goes on, using the same encryption banks use.',
  },
];

const ROTATE_MS = 3800;

export function LocalDemo() {
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);
  const paused = useRef(false);

  // Cycles on its own so the page has some life, and stops the moment anyone takes over.
  // Someone who has chosen a tab is reading it, and moving it under them would be rude.
  useEffect(() => {
    if (touched) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = setInterval(() => {
      if (!paused.current) setActive((n) => (n + 1) % STEPS.length);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [touched]);

  const step = STEPS[active];

  return (
    <div
      className="demo"
      onMouseEnter={() => {
        paused.current = true;
      }}
      onMouseLeave={() => {
        paused.current = false;
      }}
    >
      <div className="demo-tabs" role="tablist" aria-label="What the tools do">
        {STEPS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`demo-tab-${item.id}`}
            aria-selected={index === active}
            aria-controls="demo-stage"
            className={`demo-tab${index === active ? ' is-active' : ''}`}
            onClick={() => {
              setActive(index);
              setTouched(true);
            }}
          >
            <span className="demo-tab-label">{item.label}</span>
            <span className="demo-tab-line">{item.line}</span>
          </button>
        ))}
      </div>

      <div
        className={`demo-stage state-${step.id}`}
        id="demo-stage"
        role="tabpanel"
        aria-labelledby={`demo-tab-${step.id}`}
      >
        <div className="demo-frame">
          <div className="demo-frame-bar">
            <span />
            <span />
            <span />
            <p className="demo-frame-title">Your computer</p>
          </div>

          <div className="demo-canvas">
            {/*
              Two more documents, used by Merge and Split. They carry their own lines: in Split
              the second one ends up fully visible, and a blank white card there reads as a bug
              rather than as a page.
            */}
            <div className="demo-sheet demo-sheet-b" aria-hidden="true">
              <span className="demo-rule w-60" />
              <span className="demo-rule w-85" />
              <span className="demo-rule w-70" />
              <span className="demo-rule w-90" />
              <span className="demo-rule w-50" />
            </div>
            <div className="demo-sheet demo-sheet-c" aria-hidden="true">
              <span className="demo-rule w-80" />
              <span className="demo-rule w-60" />
              <span className="demo-rule w-90" />
              <span className="demo-rule w-70" />
            </div>

            <div className="demo-sheet demo-sheet-a" aria-hidden="true">
              <span className="demo-rule w-70" />
              <span className="demo-rule w-90" />
              <span className="demo-rule w-80 demo-secret" />
              <span className="demo-rule w-60" />
              <span className="demo-photo" />
              <span className="demo-rule w-85 demo-secret-2" />
              <span className="demo-rule w-50" />
            </div>

            <span className="demo-lock" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1">
                <rect x="4" y="11" width="16" height="10" rx="2" strokeLinejoin="round" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" strokeLinecap="round" />
              </svg>
            </span>

            <span className="demo-size" aria-hidden="true">
              <b>8.4 MB</b> to <b>1.9 MB</b>
            </span>
          </div>

          <p className="demo-caption">
            <span className="demo-dot" aria-hidden="true" />
            Nothing left this frame
          </p>
        </div>
      </div>
    </div>
  );
}
