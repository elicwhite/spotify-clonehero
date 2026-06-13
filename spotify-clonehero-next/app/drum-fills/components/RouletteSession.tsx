'use client';

import {useEffect, useMemo, useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {queryFills, type FillWithSrs} from '@/lib/drum-fills/db';
import {useChromeSlot} from '../contexts/DrumFillsChromeContext';
import FillRotationSession from './FillRotationSession';

/**
 * Fill roulette: rotates random fills from the whole library — sight-reading
 * practice across the entire vocabulary. This is the unconstrained case of a
 * rotating-fill session (a groove session is the same loop limited to one
 * groove cluster), so it just feeds the full pool to FillRotationSession.
 */
export default function RouletteSession({onExit}: {onExit: () => void}) {
  const [pool, setPool] = useState<FillWithSrs[] | null>(null);

  // "Fill roulette" label + End live in the shared header `[H]` context slot.
  const headerSlot = useMemo(
    () => (
      <div className="flex items-center gap-3">
        <span>Fill roulette</span>
        <Button variant="ghost" size="sm" onClick={onExit}>
          End
        </Button>
      </div>
    ),
    [onExit],
  );
  useChromeSlot(headerSlot);

  useEffect(() => {
    (async () => {
      try {
        setPool(await queryFills({}));
      } catch (err) {
        console.error('Failed to load roulette pool', err);
        toast.error('Could not load fills for roulette.');
        setPool([]);
      }
    })();
  }, []);

  if (pool === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Loading roulette…
      </div>
    );
  }

  if (pool.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-muted-foreground">
          No fills available. Scan your library first.
        </p>
        <Button variant="outline" onClick={onExit}>
          Back to Library
        </Button>
      </div>
    );
  }

  return (
    <FillRotationSession pool={pool} onExit={onExit} initialOrder="shuffle" />
  );
}
