'use client';

import {CheckCircle2, Circle, Loader2, AlertCircle} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {Progress} from '@/components/ui/progress';
import {Button} from '@/components/ui/button';
import type {PipelineProgress, PipelineStep} from '@/lib/drum-transcription/pipeline/runner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProcessingViewProps {
  progress: PipelineProgress;
  onRetry?: () => void;
  onCancel?: () => void;
}

interface StepConfig {
  key: PipelineStep;
  label: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const PIPELINE_STEPS: StepConfig[] = [
  {
    key: 'loading-runtime',
    label: 'Loading ML Runtime',
    description: 'Loading ONNX Runtime and ML models',
  },
  {
    key: 'decoding',
    label: 'Decoding Audio',
    description: 'Converting to 44.1kHz stereo PCM',
  },
  {
    key: 'separating',
    label: 'Separating Stems',
    description: 'Running Demucs to isolate drum track (~161 MB model)',
  },
  {
    key: 'transcribing',
    label: 'Transcribing Drums',
    description: 'Detecting drum hits with ADTOF model',
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProcessingView({
  progress,
  onRetry,
  onCancel,
}: ProcessingViewProps) {
  const currentStepIndex = PIPELINE_STEPS.findIndex(
    (s) => s.key === progress.step,
  );

  // Error state
  if (progress.step === 'error') {
    return (
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle>Processing Failed</CardTitle>
          <CardDescription>
            {progress.error ?? 'An unexpected error occurred.'}
          </CardDescription>
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

  // Calculate overall progress (each step is ~33%)
  const overallPercent =
    currentStepIndex >= 0
      ? ((currentStepIndex + progress.progress) / PIPELINE_STEPS.length) * 100
      : 0;

  return (
    <Card className="w-full max-w-lg">
      <CardHeader className="text-center">
        <CardTitle>
          Processing{progress.projectName ? `: ${progress.projectName}` : ''}
        </CardTitle>
        <CardDescription>
          This may take a few minutes depending on the audio length.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Overall progress bar */}
        <div className="space-y-2">
          <Progress value={overallPercent} />
          <p className="text-xs text-center text-muted-foreground">
            {Math.round(overallPercent)}% complete
          </p>
        </div>

        {/* Step list */}
        <div className="space-y-4">
          {PIPELINE_STEPS.map((stepConfig, index) => {
            const isActive = index === currentStepIndex;
            const isComplete = index < currentStepIndex;
            const isPending = index > currentStepIndex;

            return (
              <StepIndicator
                key={stepConfig.key}
                label={stepConfig.label}
                description={stepConfig.description}
                isActive={isActive}
                isComplete={isComplete}
                isPending={isPending}
                progress={isActive ? progress.progress : undefined}
              />
            );
          })}
        </div>

        {/* Cancel button */}
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface StepIndicatorProps {
  label: string;
  description: string;
  isActive: boolean;
  isComplete: boolean;
  isPending: boolean;
  progress?: number;
}

function StepIndicator({
  label,
  description,
  isActive,
  isComplete,
  isPending,
  progress,
}: StepIndicatorProps) {
  return (
    <div className="flex items-start gap-3">
      {/* Status icon */}
      <div className="mt-0.5 shrink-0">
        {isComplete && (
          <CheckCircle2 className="h-5 w-5 text-green-500" />
        )}
        {isActive && (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        )}
        {isPending && (
          <Circle className="h-5 w-5 text-muted-foreground/40" />
        )}
      </div>

      {/* Label + progress */}
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm font-medium ${
            isPending ? 'text-muted-foreground/60' : ''
          }`}>
          {label}
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
        {isActive && progress !== undefined && (
          <div className="mt-1.5">
            <Progress value={progress * 100} className="h-1.5" />
          </div>
        )}
      </div>
    </div>
  );
}
