'use client';

import {useCallback, useEffect, useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {queryFills, type FillWithSrs} from '@/lib/local-db/drum-fills';
import PracticeView from './PracticeView';

/** Pick a random index different from `avoid` (when possible). */
function pickNext(count: number, avoid: number): number {
  if (count <= 1) return 0;
  let next = Math.floor(Math.random() * count);
  if (next === avoid) next = (next + 1) % count;
  return next;
}

/**
 * Fill roulette: draws a random fill from the library and, on Next, advances to
 * another random fill — sight-reading practice across the whole vocabulary.
 * PracticeView's roulette mode supplies the steady synth beat + notation.
 */
export default function RouletteSession({onExit}: {onExit: () => void}) {
  const [pool, setPool] = useState<FillWithSrs[] | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const rows = await queryFills({});
        setPool(rows);
        setIndex(rows.length > 0 ? Math.floor(Math.random() * rows.length) : 0);
      } catch (err) {
        console.error('Failed to load roulette pool', err);
        toast.error('Could not load fills for roulette.');
        setPool([]);
      }
    })();
  }, []);

  const next = useCallback(() => {
    setPool(p => {
      if (p) setIndex(i => pickNext(p.length, i));
      return p;
    });
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
    <PracticeView
      key={pool[index].id}
      fillId={pool[index].id}
      onExit={onExit}
      onNext={next}
    />
  );
}
