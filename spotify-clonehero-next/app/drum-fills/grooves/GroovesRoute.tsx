'use client';

import {useRouter} from 'next/navigation';
import {type GrooveCluster} from '@/lib/drum-fills/db';
import {useDrumFillsChrome} from '../contexts/DrumFillsChromeContext';
import GroovesView from '../components/GroovesView';

/**
 * Grooves explorer (`/drum-fills/grooves`). Cards deep-link to a groove session
 * in rotate mode. Re-keyed on scan completion so the cluster list refreshes.
 */
export default function GroovesRoute() {
  const router = useRouter();
  const {scanVersion} = useDrumFillsChrome();

  const startSession = (cluster: GrooveCluster) =>
    router.push(
      `/drum-fills/groove/${encodeURIComponent(cluster.similarityKey)}?mode=rotate`,
    );

  return (
    <div className="flex min-h-0 max-w-screen-xl flex-1 flex-col overflow-y-auto">
      <GroovesView key={scanVersion} onStartSession={startSession} />
    </div>
  );
}
