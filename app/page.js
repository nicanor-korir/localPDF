import { homeMetadata } from '../lib/seo';
import Landing from './landing';

export const metadata = homeMetadata();

export default function Home() {
  return <Landing />;
}
