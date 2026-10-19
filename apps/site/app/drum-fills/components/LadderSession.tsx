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
import {resolveRungIndex} from '@/lib/drum-fills/practice/fillLadder';
import {
  climbLadder,
  initRungClimb,
  type LadderClimbOptions,
  type RungClimb,
} from '@/lib/drum-fills/practice/ladderClimb';
import DifficultyBar from './DifficultyBar';
import PracticeView from './PracticeView';
import type {FeedbackCallout} from './PracticeFeedbackBanner';

/**
 * Entry tempo for a rung by its ladder position: the easiest rung starts near
 * full speed, the hardest a bit slower, so early rungs aren't tediously slow.
 */
function rungStartTempoPct(index: number, rungCount: number): number {
  if (rungCount <= 1) return 90;
  const frac = index / (rungCount - 1);
  return Math.round(90 - 15 * frac); // 90% (easiest) → 75% (hardest)
}

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
  const [climb, setClimb] = useState<RungClimb | null>(null);
  // Big transient callout for the feedback banner (replaces toasts).
  const [callout, setCallout] = useState<FeedbackCallout | null>(null);
  const calloutIdRef = useRef(0);
  const climbRef = useRef<RungClimb | null>(null);
  useEffect(() => {
    climbRef.current = climb;
  }, [climb]);

  // Per-rung tempo, remembered for this session so re-climbing a rung resumes
  // where it left off instead of resetting to the rung's start tempo. Lives in
  // the parent so it survives PracticeView's per-rung remount.
  const tempoMemoryRef = useRef<Map<number, number>>(new Map());

  // Climb-machine options. rungEntryTempoPct consults the session tempo memory
  // first, falling back to the difficulty-scaled start.
  const climbOptions = useCallback(
    (rungCount: number): Partial<LadderClimbOptions> => ({
      rungEntryTempoPct: (index: number) =>
        tempoMemoryRef.current.get(index) ??
        rungStartTempoPct(index, rungCount),
    }),
    [],
  );

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
        tempoMemoryRef.current = new Map();
        setRungs(ladder);
        setClimb(initRungClimb(startIndex, climbOptions(ladder.length)));
      } catch (err) {
        console.error('Failed to load ladder', err);
        toast.error('Could not load this groove ladder.');
        setRungs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cluster.similarityKey, climbOptions]);

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

  // Run the tempo-aware climb machine on each scored attempt. Event handler —
  // no setState inside an updater.
  const onAttemptScored = useCallback(
    (result: ScoredAttempt) => {
      const list = rungs;
      const cur = climbRef.current;
      if (!list || list.length === 0 || !cur) return;
      const opts = climbOptions(list.length);
      const {climb: next, change} = climbLadder(
        cur,
        list.length,
        result.score.passed,
        opts,
      );
      tempoMemoryRef.current.set(next.index, next.tempoPct);
      setClimb(next);

      const emit = (text: string, tone: FeedbackCallout['tone']) =>
        setCallout({id: ++calloutIdRef.current, text, tone});
      if (change === 'advance') {
        persist(next.index);
        emit(`↑ RUNG ${next.index + 1}`, 'up');
      } else if (change === 'speed-up') {
        emit(`▲ ${next.tempoPct}%`, 'up');
      } else if (change === 'slow-down') {
        emit(`▼ ${next.tempoPct}% — lock it in`, 'down');
      }
    },
    [rungs, persist, climbOptions],
  );

  // Manual tempo override from the slider/keyboard. Changing the tempo makes the
  // pass/fail streak at the old tempo stale, so reset the tally. Decide from the
  // ref (no side effects inside a setState updater).
  const onTempoPctChange = useCallback((pct: number) => {
    const cur = climbRef.current;
    if (!cur) return;
    tempoMemoryRef.current.set(cur.index, pct);
    setClimb({...cur, tempoPct: pct, passesAtTempo: 0, failsAtTempo: 0});
  }, []);

  const selectRung = useCallback(
    (index: number) => {
      setClimb(initRungClimb(index, climbOptions(rungs?.length ?? 1)));
      persist(index);
    },
    [persist, climbOptions, rungs],
  );

  if (rungs === null || climb === null) {
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

  const current = rungs[climb.index];

  // Ladder position + current climb tempo shown in the practice bar's session
  // slot ([T]); the rung list below keeps full functionality. The groove
  // identity itself lives in the shared header `[H]` (published by
  // GrooveSession).
  const rungCtx = (
    <span className="rounded border bg-background px-2 py-1 text-xs font-medium">
      Rung {climb.index + 1}/{rungs.length} · {climb.tempoPct}%
    </span>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      <div className="flex shrink-0 flex-col gap-2 lg:w-64">
        <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded-lg border bg-card p-2">
          {rungs.map((rung, i) => {
            const isCurrent = i === climb.index;
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
          tempoPct={climb.tempoPct}
          onTempoPctChange={onTempoPctChange}
          feedbackStatus={`Rung ${climb.index + 1}/${rungs.length}`}
          feedbackCallout={callout}
        />
      </div>
    </div>
  );
}
