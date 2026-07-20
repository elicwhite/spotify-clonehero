'use client';

import {type ReactNode, useMemo, useState} from 'react';
import {Pencil} from 'lucide-react';
import {parseChartFile} from '@eliwhite/scan-chart';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {DecodedOnsetsFile} from '@/lib/drum-transcription/ml/types';
import type {AudioSource, AssetFile} from './ExportDialog';

import HighwayEditor from './HighwayEditor';
import TransportControls from './TransportControls';
import ExportDialog from './ExportDialog';
import SongMetadataDialog from './SongMetadataDialog';
import LeftSidebar from './LeftSidebar';
import PianoRollTimeline from './piano-roll/PianoRollTimeline';
import EditorMCPTools from './EditorMCPTools';
import {useChartEditorContext} from './ChartEditorContext';
import SheetMusic from '@/app/sheet-music/[slug]/SheetMusic';

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
  audioData?: Float32Array | undefined;
  /**
   * PCM used for the highway's waveform surface (e.g. an isolated drum
   * stem). Falls back to `audioData` when omitted; must share its channel
   * count and duration.
   */
  highwayAudioData?: Float32Array | undefined;
  /** Number of audio channels (1 or 2). */
  audioChannels?: number | undefined;
  /**
   * PCM for the piano-roll lyrics row's background vocals waveform (plan
   * 0063 Round 2 §5, Float32 interleaved). Absent when the project has no
   * cached vocals stem — the row still works, just without the waveform.
   */
  lyricsWaveData?: Float32Array | undefined;
  /** Channel count for `lyricsWaveData`. */
  lyricsWaveChannels?: number | undefined;
  /** Total song duration in seconds. */
  durationSeconds: number;
  /**
   * The project's retained decoded onsets (plan 0061 §3a), passed through to
   * the piano-roll timeline's half/double structural-correction control
   * (0061 §7). Omit (or pass null) on a never-transcribed project — the
   * control then falls back to RESNAP with a disclosure. Loaded from OPFS by
   * the host page.
   */
  decodedOnsets?: DecodedOnsetsFile | null | undefined;
  /** Chart sections for section jumping in transport. */
  sections?: Section[] | undefined;
  /** Song name for display. */
  songName: string;
  /** Artist name for display. */
  artistName?: string | undefined;
  /** Charter name for display. */
  charterName?: string | undefined;
  /**
   * Called when the user edits song/artist/charter via the header dialog.
   * When provided, the header song info becomes clickable to open that editor.
   * The page is responsible for persisting the change.
   */
  onMetadataChange?:
    | ((meta: {
        name: string;
        artist: string;
        charter: string;
      }) => void | Promise<void>)
    | undefined;
  /** Whether the chart has unsaved changes. */
  dirty?: boolean | undefined;
  /**
   * Hide the editor's built-in top bar (song info + Export). Pages that
   * already render their own header above the editor (e.g. add-lyrics)
   * should set this to true to avoid duplicated headings.
   */
  hideHeader?: boolean | undefined;
  /**
   * Extra content rendered in the top bar between the song info and the
   * Export button (e.g. guitar-edit's difficulty picker). Ignored when
   * `hideHeader` is set.
   */
  headerExtra?: ReactNode | undefined;
  /** Content rendered in the left sidebar panel (page-specific). */
  leftPanelChildren?: ReactNode | undefined;
  /** Callback to provide chart text for export. */
  getChartText?: (() => Promise<string>) | undefined;
  /** Format-agnostic alternative to `getChartText` — see ExportDialog's
   * `getChartFile` doc. Needed by pages whose chart may be `.mid`. */
  getChartFile?:
    | (() => Promise<{fileName: string; data: Uint8Array}>)
    | undefined;
  /** Callback to provide audio sources for export. */
  getAudioSources?:
    | ((options: {includeStems: boolean}) => Promise<AudioSource[]>)
    | undefined;
  /**
   * Whether the export can bundle either separated stems or the original
   * audio. Enables the "Include stems?" toggle in the export dialog.
   */
  showStemChoice?: boolean | undefined;
  /**
   * Callback to provide passthrough asset files (e.g. album art, video,
   * secondary audio) recovered from an existing chart package, so export can
   * round-trip them (chart-flow feature). Omitted by pages with none.
   */
  getExtraAssets?: (() => Promise<AssetFile[]>) | undefined;
  /** Preselects the export dialog's package format (e.g. to match an
   * existing chart package's original format). */
  defaultExportFormat?: 'zip' | 'sng' | undefined;
}

/**
 * Composable chart editor shell with a Moonscraper-inspired layout.
 *
 * Layout:
 * ┌──────────┬───────────────────────────────────────┐
 * │ Left     │                                       │
 * │ Sidebar  │              Highway                  │
 * │          │           (3D, fills space)           │
 * │ Settings │                                       │
 * │ ──────── │                                       │
 * │ Tools    │                                       │
 * │ ──────── │                                       │
 * │ Note     │                                       │
 * │ Inspector│                                       │
 * │ ──────── ├───────────────────────────────────────┤
 * │ [page    │  Piano-roll timeline (ruler / tempo   │
 * │  panels] │  lane / note lanes / waveform row)    │
 * ├──────────┴───────────────────────────────────────┤
 * │  ◀◀  ▶  ▶▶  ──●────── 1:23 / 4:56    [speed] ...  │
 * └───────────────────────────────────────────────────┘
 */
export default function ChartEditor({
  metadata,
  chart,
  audioManager,
  audioData,
  highwayAudioData,
  audioChannels = 2,
  lyricsWaveData,
  lyricsWaveChannels,
  durationSeconds,
  decodedOnsets,
  sections,
  songName,
  artistName,
  charterName,
  onMetadataChange,
  dirty,
  hideHeader,
  headerExtra,
  leftPanelChildren,
  getChartText,
  getChartFile,
  getAudioSources,
  showStemChoice,
  getExtraAssets,
  defaultExportFormat,
}: ChartEditorProps) {
  const {state, dispatch} = useChartEditorContext();
  const [metadataOpen, setMetadataOpen] = useState(false);

  // Drums track for the optional sheet-music pane. Prefers the expert
  // difficulty (notation matches what the highway scope shows by default),
  // falling back to any charted drums difficulty.
  const sheetMusicTrack = useMemo(
    () =>
      chart.trackData.find(
        t => t.instrument === 'drums' && t.difficulty === 'expert',
      ) ??
      chart.trackData.find(t => t.instrument === 'drums') ??
      null,
    [chart],
  );

  // Lyrics for the sheet-music pane, same source /sheet-music uses.
  const sheetMusicLyrics = useMemo(
    () =>
      chart.vocalTracks?.parts['vocals']?.notePhrases.flatMap(p => p.lyrics) ??
      [],
    [chart],
  );

  const showSheetMusic = state.showSheetMusic && sheetMusicTrack !== null;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-black">
      <EditorMCPTools />
      {/* Top bar: song info + export. Pages with their own header (e.g.
       *  add-lyrics) suppress this via `hideHeader`. */}
      {!hideHeader && (
        <div className="shrink-0 flex items-center justify-between border-b bg-background px-4 py-2">
          {onMetadataChange ? (
            <button
              type="button"
              onClick={() => setMetadataOpen(true)}
              title="Edit song details"
              className="group min-w-0 text-left rounded-sm -mx-1 px-1 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold text-foreground truncate">
                  {songName}
                </h1>
                {artistName && (
                  <span className="text-sm text-muted-foreground truncate">
                    by {artistName}
                  </span>
                )}
                <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
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
            </button>
          ) : (
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
          )}
          {headerExtra && (
            <div className="shrink-0 ml-4 flex items-center">{headerExtra}</div>
          )}
          {(getChartText || getChartFile) && (
            <div className="shrink-0 ml-4">
              <ExportDialog
                songName={songName}
                artistName={artistName}
                charterName={charterName}
                getChartText={getChartText}
                getChartFile={getChartFile}
                getAudioSources={getAudioSources}
                showStemChoice={showStemChoice}
                getExtraAssets={getExtraAssets}
                defaultFormat={defaultExportFormat}
              />
            </div>
          )}
        </div>
      )}

      {onMetadataChange && (
        <SongMetadataDialog
          open={metadataOpen}
          onOpenChange={setMetadataOpen}
          value={{
            name: songName,
            artist: artistName ?? '',
            charter: charterName ?? '',
          }}
          onSave={onMetadataChange}
        />
      )}

      {/* Main area: three-column layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <LeftSidebar
          audioManager={audioManager}
          leftPanelChildren={leftPanelChildren}
        />

        {/* Center: optional sheet music pane + highway. The highway stays
         *  mounted when the notation pane opens — same split-pane pattern
         *  as /sheet-music's SongView, with the roles reversed. */}
        {showSheetMusic && sheetMusicTrack && (
          <div className="flex flex-1 min-w-0 min-h-0 p-2">
            <SheetMusic
              chart={chart}
              track={sheetMusicTrack}
              showBarNumbers={true}
              enableColors={false}
              showLyrics={true}
              lyrics={sheetMusicLyrics}
              zoom={state.zoom}
              onSelectMeasure={time => {
                audioManager.playChartTime(time);
                dispatch({type: 'SET_PLAYING', isPlaying: true});
              }}
              triggerRerender=""
              practiceModeConfig={null}
              onPracticeMeasureSelect={() => {}}
              selectionIndex={null}
              getChartTimeSec={() => audioManager.chartTime}
            />
          </div>
        )}
        <div className="relative flex-1 min-w-0 min-h-0">
          <HighwayEditor
            metadata={metadata}
            chart={chart}
            audioManager={audioManager}
            className="h-full w-full"
            audioData={highwayAudioData ?? audioData}
            audioChannels={audioChannels}
            durationSeconds={durationSeconds}
          />
        </div>
      </div>

      {/* Bottom bar: transport + piano-roll timeline panel. The panel replaces
       *  both the old waveform strip and the right-side minimap; section
       *  navigation lives in the transport (skip buttons) and the panel's
       *  click-to-seek ruler flags. */}
      <div className="shrink-0 border-t bg-background">
        <div className="px-4 py-2.5">
          <TransportControls
            audioManager={audioManager}
            durationSeconds={durationSeconds}
            sections={sections}
          />
        </div>
        <PianoRollTimeline
          audioManager={audioManager}
          durationSeconds={durationSeconds}
          audioData={highwayAudioData ?? audioData}
          audioChannels={audioChannels}
          lyricsWaveData={lyricsWaveData}
          lyricsWaveChannels={lyricsWaveChannels}
          decodedOnsets={decodedOnsets}
          className="border-t"
        />
      </div>
    </div>
  );
}
