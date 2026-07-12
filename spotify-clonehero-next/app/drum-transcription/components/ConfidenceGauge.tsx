'use client';

import {CheckCircle2, AlertTriangle, XCircle} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';
import type {SongConfidence} from '@/lib/drum-transcription/confidence-gauge';

interface ConfidenceGaugeProps {
  confidence: SongConfidence;
  /**
   * True when the chart's SyncTrack came from an existing chart the user
   * supplied (chart-flow path 3a), not a predicted tempo map. The tooltip
   * must then clarify the gauge reflects TRANSCRIPTION confidence only —
   * grid quality isn't being assessed at all, since the grid is the user's
   * own chart, not something this app predicted.
   */
  gridIsProvided: boolean;
  className?: string;
}

const BUCKET_STYLE: Record<
  SongConfidence['bucket'],
  {label: string; icon: typeof CheckCircle2; color: string}
> = {
  high: {label: 'High confidence', icon: CheckCircle2, color: 'text-green-500'},
  medium: {
    label: 'Medium confidence',
    icon: AlertTriangle,
    color: 'text-amber-500',
  },
  low: {label: 'Low confidence', icon: XCircle, color: 'text-red-500'},
};

/**
 * Simple per-song quality gauge (F63): a high/medium/low bucket derived from
 * two browser-computable features — fraction of low-confidence model frames
 * and predicted-tempo instability. See lib/drum-transcription/confidence-gauge.ts
 * for the feature definitions (ported from the ML repo's research) and the
 * bucket-cutoff rationale.
 */
export default function ConfidenceGauge({
  confidence,
  gridIsProvided,
  className,
}: ConfidenceGaugeProps) {
  const {label, icon: Icon, color} = BUCKET_STYLE[confidence.bucket];
  const fracLowPct = (confidence.fracLowConfidence * 100).toFixed(0);

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs cursor-default',
              className,
            )}>
            <Icon className={cn('h-3.5 w-3.5', color)} />
            <span className="font-medium">{label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs space-y-1">
          <p className="font-semibold">
            {gridIsProvided
              ? 'Transcription confidence only'
              : 'Transcription + grid confidence'}
          </p>
          {gridIsProvided && (
            <p className="text-muted-foreground">
              This chart&apos;s tempo map came from your own file, not a
              prediction — this gauge does not assess grid quality.
            </p>
          )}
          <p>
            {fracLowPct}% of placed notes had low model confidence
            {confidence.tempoInstability !== null && (
              <>
                ; predicted-tempo instability ={' '}
                {confidence.tempoInstability.toFixed(3)}
              </>
            )}
            .
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
