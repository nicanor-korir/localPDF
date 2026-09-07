import { metadataForTool } from '../../lib/seo';
import { ToolSchema } from '../_components/tool-schema';
import CompressTool from './compress-tool';

export const metadata = metadataForTool('compress');

export default function CompressPage() {
  return (
    <>
      <ToolSchema id="compress" />
      <CompressTool />
    </>
  );
}
