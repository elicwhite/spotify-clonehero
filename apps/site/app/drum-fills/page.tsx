import type {Metadata} from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = {
  title: 'Drum Fills Practice',
  description:
    'Learn and master drum fills from your Clone Hero library with MIDI scoring and spaced repetition.',
};

const HomeRoute = dynamic(() => import('./HomeRoute'));

export default function Page() {
  return <HomeRoute />;
}
