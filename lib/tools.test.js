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
    expect(READY_TOOLS[0].href).toBe('/');
  });

  it('exposes only ready tools in the row', () => {
    expect(READY_TOOLS.every((t) => t.status === 'ready')).toBe(true);
    expect(READY_TOOLS.length).toBeLessThan(TOOLS.length);
  });

  it('looks a tool up by id', () => {
    expect(getTool('split').label).toBe('Split');
    expect(getTool('nope')).toBeNull();
  });
});
