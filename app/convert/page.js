import ConvertTool from './convert-tool';

export const metadata = {
  title: 'Convert a PDF',
  description:
    'Turn a PDF into PNG or JPEG images, plain text, Markdown or a Word document. Everything runs locally in your browser — your file never leaves your device.',
  alternates: { canonical: '/convert' },
};

export default function ConvertPage() {
  return <ConvertTool />;
}
