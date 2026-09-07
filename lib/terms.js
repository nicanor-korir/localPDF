/**
 * The agreement a visitor accepts before the tools will do anything.
 *
 * ⚠️ **This is not a cookie banner, and must never become one.** This app sets no cookies and
 * has no server to send a document to, so asking someone to consent to cookies would be asking
 * them to agree to something that does not exist. On the one product whose
 * entire argument is that it tells the truth about where files go, a false consent notice would
 * cost more than it could possibly gain — and it is the single most recognisable pattern of the
 * sites this one is positioned against.
 *
 * What it is instead: the guarantee, stated plainly, with an explicit acknowledgement. The
 * point is that nobody uses these tools without having been told, in words, what happens to
 * their document. Every line below has to stay true of the code.
 *
 * DOM-free on purpose, so the wording and the version rules are unit-tested in Node.
 */

// Bump when the *substance* changes and everyone should be asked again. Fixing a typo is not a
// substantive change; describing a new thing that gets stored or sent very much is.
//
// v2 (2026-09-07): page visits are now counted. Everyone who accepted v1 accepted a version
// that said "no analytics", so they are asked again rather than quietly held to something they
// were never shown.
export const TERMS_VERSION = 2;

// Namespaced so it cannot collide with anything else on the origin.
export const TERMS_STORAGE_KEY = 'localpdf.local-use';

/**
 * The agreement itself.
 *
 * Four points, because that is how many true things there are to say. Each one is a promise the
 * code has to keep: if you change what the app does, change the matching line here first and
 * let the test suite tell you what else moved.
 */
export const TERMS = [
  {
    title: 'Your files stay on this device',
    body:
      'Everything happens inside this browser tab, on your own machine. Nothing is uploaded, ' +
      'and the page ships a policy that stops the browser sending anything out at all, so it ' +
      'is not that we choose not to upload. We cannot.',
  },
  {
    title: 'There is nobody on the other end',
    body:
      'No account, no server, no database. We never receive your documents, which means there ' +
      'is nothing for us to lose, sell, or be asked to hand over.',
  },
  {
    title: 'Nothing you make is saved',
    body:
      'Your work lives in this tab and nowhere else. Closing it clears everything, so save the ' +
      'finished file before you go. The original on your disk is never changed.',
  },
  {
    // ⚠️ Every word of this has to keep matching what actually ships. It currently covers the
    // acceptance flag in app/_lib/use-terms.js and the visit counting in app/layout.js. Add
    // anything else that is stored or sent, here, in the same commit.
    title: 'What is kept, and what is counted',
    body:
      'One note on your device: that you read this page, so you are not asked again. Visits to ' +
      'the page are counted, with no cookies and nothing that identifies you. Your documents ' +
      'are never part of it and cannot be.',
  },
];

/**
 * What gets written to the browser once someone accepts.
 *
 * A version and a date, and deliberately nothing else. There is no identifier here because
 * there is nobody to identify anyone to.
 */
export function acceptanceRecord(version = TERMS_VERSION, now = new Date()) {
  return JSON.stringify({ version, acceptedAt: now.toISOString() });
}

/**
 * Read back whatever is in storage, tolerating anything.
 *
 * This value came off a real user's disk, where it may have been hand-edited, truncated,
 * written by an older build, or corrupted. The only wrong answer is to throw: an exception here
 * would take the whole shell down and lock someone out of an app they had already accepted.
 */
export function parseAcceptance(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    if (!Number.isInteger(value.version)) return null;
    return { version: value.version, acceptedAt: typeof value.acceptedAt === 'string' ? value.acceptedAt : null };
  } catch {
    return null;
  }
}

/**
 * Should this visitor be asked?
 *
 * Anything unreadable counts as "not accepted" — the safe direction, since the cost of asking
 * twice is a click and the cost of not asking is someone using the tools having never been told
 * what they do. A record from a *newer* version is left alone: that is a returning user whose
 * other tab is on a build ahead of this one, and re-prompting them would be noise.
 */
export function needsAcceptance(raw, version = TERMS_VERSION) {
  const accepted = parseAcceptance(raw);
  return accepted === null || accepted.version < version;
}
