import { describe, expect, it } from 'vitest';
import {
  TERMS,
  TERMS_STORAGE_KEY,
  TERMS_VERSION,
  acceptanceRecord,
  needsAcceptance,
  parseAcceptance,
} from './terms.js';

describe('what the agreement says', () => {
  // These are promises the code has to keep, so they are pinned rather than left to drift. If
  // one of these fails because the wording changed, check the behaviour changed with it.
  it('claims files stay on the device, and that it is enforced rather than promised', () => {
    const text = TERMS.map((t) => `${t.title} ${t.body}`).join(' ');
    expect(text).toContain('Nothing is uploaded');
    expect(text).toMatch(/cannot/i);
  });

  it('says out loud that nothing is saved, because that surprises people', () => {
    // There is no server-side copy and no IndexedDB. Someone who closes the tab expecting to
    // come back to their arrangement has lost it, so this cannot be left implied.
    expect(TERMS.some((t) => /nothing you make is saved/i.test(t.title))).toBe(true);
  });

  it('discloses everything that is stored or sent, and denies the rest', () => {
    // The app keeps an acceptance flag and counts page visits. Both are named here, because an
    // agreement that omits one of them is worse than no agreement: it is a specific false
    // statement. If you add a third thing, this test should fail until it is disclosed too.
    const kept = TERMS.find((t) => /kept, and what is counted/i.test(t.title));
    expect(kept).toBeDefined();
    expect(kept.body).toMatch(/no cookies/i);
    expect(kept.body).toMatch(/counted/i);
    // The counting must never be allowed to imply it touches the documents.
    expect(kept.body).toMatch(/documents are never part of it/i);
  });

  it('is short enough that someone might actually read it', () => {
    // A wall of text is how a real disclosure becomes an unread one.
    const words = TERMS.map((t) => `${t.title} ${t.body}`).join(' ').split(/\s+/).length;
    expect(TERMS).toHaveLength(4);
    // Raised from 150 when visit counting was added: a real disclosure earns the words, an
    // explanation of it would not.
    expect(words).toBeLessThan(165);
  });
});

describe('parseAcceptance', () => {
  it('reads back what acceptanceRecord writes', () => {
    const now = new Date('2026-09-07T10:00:00.000Z');
    expect(parseAcceptance(acceptanceRecord(TERMS_VERSION, now))).toEqual({
      version: TERMS_VERSION,
      acceptedAt: '2026-09-07T10:00:00.000Z',
    });
  });

  it('never throws on rubbish, whatever shape it is', () => {
    // This value came off a real disk, where it may have been hand-edited, truncated, or
    // written by a build that no longer exists. Throwing here would take the shell down and
    // lock out someone who had already accepted.
    for (const raw of ['', 'not json', '{', 'null', '[]', '"a string"', '{"version":"1"}', '{"version":1.5}', undefined, null, 42]) {
      expect(() => parseAcceptance(raw)).not.toThrow();
      expect(parseAcceptance(raw)).toBeNull();
    }
  });

  it('tolerates a record with a missing date', () => {
    expect(parseAcceptance('{"version":1}')).toEqual({ version: 1, acceptedAt: null });
  });
});

describe('needsAcceptance', () => {
  it('asks when there is nothing stored', () => {
    expect(needsAcceptance(null)).toBe(true);
  });

  it('does not ask again once accepted at the current version', () => {
    expect(needsAcceptance(acceptanceRecord())).toBe(false);
  });

  it('asks again when the agreement has moved on', () => {
    expect(needsAcceptance(acceptanceRecord(1), 2)).toBe(true);
  });

  it('leaves alone someone whose record is from a newer build', () => {
    // Two tabs, one on a build ahead of this one. Re-prompting them would be noise, and they
    // have already agreed to a superset of what this version says.
    expect(needsAcceptance(acceptanceRecord(5), 2)).toBe(false);
  });

  it('treats anything unreadable as not accepted', () => {
    // The safe direction: asking twice costs a click, not asking costs someone using the tools
    // having never been told what they do.
    expect(needsAcceptance('{"version":')).toBe(true);
  });
});

describe('the version', () => {
  it('is past 1, because the substance changed when visit counting was added', () => {
    // Anyone who accepted v1 accepted wording that said "no analytics". Holding them to a
    // different agreement without showing it to them is the thing the version field prevents.
    expect(TERMS_VERSION).toBeGreaterThan(1);
  });
});

describe('the storage key', () => {
  it('is namespaced so it cannot collide with anything else on the origin', () => {
    expect(TERMS_STORAGE_KEY.startsWith('localpdf.')).toBe(true);
  });
});
