'use client';

/**
 * Full-page shell for long-running pipelines.
 *
 * Used by /drum-transcription, /tempo, and /add-lyrics. Each runs an async
 * pipeline whose steps the user wants to watch:
 *
 *   pending → active → done | error
 *
 * This is the card + header + error layout around the shared step renderer
 * (`components/processing/StepRow.tsx`); `AssistRunCard` is the inline shell
 * around the same renderer. All step presentation rules live there, so the
 * two shells cannot drift.
 */

import {AlertCircle} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import StepRow, {type ProcessingStep} from '@/components/processing/StepRow';

export interface ProcessingViewProps {
  /** Card title, e.g. "Adding lyrics to your chart". */
  title: string;
  /** Optional second line in the header — typically the song title. */
  subtitle?: string | undefined;
  /** Optional caption under the subtitle. */
  description?: string | undefined;
  steps: ProcessingStep[];
  /** Top-level pipeline error message. Renders the error card layout. */
  error?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  /** Tailwind class overrides for the outer Card. */
  className?: string | undefined;
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
