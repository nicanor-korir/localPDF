import { describe, expect, it } from 'vitest';
import sitemap from '../app/sitemap.js';
import { READY_TOOLS, SITE, absolute, faqSchema } from './seo.js';

describe('the sitemap', () => {
  const urls = sitemap().map((entry) => entry.url);

  it('lists the home page', () => {
    // It went missing once and nothing said so. The landing page was split out, merge moved to
    // /merge, and the `href === '/'` special case that used to emit the root stopped matching
    // any tool — so the most important URL on the site quietly left the sitemap. This is the
    // test that would have caught it.
    expect(urls).toContain(SITE);
  });

  it('gives the home page the highest priority', () => {
    // It is the URL that consolidates the two domains, so it is the one to crawl first.
    const home = sitemap().find((entry) => entry.url === SITE);
    expect(home.priority).toBe(1);
  });

  it('lists every tool that is actually built', () => {
    for (const tool of READY_TOOLS) {
      expect(urls, tool.id).toContain(`${SITE}${tool.href}`);
    }
  });

  it('has no duplicates and no trailing-slash variants', () => {
    // A duplicate is a split ranking signal, and /merge plus /merge/ read as two pages.
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      if (url === SITE) continue;
      expect(url.endsWith('/'), url).toBe(false);
    }
  });

  it('is entirely absolute and on the canonical host', () => {
    for (const url of urls) expect(url.startsWith(`${SITE}/`) || url === SITE, url).toBe(true);
  });
});

describe('absolute()', () => {
  it('builds canonical URLs on the one host that consolidates the two domains', () => {
    expect(absolute('/merge')).toBe(`${SITE}/merge`);
  });
});

describe('faqSchema', () => {
  it('carries every question through, so the markup matches what is on the page', () => {
    const schema = faqSchema([{ question: 'Is it free?', answer: 'Yes.' }]);
    expect(schema['@type']).toBe('FAQPage');
    expect(schema.mainEntity).toHaveLength(1);
    expect(schema.mainEntity[0].name).toBe('Is it free?');
    expect(schema.mainEntity[0].acceptedAnswer.text).toBe('Yes.');
  });
});
