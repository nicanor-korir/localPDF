import './globals.css';
import { PROMISE, SITE, SITE_NAME, TAGLINE, applicationSchema, toolListSchema } from '../lib/seo';

const DESCRIPTION = `${TAGLINE}. ${PROMISE}`;

export const metadata = {
  metadataBase: new URL(SITE),
  // A template so each tool page leads with what it does — which is what someone searched for
  // — and the brand follows.
  title: {
    default: `${SITE_NAME}: ${TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'merge pdf', 'split pdf', 'compress pdf', 'edit pdf', 'redact pdf',
    'unlock pdf', 'password protect pdf', 'pdf to word', 'pdf to image',
    'offline pdf editor', 'private pdf tools',
  ],
  authors: [{ name: 'Nicanor Korir', url: 'https://nicanor.xyz' }],
  creator: 'Nicanor Korir',
  alternates: { canonical: '/' },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    type: 'website',
    url: SITE,
    siteName: SITE_NAME,
    title: `${SITE_NAME}: ${TAGLINE}`,
    description: DESCRIPTION,
    locale: 'en_GB',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: `${SITE_NAME}. ${TAGLINE}` }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME}: ${TAGLINE}`,
    description: DESCRIPTION,
    images: ['/og.png'],
  },
};

export const viewport = {
  themeColor: '#4361ee',
  colorScheme: 'light',
};

// Content-Security-Policy delivered as a <meta> so the no-egress guarantee is enforced even
// when the static export is hosted somewhere without HTTP-header support (e.g. file:// or a
// plain static server). When served by Vercel, vercel.json sets the same policy as a real
// header (stronger — it can also carry frame-ancestors, which <meta> ignores).
//
// connect-src 'self' is the load-bearing directive: it blocks any fetch/XHR/beacon to an
// external host, so user files physically cannot be uploaded or exfiltrated — this is what
// enforces the privacy promise. 'wasm-unsafe-eval' + blob: worker-src cover the pdf.js
// worker. 'unsafe-inline' is required for both script and style: Next.js static export
// inlines its hydration bootstrap as inline <script> tags, and styled-jsx / inline styles
// need inline CSS. Nonces/hashes aren't viable for a server-less static export. The script
// relaxation is an accepted tradeoff: even if inline script ran, connect-src still makes
// egress impossible.
const CSP = [
  "default-src 'self'",
  // manifest-src is not implied by default-src in every engine; name it so the PWA manifest
  // loads everywhere rather than only where default-src happens to cover it.
  "manifest-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
        <meta name="referrer" content="no-referrer" />
        {/*
          Structured data, so a search engine can describe the app rather than guess at it. Two
          blocks: what this is, and what it can do. `application/ld+json` is data, not code —
          nothing here executes.
        */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(applicationSchema()) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(toolListSchema()) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
