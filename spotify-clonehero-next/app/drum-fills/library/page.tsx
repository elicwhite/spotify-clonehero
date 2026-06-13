import type {Metadata} from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = {
  title: 'Library · Drum Fills',
  description: 'Browse and filter every drum fill detected in your library.',
};

const LibraryRoute = dynamic(() => import('./LibraryRoute'));

export default function Page() {
  return <LibraryRoute />;
}
