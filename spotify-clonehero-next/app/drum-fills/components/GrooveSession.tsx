'use client';

import {useEffect, useMemo, useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {
  getFillsByIds,
  type FillWithSrs,
  type GrooveCluster,
} from '@/lib/drum-fills/db';
import GrooveSketch from './GrooveSketch';
import FillRotationSession from './FillRotationSession';
import LadderSession from './LadderSession';

type SessionMode = 'rotate' | 'ladder';

/**
 * A Groove Session: pick a groove cluster, loop that groove, and rotate the
 * cluster's fills through it. Two modes:
 *  - Rotate: the fill roulette constrained to one groove (FillRotationSession).
 *  - Ladder: the cluster's unique patterns ordered simple→complex; the user
 *    climbs rungs (LadderSession, plan 0045 §6).
 *
 * Both modes default to the song-context loop (each fill loads its own song
 * audio); PracticeView falls back to the isolated synth loop per fill when its
 * song has no audio.
 */
export default function GrooveSession({
  cluster,
  initialMode = 'rotate',
  onExit,
}: {
  cluster: GrooveCluster;
  initialMode?: SessionMode;
  onExit: () => void;
}) {
  const [mode, setMode] = useState<SessionMode>(initialMode);
  const [pool, setPool] = useState<FillWithSrs[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setPool(await getFillsByIds(cluster.fillIds));
      } catch (err) {
        console.error('Failed to load groove fills', err);
        toast.error('Could not load this groove.');
        setPool([]);
      }
    })();
  }, [cluster.fillIds]);

  // Rotate in difficulty order (simple→complex) so sequential rotation also
  // ramps up; shuffle still randomizes. Null scores sort last.
  const orderedPool = useMemo(
    () =>
      pool == null
        ? null
        : [...pool].sort(
            (a, b) =>
              (a.difficultyScore ?? Infinity) - (b.difficultyScore ?? Infinity),
          ),
    [pool],
  );

  // Ladder needs difficulty scores; they're NULL on fills detected before the
  // §6 migration. Offer ladder only when the cluster's fills are scored.
  const ladderReady = useMemo(
    () => pool != null && pool.some(f => f.difficultyScore != null),
    [pool],
  );

  if (pool === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Loading groove…
      </div>
    );
  }

  if (pool.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-muted-foreground">This groove has no fills.</p>
        <Button variant="outline" onClick={onExit}>
          Back to Grooves
        </Button>
      </div>
    );
  }

  const modeSwitch = (
    <div className="flex items-center gap-2">
      <div className="flex overflow-hidden rounded-md border text-xs">
        {(['rotate', 'ladder'] as SessionMode[]).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            disabled={m === 'ladder' && !ladderReady}
            title={
              m === 'ladder' && !ladderReady
                ? 'Rescan your library to compute difficulty scores for the ladder.'
                : undefined
            }
            className={cn(
              'px-2.5 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              m === mode
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted',
            )}>
            {m === 'rotate' ? 'Rotate' : 'Ladder'}
          </button>
        ))}
      </div>
      {!ladderReady && (
        <span className="text-xs text-amber-600">Rescan to enable ladder</span>
      )}
    </div>
  );

  if (mode === 'ladder' && ladderReady) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <GrooveHeader cluster={cluster} extra={modeSwitch} />
        <LadderSession cluster={cluster} onExit={onExit} />
      </div>
    );
  }

  return (
    /* Defaults to Song loop (each fill loads its own song audio); PracticeView
       falls back to Isolated synth per fill when its song has no audio. */
    <FillRotationSession
      pool={orderedPool ?? pool}
      onExit={onExit}
      header={<GrooveHeader cluster={cluster} extra={modeSwitch} />}
    />
  );
}

function GrooveHeader({
  cluster,
  extra,
}: {
  cluster: GrooveCluster;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-2">
      <div className="w-40 shrink-0">
        <GrooveSketch fingerprint={cluster.representativeFingerprint} />
      </div>
      <div className="text-sm">
        <p className="font-semibold">Groove session</p>
        <p className="text-xs text-muted-foreground">
          {cluster.fillCount} fill{cluster.fillCount === 1 ? '' : 's'} ·{' '}
          {cluster.distinctSongs} song{cluster.distinctSongs === 1 ? '' : 's'} ·{' '}
          {Math.round(cluster.tempoMin)}–{Math.round(cluster.tempoMax)} BPM
        </p>
      </div>
      {extra && <div className="ml-auto">{extra}</div>}
    </div>
  );
}
