'use client';

import {useState} from 'react';
import {ArrowLeft, FolderOpen} from 'lucide-react';
import {Card, CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import ChartDropZone from '@/components/chart-picker/ChartDropZone';
import type {LoadedFiles} from '@/components/chart-picker/chart-file-readers';
import AudioUploader from './AudioUploader';

interface SourcePickerProps {
  /** Called when the user selects an audio file for the audio-only path. */
  onFileSelected: (file: File) => void;
  /** Called when the user clicks "Try Demo" (audio-only path). */
  onTryDemo: () => void;
  /** Called when the user drops/selects an existing chart package. */
  onChartLoaded: (loaded: LoadedFiles) => void;
  /** Error message from the last chart-package load attempt, if any. */
  chartFlowError: string | null;
  /** Disables the chart drop zone while a pipeline is running. */
  disabled?: boolean;
}

/**
 * Either/or entry point for the drum-transcription upload flow (chart-flow
 * feature): audio-only (existing create-new-chart behavior, unchanged) vs
 * an existing chart package, whose SyncTrack/audio drive transcription
 * instead of a predicted tempo map. Owns its own picker-mode state so the
 * parent page doesn't need to track which sub-flow is showing.
 */
export default function SourcePicker({
  onFileSelected,
  onTryDemo,
  onChartLoaded,
  chartFlowError,
  disabled,
}: SourcePickerProps) {
  const [mode, setMode] = useState<'audio' | 'chart' | null>(null);

  if (mode === null) {
    return (
      <Card className="w-full">
        <CardContent className="pt-6 flex flex-col items-center gap-3">
          <p className="text-sm text-muted-foreground text-center">
            Have a chart already? Reuse its tempo map instead of predicting one
            from scratch — this measurably improves note placement.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setMode('audio')}>
              Just a song (create a new chart)
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setMode('chart')}>
              <FolderOpen className="h-4 w-4 mr-2" />
              Use an existing chart
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (mode === 'audio') {
    return (
      <div className="w-full space-y-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMode(null)}
          className="gap-1">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          Grid source: <strong>predicted</strong> — the tempo map is estimated
          from the audio.
        </p>
        <AudioUploader onFileSelected={onFileSelected} onTryDemo={onTryDemo} />
      </div>
    );
  }

  return (
    <Card className="w-full">
      <CardContent className="pt-6 space-y-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMode(null)}
          className="gap-1">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          Grid source: <strong>provided</strong> — notes will be snapped to this
          chart&apos;s own tempo map, not a predicted one.
        </p>
        <ChartDropZone
          onLoaded={onChartLoaded}
          id="drum-transcription-chart"
          disabled={disabled ?? false}
        />
        {chartFlowError && (
          <p className="text-xs text-destructive text-center">
            {chartFlowError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
