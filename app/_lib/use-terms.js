'use client';

import { useCallback, useEffect, useState } from 'react';
import { TERMS_STORAGE_KEY, acceptanceRecord, needsAcceptance } from '../../lib/terms';

/**
 * Reading and writing the one thing this app keeps on a visitor's device.
 *
 * ⚠️ This is the *only* localStorage in the codebase, and it is the only kind that belongs
 * here: a flag saying someone read the agreement. See app/_lib/document-store.js for why user
 * documents are never written to disk — that rule is untouched by this one, and a note that
 * someone clicked a button is not a document.
 *
 * Every access is wrapped, because `localStorage` does not merely return null when it is
 * unavailable, it **throws**: Safari in private browsing, a `file://` page, and any browser set
 * to block site data all raise on the property access itself. An unhandled throw here would
 * take the shell down and lock the user out of an app whose whole promise is that it keeps
 * working in awkward places.
 */
function readAcceptance() {
  try {
    return window.localStorage.getItem(TERMS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeAcceptance() {
  try {
    window.localStorage.setItem(TERMS_STORAGE_KEY, acceptanceRecord());
    return true;
  } catch {
    // Storage is blocked. The acceptance still counts for this session — it is held in React
    // state below — they will just be asked again next time. Refusing to let someone work
    // because their browser will not remember a preference would be the wrong trade.
    return false;
  }
}

/**
 * Whether the agreement still needs accepting.
 *
 * `null` while it is being worked out. That third state matters: this is a static export, so
 * the HTML is built ahead of time and `localStorage` cannot be read until the browser runs the
 * effect. Starting at `false` would flash the tools at someone who has not accepted; starting
 * at `true` would flash the agreement at every returning visitor who has. `null` renders
 * neither, for the one frame it lasts.
 */
export function useTermsAcceptance() {
  const [pending, setPending] = useState(null);

  useEffect(() => {
    setPending(needsAcceptance(readAcceptance()));
  }, []);

  const accept = useCallback(() => {
    writeAcceptance();
    setPending(false);
  }, []);

  return { pending, accept };
}
