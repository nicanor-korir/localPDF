import { faqSchema, homeMetadata } from '../lib/seo';
import { HOME_FAQ } from '../lib/tool-content';
import Landing from './landing';

export const metadata = homeMetadata();

export default function Home() {
  return (
    <>
      {/* The same questions the page shows, repeated as data a search engine can read. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema(HOME_FAQ)) }}
      />
      <Landing />
    </>
  );
}
