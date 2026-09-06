import UnlockTool from './unlock-tool';

export const metadata = {
  title: 'Unlock a PDF',
  description:
    'Remove a password or the restrictions on printing and copying from a PDF. Everything runs locally in your browser — your file never leaves your device.',
  alternates: { canonical: '/unlock' },
};

export default function UnlockPage() {
  return <UnlockTool />;
}
