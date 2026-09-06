/**
 * Build a Word document (.docx) from blocks of text.
 *
 * A .docx is a zip of XML parts, so `lib/zip.js` does the packaging and everything here is
 * string building. No library: the subset of OOXML needed for headings, paragraphs and bullets
 * is small and stable, and a document generator would be a large dependency for it.
 *
 * **What this can and cannot do.** It recovers the words and a rough shape — headings,
 * paragraphs, lists, page breaks — as flowing, editable text. It does not reproduce the
 * layout: no columns, no tables as tables, no images, no fonts. That is not a shortcoming to
 * be fixed later, it is what converting a fixed-layout format to a flowing one means. The
 * Convert page says so, and anyone who needs the layout should convert to images instead.
 *
 * Pure and DOM-free.
 */

import { createZip } from './zip.js';

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Escape for XML text and attribute values, and drop the control characters XML forbids. */
export function escapeXml(text) {
  return String(text ?? '')
    // XML 1.0 allows tab, newline and carriage return, and nothing else below 0x20.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const CONTENT_TYPES =
  `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '</Types>';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const ROOT_RELS =
  `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>` +
  `<Relationship Id="rId2" Type="${REL}/metadata/core-properties" Target="docProps/core.xml"/>` +
  '</Relationships>';

const DOCUMENT_RELS =
  `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/>` +
  `<Relationship Id="rId2" Type="${REL}/numbering" Target="numbering.xml"/>` +
  '</Relationships>';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

// Sizes are in half-points; spacing is in twentieths of a point.
const STYLES =
  `${XML_DECLARATION}<w:styles ${W}>` +
  '<w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>' +
  '</w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
  '<w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/>' +
  '<w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/>' +
  '<w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/></w:pPr></w:style>' +
  '</w:styles>';

// A single bullet list definition. Real numbering rather than a literal bullet character, so
// pressing Enter in Word continues the list the way the reader expects.
const NUMBERING =
  `${XML_DECLARATION}<w:numbering ${W}>` +
  '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#9679;"/>' +
  '<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>' +
  '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr></w:lvl>' +
  '</w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '</w:numbering>';

function coreProperties(title) {
  // No dcterms:created/modified: a wall-clock timestamp is metadata the user did not ask to
  // add, and this app does not stamp documents with things they did not ask for.
  return (
    `${XML_DECLARATION}<cp:coreProperties ` +
    'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    '</cp:coreProperties>'
  );
}

const run = (text) => `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;

function paragraph(block) {
  if (block.type === 'heading') {
    const style = block.level === 1 ? 'Heading1' : 'Heading2';
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${run(block.text)}</w:p>`;
  }
  if (block.type === 'list-item') {
    return (
      '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/>' +
      '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
      `${run(block.text)}</w:p>`
    );
  }
  return `<w:p>${run(block.text)}</w:p>`;
}

const PAGE_BREAK = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

// A4 in twentieths of a point, with one-inch margins.
const SECTION =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>' +
  '</w:sectPr>';

/**
 * Build a .docx from `pages`, an array of block arrays as produced by `text-layout.js`.
 *
 * Returns a Uint8Array. Store-only zip, which Word opens perfectly well — every part here is
 * small XML, and deflating it would save a few kilobytes for a compression library.
 */
export function createDocx(pages, { title = 'Converted document' } = {}) {
  const body = [];

  pages.forEach((blocks, index) => {
    if (index > 0) body.push(PAGE_BREAK);
    for (const block of blocks) {
      if (!block.text?.trim()) continue;
      body.push(paragraph(block));
    }
  });

  // Word treats a body with no paragraphs as damaged, so an empty document gets an empty one.
  if (body.length === 0) body.push('<w:p/>');

  const document =
    `${XML_DECLARATION}<w:document ${W}><w:body>${body.join('')}${SECTION}</w:body></w:document>`;

  const encoder = new TextEncoder();
  return createZip([
    // [Content_Types].xml must come first: some readers assume it is the first entry.
    { name: '[Content_Types].xml', data: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: encoder.encode(ROOT_RELS) },
    { name: 'docProps/core.xml', data: encoder.encode(coreProperties(title)) },
    { name: 'word/_rels/document.xml.rels', data: encoder.encode(DOCUMENT_RELS) },
    { name: 'word/document.xml', data: encoder.encode(document) },
    { name: 'word/styles.xml', data: encoder.encode(STYLES) },
    { name: 'word/numbering.xml', data: encoder.encode(NUMBERING) },
  ]);
}
