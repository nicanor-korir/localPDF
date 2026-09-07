import { metadataForTool } from '../../lib/seo';
import { ToolSchema } from '../_components/tool-schema';
import SplitTool from './split-tool';

export const metadata = metadataForTool('split');

export default function SplitPage() {
  return (
    <>
      <ToolSchema id="split" />
      <SplitTool />
    </>
  );
}
