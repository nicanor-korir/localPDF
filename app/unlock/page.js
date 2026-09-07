import { metadataForTool } from '../../lib/seo';
import { ToolSchema } from '../_components/tool-schema';
import UnlockTool from './unlock-tool';

export const metadata = metadataForTool('unlock');

export default function UnlockPage() {
  return (
    <>
      <ToolSchema id="unlock" />
      <UnlockTool />
    </>
  );
}
