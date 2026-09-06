import ExtractTool from './extract-tool';

export const metadata = {
  title: 'Extract PDF pages',
  description:
    'Pick pages from a PDF and save them as a new document. Everything runs locally in your browser — your files never leave your device.',
  alternates: { canonical: '/extract' },
};

export default function ExtractPage() {
  return <ExtractTool />;
}
