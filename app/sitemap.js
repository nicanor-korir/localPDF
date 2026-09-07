import { READY_TOOLS, SITE } from '../lib/seo';

/**
 * Every page there is.
 *
 * Generated from the tool registry, so a new tool appears here the moment it is routed —
 * a hand-written sitemap would be one more list to forget.
 */
export const dynamic = 'force-static';

export default function sitemap() {
  return READY_TOOLS.map((tool) => ({
    url: tool.href === '/' ? SITE : `${SITE}${tool.href}`,
    changeFrequency: 'monthly',
    // The home page is the one to crawl first; the tools are equal to each other.
    priority: tool.href === '/' ? 1 : 0.8,
  }));
}
