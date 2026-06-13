'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {
  getGrooveLadder,
  getLadderProgress,
  setLadderProgress,
  type GrooveCluster,
  type LadderRung,
} from '@/lib/drum-fills/db';
import type {ScoredAttempt} from '@/lib/drum-fills/practice/attempt';
import {
  advanceLadder,
  initRungProgress,
  resolveRungIndex,
  type RungProgress,
} from '@/lib/drum-fills/practice/fillLadder';
import DifficultyBar from './DifficultyBar';
import PracticeView from './PracticeView';

/**
 * Ladder mode for a groove cluster (plan 0045 §6). The cluster's unique fill
 * patterns, ordered simple→complex by difficulty score, become rungs. The user
 * starts at the lowest unmastered rung, advances after enough passing attempts
 * (the same pass criteria PracticeView's SRS uses), and steps back on repeated
 * fails. Progress (current rung) persists per groove so the climb resumes.
 *
 * This reuses PracticeView for the actual loop/scoring; the ladder state machine
 * (`fillLadder`) decides when to change rungs from each scored attempt.
 */
export default function LadderSession({
  cluster,
  onExit,
}: {
  cluster: GrooveCluster;
  onExit: () => void;
}) {
  const [rungs, setRungs] = useState<LadderRung[] | null>(null);
  const [progress, setProgress] = useState<RungProgress | null>(null);
  const progressRef = useRef<RungProgress | null>(null);
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  // Load the ladder + saved position once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ladder, saved] = await Promise.all([
          getGrooveLadder(cluster.similarityKey),
          getLadderProgress(cluster.similarityKey),
        ]);
        if (cancelled) return;
        const startIndex = resolveRungIndex(
          ladder,
          saved?.currentRungFillId ?? null,
        );
        setRungs(ladder);
        setProgress(initRungProgress(startIndex));
      } catch (err) {
        console.error('Failed to load ladder', err);
        toast.error('Could not load this groove ladder.');
        setRungs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cluster.similarityKey]);

  // Persist the current rung whenever it changes.
  const persist = useCallback(
    (rungIndex: number) => {
      const list = rungs;
      if (!list || list.length === 0) return;
      void setLadderProgress({
        grooveSimilarityKey: cluster.similarityKey,
        currentRungFillId: list[rungIndex]?.fillSimilarityKey ?? null,
      }).catch(() => {});
    },
    [rungs, cluster.similarityKey],
  );

  // Run the ladder state machine on each scored attempt. Event handler — no
  // setState inside an updater.
  const onAttemptScored = useCallback(
    (result: ScoredAttempt) => {
      const list = rungs;
      const cur = progressRef.current;
      if (!list || list.length === 0 || !cur) return;
      const step = advanceLadder(cur, list.length, result.score.passed);
      setProgress(step.progress);
      if (step.moved) {
        persist(step.progress.index);
        const rung = list[step.progress.index];
        toast.message(
          step.direction === 'advance'
            ? `Rung ${step.progress.index + 1} — difficulty ${Math.round(
                rung.difficultyScore,
              )}`
            : `Stepped back to rung ${step.progress.index + 1}`,
        );
      }
    },
    [rungs, persist],
  );

  const selectRung = useCallback(
    (index: number) => {
      setProgress(initRungProgress(index));
      persist(index);
    },
    [persist],
  );

  if (rungs === null || progress === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Loading ladder…
      </div>
    );
  }

  if (rungs.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-muted-foreground">
          This groove has no rated fills yet. Rescan your library to compute
          difficulty scores.
        </p>
        <Button variant="outline" onClick={onExit}>
          Back to Grooves
        </Button>
      </div>
    );
  }

  const current = rungs[progress.index];

  // Ladder position shown in the practice bar's session slot ([T]); the rung
  // list below keeps full functionality. The groove identity itself lives in
  // the shared header `[H]` (published by GrooveSession).
  const rungCtx = (
    <span className="rounded border bg-background px-2 py-1 text-xs font-medium">
      Rung {progress.index + 1}/{rungs.length}
    </span>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      <div className="flex shrink-0 flex-col gap-2 lg:w-64">
        <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-lg border bg-card p-2">
          {rungs.map((rung, i) => {
            const isCurrent = i === progress.index;
            return (
              <li key={rung.fillSimilarityKey}>
                <button
                  onClick={() => selectRung(i)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                    isCurrent
                      ? 'bg-primary/10 ring-1 ring-primary'
                      : 'hover:bg-muted',
                  )}>
                  <span className="w-5 text-center font-mono text-muted-foreground">
                    {rung.state === 'mastered' ? '✓' : i + 1}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={rung.representative.song}>
                    {rung.representative.song}
                  </span>
                  <DifficultyBar score={rung.difficultyScore} />
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Defaults to Song loop (real audio for the rung's representative
            fill); PracticeView falls back to Isolated synth when the song has
            no audio. */}
        <PracticeView
          key={current.representative.id}
          fillId={current.representative.id}
          onExit={onExit}
          onAttemptScored={onAttemptScored}
          sessionCtx={rungCtx}
        />
      </div>
    </div>
  );
}
