import RedactTool from './redact-tool';

export const metadata = {
  title: 'Redact a PDF',
  description:
    'Remove content from a PDF for good, not just cover it with a black box. Everything runs locally in your browser — your file never leaves your device.',
  alternates: { canonical: '/redact' },
};

export default function RedactPageRoute() {
  return <RedactTool />;
}
