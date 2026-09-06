import ProtectTool from './protect-tool';

export const metadata = {
  title: 'Protect a PDF with a password',
  description:
    'Add an AES-256 password to a PDF and restrict printing or copying. Everything runs locally in your browser — your file never leaves your device.',
  alternates: { canonical: '/protect' },
};

export default function ProtectPage() {
  return <ProtectTool />;
}
