'use client';

import {useEffect, useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Card, CardContent} from '@/components/ui/card';
import {
  getGrooveClusters,
  hasFillsNeedingGrooveRescan,
  type GrooveCluster,
} from '@/lib/drum-fills/db';
import {MIN_DRILLABLE_FILLS} from '@/lib/drum-fills/grooveClusters';
import GrooveSketch from './GrooveSketch';

const SUBDIVISION_LABEL: Record<string, string> = {
  '8ths': '8ths',
  '16ths': '16ths',
  triplets: 'Triplets',
  mixed: 'Mixed',
};

export default function GroovesView({
  onStartSession,
  onRescan,
  scanning,
}: {
  onStartSession: (cluster: GrooveCluster) => void;
  onRescan: () => void;
  scanning: boolean;
}) {
  const [clusters, setClusters] = useState<GrooveCluster[] | null>(null);
  const [needsRescan, setNeedsRescan] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [list, stale] = await Promise.all([
          getGrooveClusters(),
          hasFillsNeedingGrooveRescan(),
        ]);
        setClusters(list);
        setNeedsRescan(stale);
      } catch (err) {
        console.error('Failed to load grooves', err);
        toast.error('Could not load grooves.');
        setClusters([]);
      }
    })();
  }, []);

  if (clusters === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Loading grooves…
      </div>
    );
  }

  // A groove worth drilling needs enough fills to rotate through; clusters with
  // only a couple are too thin and just clutter the grid. Sorted by intrinsic
  // groove difficulty (easiest beats first) upstream.
  const drillable = clusters.filter(c => c.fillCount >= MIN_DRILLABLE_FILLS);
  const hiddenCount = clusters.length - drillable.length;

  return (
    <div className="flex flex-1 flex-col gap-4">
      {needsRescan && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-900">
            Some fills were detected before groove tracking. Rescan your library
            to enable Grooves for them.
          </p>
          <Button onClick={onRescan} disabled={scanning} size="sm">
            {scanning ? 'Scanning…' : 'Rescan Library'}
          </Button>
        </div>
      )}

      {clusters.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <h2 className="text-xl font-semibold">No grooves yet</h2>
          <p className="max-w-md text-muted-foreground">
            Scan your library to detect fills and the grooves they sit on. Pick
            a groove to drill many different fills over the same beat.
          </p>
          <Button onClick={onRescan} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Scan Library'}
          </Button>
        </div>
      ) : drillable.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground">
          No grooves recur across multiple fills yet. Scan more of your library
          to find shared grooves to drill.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {drillable.map(cluster => (
              <GrooveCard
                key={cluster.similarityKey}
                cluster={cluster}
                onStart={() => onStartSession(cluster)}
              />
            ))}
          </div>
          {hiddenCount > 0 && (
            <p className="pb-4 text-center text-xs text-muted-foreground">
              {hiddenCount.toLocaleString()} thinly-populated groove
              {hiddenCount === 1 ? '' : 's'} hidden — practice those fills from
              the Library.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function GrooveCard({
  cluster,
  onStart,
}: {
  cluster: GrooveCluster;
  onStart: () => void;
}) {
  const tempoLabel =
    Math.round(cluster.tempoMin) === Math.round(cluster.tempoMax)
      ? `${Math.round(cluster.tempoMin)} BPM`
      : `${Math.round(cluster.tempoMin)}–${Math.round(cluster.tempoMax)} BPM`;

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 pt-4">
        <GrooveSketch fingerprint={cluster.representativeFingerprint} />

        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge variant="secondary">
            {cluster.fillCount} fill{cluster.fillCount === 1 ? '' : 's'}
          </Badge>
          <Badge variant="secondary">
            {cluster.distinctSongs} song{cluster.distinctSongs === 1 ? '' : 's'}
          </Badge>
          <Badge variant="outline">{tempoLabel}</Badge>
        </div>

        {cluster.subdivisions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {cluster.subdivisions.map(s => (
              <Badge key={s.value} variant="outline" className="text-[10px]">
                {SUBDIVISION_LABEL[s.value] ?? s.value} ×{s.count}
              </Badge>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Cx {cluster.complexities.join(', ')}
          </span>
          <Button
            size="sm"
            onClick={onStart}
            disabled={cluster.fillCount === 0}>
            Drill groove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
