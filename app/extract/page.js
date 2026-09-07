import { metadataForTool } from '../../lib/seo';
import { ToolSchema } from '../_components/tool-schema';
import ExtractTool from './extract-tool';

export const metadata = metadataForTool('extract');

export default function ExtractPage() {
  return (
    <>
      <ToolSchema id="extract" />
      <ExtractTool />
    </>
  );
}
