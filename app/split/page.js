import SplitTool from './split-tool';

export const metadata = {
  title: 'Split a PDF',
  description:
    'Break a PDF into several files by range, every N pages, or one file per page. Everything runs locally in your browser — your files never leave your device.',
  alternates: { canonical: '/split' },
};

export default function SplitPage() {
  return <SplitTool />;
}
