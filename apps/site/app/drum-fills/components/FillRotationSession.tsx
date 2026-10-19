'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import type {FillWithSrs} from '@/lib/drum-fills/db';
import type {ScoredAttempt} from '@/lib/drum-fills/practice/attempt';
import {
  nextRotationIndex,
  previewRotationIndex,
  type RotationOrder,
} from '@/lib/drum-fills/practice/fillRotation';
import PracticeView from './PracticeView';

export interface FillRotationSessionProps {
  /** Fills to rotate through. Must be non-empty (callers guard this). */
  pool: FillWithSrs[];
  onExit: () => void;
  /** Mode PracticeView starts in. */
  initialMode?: 'song-context' | 'isolated' | 'speed-trainer' | 'roulette';
  /** Starting rotation order (default sequential). */
  initialOrder?: RotationOrder;
}

/** One fill's session result, accumulated for the end-of-session summary. */
interface SeenFill {
  fillId: string;
  song: string;
  artist: string;
  attempts: number;
  bestScore: number | null;
}

/**
 * A rotating-fill practice session shared by the fill roulette (whole-library
 * pool) and groove sessions (one-cluster pool). It owns the pool index, the
 * sequential/shuffle order toggle, the "next fill one ahead" preview, and the
 * end-of-session summary (fills seen + scores). PracticeView supplies the loop,
 * highway/notation, and MIDI scoring per fill; attempts it records also feed
 * SRS, so a session benefits review scheduling.
 */
export default function FillRotationSession({
  pool,
  onExit,
  initialMode,
  initialOrder = 'sequential',
}: FillRotationSessionProps) {
  const firstIndex = () =>
    initialOrder === 'shuffle' && pool.length > 0
      ? Math.floor(Math.random() * pool.length)
      : 0;

  const [index, setIndex] = useState(firstIndex);
  const [order, setOrder] = useState<RotationOrder>(initialOrder);
  const orderRef = useRef(order);
  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  const [finished, setFinished] = useState(false);
  // Ids of fills shown this session (seeded with the first one). Added to on
  // advance — both are event handlers, so no setState-in-effect.
  const [visited, setVisited] = useState<Set<string>>(
    () => new Set([pool[index].id]),
  );
  // Per-fill scoring results, keyed by fill id; updated from the scoring
  // callback (an event handler).
  const [scores, setScores] = useState<Map<string, SeenFill>>(() => new Map());

  const current = pool[index];
  const previewIndex = previewRotationIndex(pool.length, index);
  const previewFill = pool[previewIndex];

  const onAttemptScored = useCallback(
    (result: ScoredAttempt) => {
      const score = result.score.score;
      const {id, song, artist} = current;
      setScores(prev => {
        const next = new Map(prev);
        const existing = next.get(id);
        next.set(id, {
          fillId: id,
          song,
          artist,
          attempts: (existing?.attempts ?? 0) + 1,
          bestScore:
            existing?.bestScore == null
              ? score
              : Math.max(existing.bestScore, score),
        });
        return next;
      });
    },
    [current],
  );

  // Advance to the next fill and mark it visited. Both setState calls run from
  // an event handler (never inside an updater), so the summary stays accurate.
  const advance = useCallback(() => {
    const ni = nextRotationIndex(pool.length, index, orderRef.current);
    setIndex(ni);
    setVisited(prev => {
      if (prev.has(pool[ni].id)) return prev;
      const next = new Set(prev);
      next.add(pool[ni].id);
      return next;
    });
  }, [pool, index]);

  const endSession = useCallback(() => setFinished(true), []);

  if (finished) {
    const seenList: SeenFill[] = [...visited].map(
      id =>
        scores.get(id) ?? {
          fillId: id,
          song: pool.find(f => f.id === id)?.song ?? '',
          artist: pool.find(f => f.id === id)?.artist ?? '',
          attempts: 0,
          bestScore: null,
        },
    );
    return (
      <SessionSummary
        seen={seenList}
        onExit={onExit}
        onRestart={() => {
          const i = firstIndex();
          setScores(new Map());
          setVisited(new Set([pool[i].id]));
          setFinished(false);
          setIndex(i);
        }}
      />
    );
  }

  const shuffleToggle = (
    <div className="flex items-center gap-2">
      <div className="flex overflow-hidden rounded-md border text-xs">
        {(['sequential', 'shuffle'] as RotationOrder[]).map(o => (
          <button
            key={o}
            onClick={() => setOrder(o)}
            className={cn(
              'px-2 py-1 font-medium transition-colors',
              o === order
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted',
            )}>
            {o === 'sequential' ? 'In order' : 'Shuffle'}
          </button>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={endSession}>
        End session
      </Button>
    </div>
  );

  return (
    <PracticeView
      key={current.id}
      fillId={current.id}
      onExit={onExit}
      onNext={advance}
      nextLabel={pool.length > 1 ? previewFill.song : undefined}
      onAttemptScored={onAttemptScored}
      transportExtras={shuffleToggle}
      initialMode={initialMode}
    />
  );
}

function SessionSummary({
  seen,
  onExit,
  onRestart,
}: {
  seen: SeenFill[];
  onExit: () => void;
  onRestart: () => void;
}) {
  const practiced = seen.filter(s => s.attempts > 0);
  const scores = practiced
    .map(s => s.bestScore)
    .filter((s): s is number => s != null);
  const avg =
    scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <h2 className="text-xl font-semibold">Session complete</h2>
      <p className="text-muted-foreground">
        {seen.length} fill{seen.length === 1 ? '' : 's'} seen ·{' '}
        {practiced.length} practiced
        {avg != null ? ` · avg best ${avg}%` : ''}
      </p>
      <div className="max-h-64 w-full max-w-md overflow-y-auto rounded-lg border">
        {seen.map(s => (
          <div
            key={s.fillId}
            className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm last:border-b-0">
            <span className="min-w-0 truncate text-left">
              {s.song}
              <span className="text-muted-foreground"> — {s.artist}</span>
            </span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {s.attempts === 0 ? '—' : `${s.bestScore ?? 0}% · ${s.attempts}x`}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onRestart}>
          Practice again
        </Button>
        <Button onClick={onExit}>Done</Button>
      </div>
    </div>
  );
}
