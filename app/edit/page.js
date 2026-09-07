import EditTool from './edit-tool';

export const metadata = {
  title: 'Edit a PDF',
  description:
    'Add text and images to a PDF page. Everything runs locally in your browser — your file never leaves your device.',
  alternates: { canonical: '/edit' },
};

export default function EditPage() {
  return <EditTool />;
}
