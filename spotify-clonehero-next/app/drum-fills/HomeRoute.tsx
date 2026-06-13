'use client';

import {useEffect, useState} from 'react';
import {useRouter} from 'next/navigation';
import {getFillCount, type GrooveCluster} from '@/lib/drum-fills/db';
import {useDrumFillsChrome} from './contexts/DrumFillsChromeContext';
import HomeView from './components/HomeView';

/**
 * Home surface (`/drum-fills`). Reads fill presence (re-fetched on scan
 * completion via `scanVersion`) for the first-run gate and wires HomeView's
 * actions to App-Router navigation. Scrolls within the bounded viewport.
 */
export default function HomeRoute() {
  const router = useRouter();
  const {scanVersion, scanning, scanProgress, runScan} = useDrumFillsChrome();
  const [hasData, setHasData] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let n = 0;
      try {
        n = await getFillCount();
      } catch {
        // ignore — HomeView renders its own empty state
      }
      if (cancelled) return;
      setHasData(n > 0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [scanVersion]);

  const startGroove = (cluster: GrooveCluster) =>
    router.push(
      `/drum-fills/groove/${encodeURIComponent(cluster.similarityKey)}?mode=ladder`,
    );

  return (
    <div className="flex min-h-0 max-w-screen-xl flex-1 flex-col overflow-y-auto">
      <HomeView
        key={scanVersion}
        hasData={hasData}
        loading={loading}
        scanning={scanning}
        scanProgress={scanProgress}
        onScan={runScan}
        onStartReview={() => router.push('/drum-fills/today')}
        onStartRoulette={() => router.push('/drum-fills/roulette')}
        onBrowseGrooves={() => router.push('/drum-fills/grooves')}
        onStartGroove={startGroove}
      />
    </div>
  );
}
