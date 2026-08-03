'use client';

/**
 * One row of a processing step list — the single renderer behind both
 * shells: `ProcessingView` (full-page card, `default` density) and
 * `AssistRunCard` (inline in a Chart Assist card, `compact` density).
 *
 * Design rules baked in:
 *   - No overall ETA across steps. Steps are weighted differently and a
 *     summed estimate would mislead. Each step shows its own ETA only when
 *     one exists and is meaningful.
 *   - ETA visibility gates: status==='active' && progress > 5% && eta > 5s.
 *     Below those thresholds the estimate is too noisy to show.
 *   - Light/dark: every color tokenized except text-green-500 for the done
 *     check (looks correct in both modes).
 *
 * Density only scales type/icon/spacing. Anything that changes what the
 * user learns about a step belongs in `ProcessingStep`, not in a density
 * branch, so the two shells can never drift on content.
 */

import {AlertCircle, CheckCircle2, Circle, Loader2} from 'lucide-react';
import {Progress} from '@/components/ui/progress';
import {cn} from '@/lib/utils';

export interface ProcessingStep {
  /** Stable id used as React key; not displayed. */
  key: string;
  /** Bold first line, e.g. "Separating vocal stem". */
  label: string;
  /** Optional muted second line under the label. */
  description?: string | undefined;
  status: 'pending' | 'active' | 'done' | 'error';
  /**
   * 0..1 progress within this step. If omitted on an active step the
   * inner bar renders as indeterminate.
   */
  progress?: number | undefined;
  /**
   * Seconds remaining for the active step. Only displayed when
   * status==='active' && progress > 0.05 && etaSeconds > 5.
   */
  etaSeconds?: number | undefined;
  /** Wall-clock duration once status==='done'. Rendered as " 1.4s ". */
  durationMs?: number | undefined;
  /** Dynamic detail line ("Separating segment 5/34"). Optional. */
  detail?: string | undefined;
}

export type StepDensity = 'default' | 'compact';

export function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s left`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds - mins * 60);
  return `${mins}m ${secs}s left`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const DENSITY = {
  default: {
    row: 'gap-3',
    icon: 'h-5 w-5',
    label: 'text-sm',
    duration: 'text-xs',
    secondary: 'text-xs',
    barWrap: 'mt-1.5',
    bar: 'h-1.5',
  },
  compact: {
    row: 'gap-2.5',
    icon: 'h-4 w-4',
    label: 'text-xs',
    duration: 'text-[10px]',
    secondary: 'text-[11px]',
    barWrap: 'mt-1',
    bar: 'h-1',
  },
} as const satisfies Record<StepDensity, Record<string, string>>;

export default function StepRow({
  step,
  density = 'default',
}: {
  step: ProcessingStep;
  density?: StepDensity;
}) {
  const d = DENSITY[density];
  const eta =
    step.status === 'active' &&
    step.progress !== undefined &&
    step.progress > 0.05 &&
    step.etaSeconds !== undefined &&
    step.etaSeconds > 5
      ? step.etaSeconds
      : null;

  return (
    <div className={cn('flex items-start', d.row)}>
      <div className="mt-0.5 shrink-0">
        {step.status === 'done' && (
          <CheckCircle2 className={cn(d.icon, 'text-green-500')} />
        )}
        {step.status === 'active' && (
          <Loader2 className={cn(d.icon, 'animate-spin text-primary')} />
        )}
        {step.status === 'pending' && (
          <Circle className={cn(d.icon, 'text-muted-foreground/40')} />
        )}
        {step.status === 'error' && (
          <AlertCircle className={cn(d.icon, 'text-destructive')} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <p
            className={cn(
              d.label,
              'font-medium',
              step.status === 'pending' && 'text-muted-foreground/60',
              step.status === 'error' && 'text-destructive',
            )}>
            {step.label}
          </p>
          {step.status === 'done' && step.durationMs !== undefined && (
            <span className={cn(d.duration, 'text-muted-foreground/60')}>
              {formatDuration(step.durationMs)}
            </span>
          )}
        </div>

        {step.description && (
          <p className={cn(d.secondary, 'text-muted-foreground')}>
            {step.description}
          </p>
        )}

        {(step.detail || eta !== null) && (
          <p className={cn(d.secondary, 'text-muted-foreground/80 mt-0.5')}>
            {step.detail}
            {step.detail && eta !== null && <span className="mx-1.5">·</span>}
            {eta !== null && formatEta(eta)}
          </p>
        )}

        {step.status === 'active' && (
          <div className={d.barWrap}>
            {step.progress !== undefined ? (
              <Progress value={step.progress * 100} className={d.bar} />
            ) : (
              <div
                className={cn(
                  'relative w-full overflow-hidden rounded-full bg-primary/20',
                  d.bar,
                )}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}>
                <div className="absolute inset-y-0 w-1/4 animate-progress-indeterminate bg-primary" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
