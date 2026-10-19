import dynamic from 'next/dynamic';
import type {Metadata} from 'next';

export const metadata: Metadata = {
  title: 'Tempo Mapper',
  description:
    'Build a draft tempo map and beat grid for a 4/4 song in your browser, and rebuild chart sync tracks to match.',
};

const TempoClient = dynamic(() => import('./TempoClient'));

export default function Page() {
  return <TempoClient />;
}
