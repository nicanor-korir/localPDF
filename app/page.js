import { metadataForTool } from '../lib/seo';
import { ToolSchema } from './_components/tool-schema';
import MergeTool from './merge-tool';

export const metadata = metadataForTool('merge');

export default function Home() {
  return (
    <>
      <ToolSchema id="merge" />
      <MergeTool />
    </>
  );
}
