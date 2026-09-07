import { metadataForTool } from '../../lib/seo';
import { ToolSchema } from '../_components/tool-schema';
import RedactTool from './redact-tool';

export const metadata = metadataForTool('redact');

export default function RedactPageRoute() {
  return (
    <>
      <ToolSchema id="redact" />
      <RedactTool />
    </>
  );
}
