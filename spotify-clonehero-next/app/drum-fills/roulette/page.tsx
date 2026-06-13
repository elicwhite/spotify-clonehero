import type {Metadata} from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = {
  title: 'Roulette · Drum Fills',
  description: 'Practice a random drum fill from your library.',
};

const RouletteRoute = dynamic(() => import('./RouletteRoute'));

export default function Page() {
  return <RouletteRoute />;
}
