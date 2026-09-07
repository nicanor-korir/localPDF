import { metadataForTool } from '../../lib/seo';
import { ToolSchema } from '../_components/tool-schema';
import ProtectTool from './protect-tool';

export const metadata = metadataForTool('protect');

export default function ProtectPage() {
  return (
    <>
      <ToolSchema id="protect" />
      <ProtectTool />
    </>
  );
}
