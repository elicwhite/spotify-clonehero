'use client';

import {useState} from 'react';
import {ArrowLeft, FolderSearch, Music} from 'lucide-react';
import {Button} from '@/components/ui/button';
import ChartDropZone from '@/components/chart-picker/ChartDropZone';
import type {LoadedFiles} from '@/components/chart-picker/chart-file-readers';
import AudioUploader from './AudioUploader';

interface SourcePickerProps {
  /** Called when the user selects an audio file for the audio-only path. */
  onFileSelected: (file: File) => void;
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
  onChartLoaded,
  chartFlowError,
  disabled,
}: SourcePickerProps) {
  const [mode, setMode] = useState<'audio' | 'chart' | null>(null);

  if (mode === null) {
    return (
      <div className="grid grid-cols-1 gap-3 w-full sm:grid-cols-2">
        <Button
          variant="outline"
          className="h-28 flex flex-col gap-2"
          onClick={() => setMode('audio')}>
          <Music className="h-6 w-6" />
          <span>Pick a song file</span>
          <span className="text-xs text-muted-foreground font-normal">
            mp3, wav, flac…
          </span>
        </Button>
        <Button
          variant="outline"
          className="h-28 flex flex-col gap-2"
          onClick={() => setMode('chart')}>
          <FolderSearch className="h-6 w-6" />
          <span>Use an existing chart</span>
          <span className="text-xs text-muted-foreground font-normal">
            chart folder, .sng, or .zip
          </span>
        </Button>
      </div>
    );
  }

  if (mode === 'audio') {
    return (
      <div className="w-full space-y-3">
        <p className="text-xs text-muted-foreground text-center">
          Grid source: <strong>predicted</strong>. The tempo map is estimated
          from the audio.
        </p>
        <AudioUploader onFileSelected={onFileSelected} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMode(null)}
          className="gap-1">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-3">
      <p className="text-xs text-muted-foreground text-center">
        Grid source: <strong>provided</strong>. Notes are snapped to this
        chart&apos;s own tempo map rather than a predicted one.
      </p>
      <ChartDropZone
        onLoaded={onChartLoaded}
        id="drum-transcription-chart"
        disabled={disabled ?? false}
      />
      {chartFlowError && (
        <p className="text-xs text-destructive text-center">{chartFlowError}</p>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setMode(null)}
        className="gap-1">
        <ArrowLeft className="h-4 w-4" />
        Back
      </Button>
    </div>
  );
}
