'use client';

/**
 * Shared processing view for long-running pipelines.
 *
 * Used by /drum-transcription and /add-lyrics. Both pages run an async
 * pipeline whose steps the user wants to watch:
 *
 *   pending → active → done | error
 *
 * The view renders a card with a step list. Each active step optionally
 * shows an inner progress bar and a per-step time-remaining estimate;
 * when a step has no `progress` value the inner area renders a thin
 * indeterminate pulse so the user still sees motion.
 *
 * Design rules baked in:
 *   - No overall ETA across steps. Steps are weighted differently and a
 *     summed estimate would mislead. Each step shows its own ETA only
 *     when one exists and is meaningful.
 *   - ETA visibility gates: status==='active' && progress > 5% && eta > 5s.
 *     Below those thresholds the estimate is too noisy to show.
 *   - Light/dark: every color tokenized except text-green-500 for the
 *     done check (looks correct in both modes).
 */

import {AlertCircle, CheckCircle2, Circle, Loader2} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {Progress} from '@/components/ui/progress';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

export interface ProcessingStep {
  /** Stable id used as React key; not displayed. */
  key: string;
  /** Bold first line, e.g. "Separating vocal stem". */
  label: string;
  /** Optional muted second line under the label. */
  description?: string;
  status: 'pending' | 'active' | 'done' | 'error';
  /**
   * 0..1 progress within this step. If omitted on an active step the
   * inner bar renders as indeterminate.
   */
  progress?: number;
  /**
   * Seconds remaining for the active step. Only displayed when
   * status==='active' && progress > 0.05 && etaSeconds > 5.
   */
  etaSeconds?: number;
  /** Wall-clock duration once status==='done'. Rendered as " 1.4s ". */
  durationMs?: number;
  /** Dynamic detail line ("Separating segment 5/34"). Optional. */
  detail?: string;
}

export interface ProcessingViewProps {
  /** Card title, e.g. "Adding lyrics to your chart". */
  title: string;
  /** Optional second line in the header — typically the song title. */
  subtitle?: string;
  /** Optional caption under the subtitle. */
  description?: string;
  steps: ProcessingStep[];
  /** Top-level pipeline error message. Renders the error card layout. */
  error?: string | null;
  onRetry?: () => void;
  onCancel?: () => void;
  /** Tailwind class overrides for the outer Card. */
  className?: string;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s left`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds - mins * 60);
  return `${mins}m ${secs}s left`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function ProcessingView({
  title,
  subtitle,
  description,
  steps,
  error,
  onRetry,
  onCancel,
  className,
}: ProcessingViewProps) {
  if (error) {
    return (
      <Card className={cn('w-full max-w-lg', className)}>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle>Processing failed</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center gap-3">
          {onCancel && (
            <Button variant="outline" onClick={onCancel}>
              Back
            </Button>
          )}
          {onRetry && <Button onClick={onRetry}>Retry</Button>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('w-full max-w-lg', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle && (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        )}
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        {steps.map(step => (
          <StepRow key={step.key} step={step} />
        ))}
        {onCancel && (
          <div className="flex justify-center pt-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StepRow({step}: {step: ProcessingStep}) {
  const showEta =
    step.status === 'active' &&
    step.progress !== undefined &&
    step.progress > 0.05 &&
    step.etaSeconds !== undefined &&
    step.etaSeconds > 5;

  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0">
        {step.status === 'done' && (
          <CheckCircle2 className="h-5 w-5 text-green-500" />
        )}
        {step.status === 'active' && (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        )}
        {step.status === 'pending' && (
          <Circle className="h-5 w-5 text-muted-foreground/40" />
        )}
        {step.status === 'error' && (
          <AlertCircle className="h-5 w-5 text-destructive" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <p
            className={cn(
              'text-sm font-medium',
              step.status === 'pending' && 'text-muted-foreground/60',
              step.status === 'error' && 'text-destructive',
            )}>
            {step.label}
          </p>
          {step.status === 'done' && step.durationMs !== undefined && (
            <span className="text-xs text-muted-foreground/60">
              {formatDuration(step.durationMs)}
            </span>
          )}
        </div>

        {step.description && (
          <p className="text-xs text-muted-foreground">{step.description}</p>
        )}

        {(step.detail || showEta) && (
          <p className="text-xs text-muted-foreground/80 mt-0.5">
            {step.detail}
            {step.detail && showEta && <span className="mx-1.5">·</span>}
            {showEta && formatEta(step.etaSeconds!)}
          </p>
        )}

        {step.status === 'active' && (
          <div className="mt-1.5">
            {step.progress !== undefined ? (
              <Progress value={step.progress * 100} className="h-1.5" />
            ) : (
              <div
                className="relative h-1.5 w-full overflow-hidden rounded-full bg-primary/20"
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
