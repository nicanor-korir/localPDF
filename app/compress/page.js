import CompressTool from './compress-tool';

export const metadata = {
  title: 'Compress a PDF',
  description:
    'Make a PDF smaller by re-encoding its images. Everything runs locally in your browser — your file never leaves your device.',
  alternates: { canonical: '/compress' },
};

export default function CompressPage() {
  return <CompressTool />;
}
