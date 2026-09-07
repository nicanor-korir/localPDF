import { metadataForTool } from '../../lib/seo';
import { ToolSchema } from '../_components/tool-schema';
import OrganiseTool from './organise-tool';

export const metadata = metadataForTool('organise');

export default function OrganisePage() {
  return (
    <>
      <ToolSchema id="organise" />
      <OrganiseTool />
    </>
  );
}
