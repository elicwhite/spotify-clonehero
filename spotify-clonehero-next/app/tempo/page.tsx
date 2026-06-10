import dynamic from 'next/dynamic';
import type {Metadata} from 'next';

export const metadata: Metadata = {
  title: 'Tempo Mapper',
  description:
    'Detect the tempo and time signature of any song in your browser, and rebuild chart sync tracks to match.',
};

const TempoClient = dynamic(() => import('./TempoClient'));

export default function Page() {
  return <TempoClient />;
}
