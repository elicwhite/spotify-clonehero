'use client';

import {useRouter} from 'next/navigation';
import TodayQueue from '../components/TodayQueue';

/**
 * Today's review queue (`/drum-fills/today`). Advancing through the queue stays
 * internal to TodayQueue; Exit returns to Home.
 */
export default function TodayRoute() {
  const router = useRouter();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <TodayQueue onExit={() => router.push('/drum-fills')} />
    </div>
  );
}
