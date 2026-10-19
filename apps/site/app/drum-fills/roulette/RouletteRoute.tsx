'use client';

import {useRouter} from 'next/navigation';
import RouletteSession from '../components/RouletteSession';

/**
 * Fill roulette (`/drum-fills/roulette`). Advancing draws the next random fill
 * inside RouletteSession; Exit returns to Home.
 */
export default function RouletteRoute() {
  const router = useRouter();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <RouletteSession onExit={() => router.push('/drum-fills')} />
    </div>
  );
}
