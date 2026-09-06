import OrganiseTool from './organise-tool';

export const metadata = {
  title: 'Organise PDF pages',
  description:
    'Reorder, rotate, crop and delete pages in a PDF. Everything runs locally in your browser — your files never leave your device.',
  alternates: { canonical: '/organise' },
};

export default function OrganisePage() {
  return <OrganiseTool />;
}
