import type {Metadata} from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = {
  title: 'Grooves · Drum Fills',
  description: 'Browse the grooves in your library and drill their fills.',
};

const GroovesRoute = dynamic(() => import('./GroovesRoute'));

export default function Page() {
  return <GroovesRoute />;
}
