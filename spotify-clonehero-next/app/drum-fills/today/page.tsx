import type {Metadata} from 'next';
import dynamic from 'next/dynamic';

export const metadata: Metadata = {
  title: 'Today · Drum Fills',
  description: "Practice today's due drum-fill reviews.",
};

const TodayRoute = dynamic(() => import('./TodayRoute'));

export default function Page() {
  return <TodayRoute />;
}
