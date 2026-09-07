import { describe, expect, it } from 'vitest';
import { READY_TOOLS, TOOLS, getTool } from './tools';

describe('the tool registry', () => {
  it('has a unique id and href for every tool', () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    expect(new Set(TOOLS.map((t) => t.href)).size).toBe(TOOLS.length);
  });

  it('gives every tool a label, a blurb and an icon', () => {
    for (const tool of TOOLS) {
      expect(tool.label, tool.id).toBeTruthy();
      expect(tool.blurb, tool.id).toMatch(/\.$/);
      expect(tool.icon.length, tool.id).toBeGreaterThan(0);
    }
  });

  it('uses root-relative hrefs, so the tool row works under a sub-path', () => {
    for (const tool of TOOLS) expect(tool.href, tool.id).toMatch(/^\/[a-z-]*$/);
  });

  it('only knows two statuses', () => {
    for (const tool of TOOLS) expect(['ready', 'planned']).toContain(tool.status);
  });

  it('shows merge first, since it is the tool people arrive for', () => {
    expect(READY_TOOLS[0].id).toBe('merge');
    expect(READY_TOOLS[0].href).toBe('/merge');
  });

  it('leaves the root path to the landing page', () => {
    // "/" explains the product; every tool has a route of its own, so each page answers one
    // question rather than the home page trying to be both a pitch and a workspace.
    expect(TOOLS.every((tool) => tool.href !== '/')).toBe(true);
  });

  it('exposes exactly the ready tools in the row', () => {
    // Everything on the roadmap is built, so this is currently every tool. The invariant is
    // the filter, not the count: a tool marked 'planned' must not appear in the row, however
    // many of those there happen to be.
    expect(READY_TOOLS).toEqual(TOOLS.filter((tool) => tool.status === 'ready'));
    expect(READY_TOOLS.every((tool) => tool.status === 'ready')).toBe(true);
  });

  it('looks a tool up by id', () => {
    expect(getTool('split').label).toBe('Split');
    expect(getTool('nope')).toBeNull();
  });
});

describe('search metadata', () => {
  it('gives every tool a distinct title and description', () => {
    const titles = READY_TOOLS.map((tool) => tool.seoTitle);
    const descriptions = READY_TOOLS.map((tool) => tool.seoDescription);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('keeps descriptions inside the length a search result will show', () => {
    for (const tool of READY_TOOLS) {
      // Much past 160 characters and the rest is cut off, so the last thing said is a
      // half-sentence rather than the reason to click.
      expect(tool.seoDescription.length, tool.id).toBeGreaterThan(70);
      expect(tool.seoDescription.length, tool.id).toBeLessThanOrEqual(175);
      expect(tool.seoTitle.length, tool.id).toBeLessThanOrEqual(60);
    }
  });

  it('says what the tool does, not what the site is called', () => {
    // The brand is appended by the title template; repeating it here would waste the pixels a
    // search result actually shows.
    for (const tool of READY_TOOLS) {
      expect(tool.seoTitle.toLowerCase(), tool.id).not.toContain('localpdf');
    }
  });
});
