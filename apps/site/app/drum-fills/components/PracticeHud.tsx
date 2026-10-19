'use client';

import {cn} from '@/lib/utils';
import type {
  BestAttempt,
  ScoredAttempt,
} from '@/lib/drum-fills/practice/attempt';
import type {FillSrsState} from '@/lib/drum-fills/practice/srs';

function scoreColor(score: number): string {
  if (score >= 90) return 'text-green-600';
  if (score >= 70) return 'text-amber-600';
  return 'text-red-600';
}

/** Live scoring + mastery readout shown beside the practice views. */
export default function PracticeHud({
  lastAttempt,
  bestAttempt,
  newBest,
  srs,
  dueNow,
  tempoPct,
  speedTrainer,
}: {
  lastAttempt: ScoredAttempt | null;
  bestAttempt: BestAttempt | null;
  newBest: boolean;
  srs: FillSrsState | null;
  /** Whether this fill is currently due for review (drives the inline badge). */
  dueNow: boolean;
  tempoPct: number;
  speedTrainer: boolean;
}) {
  const s = lastAttempt?.score;

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 text-sm">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">Last attempt</span>
        {s ? (
          <span
            className={cn(
              'text-2xl font-bold tabular-nums',
              scoreColor(s.score),
            )}>
            {Math.round(s.score)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>

      {s && (
        <div className="grid grid-cols-4 gap-1 text-center text-xs">
          <Stat label="Perfect" value={s.perfect} className="text-green-600" />
          <Stat label="Good" value={s.good} className="text-amber-600" />
          <Stat label="Miss" value={s.miss} className="text-red-600" />
          <Stat
            label="Extra"
            value={s.extraHits}
            className="text-muted-foreground"
          />
        </div>
      )}

      {s && s.meanAbsTimingErrorMs > 0 && (
        <div className="text-xs text-muted-foreground">
          Avg timing error: {Math.round(s.meanAbsTimingErrorMs)}ms
        </div>
      )}

      {s && (
        <div
          className={cn(
            'rounded px-2 py-1 text-center text-xs font-medium',
            s.passed
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800',
          )}>
          {s.passed ? 'PASS' : 'Keep trying'}
        </div>
      )}

      <div className="border-t pt-2">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">
            Best
            {newBest && (
              <span className="ml-1 rounded bg-green-100 px-1 py-0.5 text-[10px] font-bold text-green-700">
                NEW BEST!
              </span>
            )}
          </span>
          {bestAttempt ? (
            <span
              className={cn(
                'text-xl font-bold tabular-nums',
                scoreColor(bestAttempt.score),
              )}>
              {Math.round(bestAttempt.score)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
        {bestAttempt && (
          <div className="mt-1 grid grid-cols-4 gap-1 text-center text-[11px]">
            <Stat
              label="Perfect"
              value={bestAttempt.perfect}
              className="text-green-600"
            />
            <Stat
              label="Good"
              value={bestAttempt.good}
              className="text-amber-600"
            />
            <Stat
              label="Miss"
              value={bestAttempt.miss}
              className="text-red-600"
            />
            <Stat
              label="Extra"
              value={bestAttempt.extra ?? 0}
              className="text-muted-foreground"
            />
          </div>
        )}
      </div>

      <div className="border-t pt-2">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Mastery</span>
          <MasteryBadge state={srs?.state ?? 'new'} />
        </div>
        {srs && (
          <div className="mt-1 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Streak: {srs.passStreak}
            </span>
            {dueNow ? (
              <span className="font-medium text-amber-600">Due now</span>
            ) : (
              srs.dueAt && (
                <span className="text-muted-foreground">
                  Due: {srs.dueAt.toLocaleDateString()}
                </span>
              )
            )}
          </div>
        )}
      </div>

      {speedTrainer && (
        <div className="border-t pt-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Speed trainer</span>
            <span className="font-mono font-semibold">{tempoPct}%</span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{width: `${Math.min(100, (tempoPct / 110) * 100)}%`}}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div>
      <div className={cn('text-lg font-bold tabular-nums', className)}>
        {value}
      </div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

function MasteryBadge({state}: {state: FillSrsState['state']}) {
  const styles: Record<FillSrsState['state'], string> = {
    new: 'bg-muted text-muted-foreground',
    learning: 'bg-amber-100 text-amber-800',
    mastered: 'bg-green-100 text-green-800',
  };
  return (
    <span
      className={cn('rounded px-2 py-0.5 text-xs font-medium', styles[state])}>
      {state}
    </span>
  );
}
