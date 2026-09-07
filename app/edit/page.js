import { metadataForTool } from '../../lib/seo';
import { ToolSchema } from '../_components/tool-schema';
import EditTool from './edit-tool';

export const metadata = metadataForTool('edit');

export default function EditPageRoute() {
  return (
    <>
      <ToolSchema id="edit" />
      <EditTool />
    </>
  );
}
