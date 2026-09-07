import { contentFor } from '../../lib/tool-content';
import { faqSchema } from '../../lib/seo';

/**
 * The page's questions, repeated as structured data.
 *
 * Only ever generated from the questions that are genuinely on the page — marking up answers a
 * visitor cannot see is the kind of thing search engines penalise, and rightly.
 */
export function ToolSchema({ id }) {
  const content = contentFor(id);
  if (!content?.faq?.length) return null;

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema(content.faq)) }}
    />
  );
}
