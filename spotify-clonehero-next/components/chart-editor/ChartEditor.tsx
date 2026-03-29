'use client';

import {type ReactNode, useMemo} from 'react';
import {parseChartFile} from '@eliwhite/scan-chart';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {AudioSource} from './ExportDialog';

import HighwayEditor from './HighwayEditor';
import TransportControls from './TransportControls';
import WaveformDisplay from './WaveformDisplay';
import LoopControls from './LoopControls';
import NoteInspector from './NoteInspector';
import ExportDialog from './ExportDialog';
import LeftSidebar from './LeftSidebar';
import TimelineMinimap from './TimelineMinimap';
import {useChartEditorContext} from './ChartEditorContext';
import {buildTimedTempos, tickToMs} from '@/lib/drum-transcription/timing';

type ParsedChart = ReturnType<typeof parseChartFile>;

interface Section {
  name: string;
  msTime: number;
}

export interface ChartEditorProps {
  /** Chart metadata for the highway renderer. */
  metadata: ChartResponseEncore;
  /** Parsed chart data. */
  chart: ParsedChart;
  /** The AudioManager instance driving playback. */
  audioManager: AudioManager;
  /** Raw PCM audio data (Float32 interleaved) for waveform display. */
  audioData?: Float32Array;
  /** Number of audio channels (1 or 2). */
  audioChannels?: number;
  /** Total song duration in seconds. */
  durationSeconds: number;
  /** Chart sections for section jumping in transport. */
  sections?: Section[];
  /** Song name for display. */
  songName: string;
  /** Artist name for display. */
  artistName?: string;
  /** Charter name for display. */
  charterName?: string;
  /** Whether the chart has unsaved changes. */
  dirty?: boolean;
  /** Content rendered in the left sidebar panel (page-specific). */
  leftPanelChildren?: ReactNode;
  /** Callback to provide chart text for export. */
  getChartText?: () => Promise<string>;
  /** Callback to provide audio sources for export. */
  getAudioSources?: () => Promise<AudioSource[]>;
  /** Callback when notes are modified (e.g. for marking reviewed). */
  onNotesModified?: (noteIds: string[]) => void;

  // -- Optional confidence/review overlays (passed through to HighwayEditor) --

  /** Confidence scores for notes, keyed by noteId (tick:type). */
  confidence?: Map<string, number>;
  /** Whether to show confidence overlays on the highway. */
  showConfidence?: boolean;
  /** Confidence threshold below which notes are flagged. */
  confidenceThreshold?: number;
  /** Set of note IDs that have been reviewed by the user. */
  reviewedNoteIds?: Set<string>;
}

/**
 * Composable chart editor shell with a Moonscraper-inspired layout.
 *
 * Layout:
 * ┌──────────┬──────────────────────────────┬──────────┐
 * │ Left     │                              │ Timeline │
 * │ Sidebar  │         Highway              │ Minimap  │
 * │          │         (3D, fills space)     │          │
 * │ Settings │                              │ Sections │
 * │ ──────── │                              │ labels   │
 * │ Tools    │                              │ with     │
 * │ ──────── │                              │ dots     │
 * │ Note     │                              │          │
 * │ Inspector│                              │ Position │
 * │ ──────── │                              │ handle   │
 * │ [page    │                              │          │
 * │  panels] │                              │ % + time │
 * ├──────────┴──────────────────────────────┴──────────┤
 * │  ◀◀  ▶  ▶▶  ──●────── 1:23 / 4:56    [speed] ... │
 * └───────────────────────────────────────────────────-┘
 */
export default function ChartEditor({
  metadata,
  chart,
  audioManager,
  audioData,
  audioChannels = 2,
  durationSeconds,
  sections,
  songName,
  artistName,
  charterName,
  dirty,
  leftPanelChildren,
  getChartText,
  getAudioSources,
  onNotesModified,
  confidence,
  showConfidence,
  confidenceThreshold,
  reviewedNoteIds,
}: ChartEditorProps) {
  const {state} = useChartEditorContext();

  // Compute section positions in ms for the timeline minimap
  const timelineSections = useMemo(() => {
    if (!state.chartDoc || !sections || sections.length === 0) {
      // Fall back to sections prop which already has msTime
      return (sections ?? []).map(s => ({name: s.name, timeMs: s.msTime}));
    }

    // If chartDoc has sections with tick data, compute ms from tempo map
    const chartSections = state.chartDoc.sections;
    if (chartSections && chartSections.length > 0) {
      const timedTempos = buildTimedTempos(
        state.chartDoc.tempos,
        state.chartDoc.chartTicksPerBeat,
      );
      const resolution = state.chartDoc.chartTicksPerBeat;
      return chartSections.map(s => ({
        name: s.name,
        timeMs: tickToMs(s.tick, timedTempos, resolution),
      }));
    }

    return (sections ?? []).map(s => ({name: s.name, timeMs: s.msTime}));
  }, [state.chartDoc, sections]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-black">
      {/* Top bar: song info + export */}
      <div className="shrink-0 flex items-center justify-between border-b bg-background px-4 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-foreground truncate">
              {songName}
            </h1>
            {artistName && (
              <span className="text-sm text-muted-foreground truncate">
                by {artistName}
              </span>
            )}
            {dirty && (
              <span className="text-[10px] text-amber-400 shrink-0">
                Unsaved
              </span>
            )}
          </div>
          {charterName && (
            <p className="text-xs text-muted-foreground truncate">
              Charted by {charterName}
            </p>
          )}
        </div>
        {getChartText && (
          <div className="shrink-0 ml-4">
            <ExportDialog
              songName={songName}
              artistName={artistName}
              getChartText={getChartText}
              getAudioSources={getAudioSources}
            />
          </div>
        )}
      </div>

      {/* Main area: three-column layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <LeftSidebar
          songName={songName}
          dirty={dirty}
          audioManager={audioManager}
          onNotesModified={onNotesModified}
          leftPanelChildren={leftPanelChildren}
        />

        {/* Center: Highway */}
        <div className="relative flex-1 min-w-0 min-h-0">
          <HighwayEditor
            metadata={metadata}
            chart={chart}
            audioManager={audioManager}
            className="h-full w-full"
            confidence={confidence}
            showConfidence={showConfidence}
            confidenceThreshold={confidenceThreshold}
            reviewedNoteIds={reviewedNoteIds}
            audioData={audioData}
            audioChannels={audioChannels}
            durationSeconds={durationSeconds}
          />
        </div>

        {/* Right sidebar: Timeline minimap */}
        <TimelineMinimap
          audioManager={audioManager}
          durationMs={durationSeconds * 1000}
          sections={timelineSections}
        />
      </div>

      {/* Bottom bar: transport + waveform */}
      <div className="shrink-0 border-t bg-background px-4 py-2.5">
        <TransportControls
          audioManager={audioManager}
          durationSeconds={durationSeconds}
          sections={sections}>
          {audioData && (
            <WaveformDisplay
              audioData={audioData}
              channels={audioChannels}
              audioManager={audioManager}
              durationSeconds={durationSeconds}
              className="flex-1 min-w-0"
            />
          )}
        </TransportControls>
      </div>
    </div>
  );
}
