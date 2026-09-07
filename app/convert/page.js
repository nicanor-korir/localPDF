import { metadataForTool } from '../../lib/seo';
import { ToolSchema } from '../_components/tool-schema';
import ConvertTool from './convert-tool';

export const metadata = metadataForTool('convert');

export default function ConvertPage() {
  return (
    <>
      <ToolSchema id="convert" />
      <ConvertTool />
    </>
  );
}
