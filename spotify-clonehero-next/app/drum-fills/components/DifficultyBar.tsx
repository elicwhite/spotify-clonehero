'use client';

import {cn} from '@/lib/utils';

/**
 * Compact continuous-difficulty indicator (0–100). A small filled bar plus the
 * numeric score, used on fill cards and ladder rungs. Null score (pre-migration
 * fills) renders a muted dash. Color ramps green→amber→red with difficulty.
 */
export default function DifficultyBar({
  score,
  className,
}: {
  score: number | null;
  className?: string;
}) {
  if (score == null) {
    return (
      <span
        className={cn('text-xs text-muted-foreground', className)}
        title="Difficulty unknown — rescan to compute">
        Diff —
      </span>
    );
  }
  const clamped = Math.max(0, Math.min(100, score));
  const color =
    clamped < 33
      ? 'bg-green-500'
      : clamped < 66
        ? 'bg-amber-500'
        : 'bg-red-500';
  return (
    <span
      className={cn('flex items-center gap-1.5', className)}
      title={`Difficulty ${Math.round(clamped)} / 100`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span
          className={cn('block h-full rounded-full', color)}
          style={{width: `${clamped}%`}}
        />
      </span>
      <span className="font-mono text-xs text-muted-foreground">
        {Math.round(clamped)}
      </span>
    </span>
  );
}
