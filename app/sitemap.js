import { READY_TOOLS, SITE } from '../lib/seo';

/**
 * Every page there is.
 *
 * The tools are generated from the registry, so a new one appears here the moment it is
 * routed — a hand-written list is one more thing to forget.
 *
 * ⚠️ **The home page is listed separately, and has to be.** It used to be covered by a
 * `tool.href === '/'` special case in the loop below, which was correct while merge lived at
 * the root. Splitting the landing page out moved merge to `/merge`, no tool claimed `/` any
 * more, and the most important URL on the site quietly dropped out of the sitemap with nothing
 * to show for it. It is also the URL that consolidates the two domains, so losing it is worse
 * than losing any single tool. lib/seo.test.js pins it.
 */
export const dynamic = 'force-static';

export default function sitemap() {
  return [
    { url: SITE, changeFrequency: 'monthly', priority: 1 },
    ...READY_TOOLS.map((tool) => ({
      url: `${SITE}${tool.href}`,
      changeFrequency: 'monthly',
      // Equal to each other: no tool is the way in more than the others.
      priority: 0.8,
    })),
  ];
}
