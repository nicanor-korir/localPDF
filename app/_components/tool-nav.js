'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { READY_TOOLS } from '../../lib/tools';

/**
 * The tool row.
 *
 * Only tools that exist appear here — `lib/tools.js` carries the planned ones too, but showing
 * a row of things that do not work yet makes a finished product feel unfinished.
 *
 * It is a real `<nav>` of links rather than a tab widget: each tool is its own URL, so it can
 * be bookmarked, opened in a new tab, and found by a search engine.
 */
export function ToolNav() {
  const pathname = usePathname();

  return (
    <nav className="tool-nav" aria-label="Tools">
      <ul className="tool-nav-list">
        {READY_TOOLS.map((tool) => {
          const active = pathname === tool.href;
          return (
            <li key={tool.id}>
              <Link
                href={tool.href}
                className={`tool-chip${active ? ' tool-chip-active' : ''}`}
                aria-current={active ? 'page' : undefined}
                title={tool.blurb}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" focusable="false">
                  {tool.icon.map((d) => (
                    <path key={d} d={d} strokeLinecap="round" strokeLinejoin="round" />
                  ))}
                </svg>
                {tool.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
