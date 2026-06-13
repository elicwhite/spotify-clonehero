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
import {useChromeSlot} from '../contexts/DrumFillsChromeContext';
import GrooveStave from './GrooveStave';
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
 *
 * Groove identity + the Rotate/Ladder toggle live in the shared header `[H]`
 * context slot (driving `?mode=`), so the old 170px GrooveHeader card is gone
 * and the highway/notation reclaim the space.
 */
export default function GrooveSession({
  cluster,
  initialMode = 'rotate',
  onModeChange,
  onExit,
}: {
  cluster: GrooveCluster;
  initialMode?: SessionMode;
  /** Switch session mode; deep-link-driven (router.replace('?mode=…')). */
  onModeChange: (mode: SessionMode) => void;
  onExit: () => void;
}) {
  const mode = initialMode;
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

  // Publish groove identity + the Rotate/Ladder toggle into the shared header
  // context slot (single canonical copy of the groove metadata).
  const headerSlot = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="hidden w-28 shrink-0 sm:block">
          <GrooveStave fingerprint={cluster.representativeFingerprint} />
        </div>
        <div className="text-xs">
          <span className="font-semibold text-foreground">Groove</span> ·{' '}
          {cluster.fillCount} fill{cluster.fillCount === 1 ? '' : 's'} ·{' '}
          {cluster.distinctSongs} song{cluster.distinctSongs === 1 ? '' : 's'} ·{' '}
          {Math.round(cluster.tempoMin)}–{Math.round(cluster.tempoMax)} BPM
        </div>
        <ModeToggle
          mode={mode}
          ladderReady={ladderReady}
          onModeChange={onModeChange}
        />
      </div>
    ),
    [cluster, mode, ladderReady, onModeChange],
  );
  useChromeSlot(headerSlot);

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

  if (mode === 'ladder' && ladderReady) {
    return <LadderSession cluster={cluster} onExit={onExit} />;
  }

  return (
    /* Defaults to Song loop (each fill loads its own song audio); PracticeView
       falls back to Isolated synth per fill when its song has no audio. */
    <FillRotationSession pool={orderedPool ?? pool} onExit={onExit} />
  );
}

/** Rotate ⇄ Ladder segmented toggle; deep-link-driven via `onModeChange`. */
function ModeToggle({
  mode,
  ladderReady,
  onModeChange,
}: {
  mode: SessionMode;
  ladderReady: boolean;
  onModeChange: (mode: SessionMode) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex overflow-hidden rounded-md border text-xs">
        {(['rotate', 'ladder'] as SessionMode[]).map(m => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
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
        <span className="text-amber-600">Rescan to enable ladder</span>
      )}
    </div>
  );
}
