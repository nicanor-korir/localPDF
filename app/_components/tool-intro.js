import { contentFor } from '../../lib/tool-content';

/**
 * What this tool is, and the questions people actually arrive with.
 *
 * Rendered only while the tool is empty. Someone who has loaded a file is working, and this
 * would be in the way; someone who has just arrived from a search result has nothing else to
 * read. It disappears the moment a file is added.
 */
export function ToolIntro({ id }) {
  const content = contentFor(id);
  if (!content) return null;

  return (
    <section className="tool-intro" aria-label="About this tool">
      <p className="tool-intro-lead">{content.intro}</p>

      <h2 className="tool-intro-heading">Questions</h2>
      <dl className="tool-faq">
        {content.faq.map((entry) => (
          <div key={entry.question} className="tool-faq-item">
            <dt>{entry.question}</dt>
            <dd>{entry.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
