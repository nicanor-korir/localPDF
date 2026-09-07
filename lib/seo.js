/**
 * One place that knows what this site is called and how each page describes itself.
 *
 * Built from `tools.js` rather than repeated in ten `page.js` files, so a tool cannot end up
 * with a title in the tab that disagrees with the one in a search result. Adding a tool to the
 * registry gives it correct metadata for free.
 */

import { READY_TOOLS, TOOLS, getTool } from './tools.js';

export const SITE = 'https://localpdf.nicanor.xyz';
export const SITE_NAME = 'LocalPDF';
export const TAGLINE = 'PDF tools that never upload your files';

/**
 * The promise, in the words the site repeats everywhere.
 *
 * Worth keeping in one constant: it is the entire reason to choose this over the alternatives,
 * and it has to be phrased the same in the manifest, the social card and the description or it
 * starts to sound like marketing rather than a fact.
 */
export const PROMISE =
  'Everything runs in your browser. Your files never leave your device, and the page will show ' +
  'you the policy that enforces it.';

const absolute = (path) => (path === '/' ? SITE : `${SITE}${path}`);

/** Full metadata for one tool's route, for a Next.js `page.js` to export directly. */
export function metadataForTool(id) {
  const tool = getTool(id);
  if (!tool) throw new Error(`No tool called "${id}" — add it to lib/tools.js first.`);

  const url = absolute(tool.href);
  const description = tool.seoDescription;
  const title = tool.seoTitle;

  return {
    title,
    description,
    alternates: { canonical: tool.href },
    openGraph: {
      type: 'website',
      url,
      siteName: SITE_NAME,
      title: `${tool.seoTitle} · ${SITE_NAME}`,
      description,
      images: [{ url: '/og.png', width: 1200, height: 630, alt: `${SITE_NAME}. ${TAGLINE}` }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${tool.seoTitle} · ${SITE_NAME}`,
      description,
      images: ['/og.png'],
    },
  };
}

/**
 * The landing page's own metadata.
 *
 * It is not a tool, so it does not come from the registry. It is also the segment the title
 * template is declared in, and Next never applies a template to that — so the brand is named
 * here explicitly or the tab would read only the headline.
 */
export function homeMetadata() {
  const title = `${SITE_NAME}: ${TAGLINE}`;
  const description =
    'Ten free PDF tools that run entirely in your browser: merge, split, compress, convert, ' +
    'edit, redact, protect and unlock. No account, no file size limit, and nothing is ever ' +
    'uploaded. The page enforces that, and shows you how.';
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      url: SITE,
      siteName: SITE_NAME,
      title,
      description,
      images: [{ url: '/og.png', width: 1200, height: 630, alt: `${SITE_NAME}. ${TAGLINE}` }],
    },
    twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
  };
}

/**
 * Structured data describing the app.
 *
 * `offers` with a zero price is not padding: it is how a search engine learns the thing is free,
 * which for a category full of "free trials" is the distinguishing fact.
 */
export function applicationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: SITE_NAME,
    url: SITE,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any browser',
    description: `${TAGLINE}. ${PROMISE}`,
    browserRequirements: 'Requires JavaScript. Works offline once loaded.',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: READY_TOOLS.map((tool) => tool.seoTitle),
    softwareHelp: { '@type': 'CreativeWork', url: `${SITE}/` },
  };
}

/** The tool row, as structured data, so the sub-pages are discoverable from the home page. */
export function toolListSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${SITE_NAME} tools`,
    itemListElement: READY_TOOLS.map((tool, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: tool.seoTitle,
      url: absolute(tool.href),
    })),
  };
}

/** A page's questions as structured data. Only used where the questions are really on the page. */
export function faqSchema(questions) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
}

export { TOOLS, READY_TOOLS, absolute };
