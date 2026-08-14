'use client';

import {type ReactNode, useCallback, useMemo, useState} from 'react';
import {Pencil} from 'lucide-react';
import {parseChartFile} from '@eliwhite/scan-chart';
import {
  applySongIniMetadata,
  computeTrackStamp,
  readSongIniMetadata,
  type SongIniMetadataValue,
} from '@/lib/chart-editor-core';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {DecodedOnsetsFile} from '@/lib/drum-transcription/ml/types';
import type {ChartFileFormat} from '@/lib/chart-files/chart-file-names';
import type {AudioSource, AssetFile} from './ExportDialog';

import EditorHeaderRow from './EditorHeaderRow';
import HighwayEditor from './HighwayEditor';
import TransportControls from './TransportControls';
import ExportDialog from './ExportDialog';
import SongMetadataDialog, {type AlbumArtSlot} from './SongMetadataDialog';
import LeftSidebar from './LeftSidebar';
import type {ChartAssistProps} from './sidebar/ChartAssist';
import type {StemsMixerHostProps} from './sidebar/StemsMixer';
import PianoRollTimeline from './piano-roll/PianoRollTimeline';
import EditorMCPTools from './EditorMCPTools';
import {useChartEditorContext} from './ChartEditorContext';
import {useEditorDensity} from './hooks/useEditorDensity';
import {useLoopRegionSync} from './hooks/useLoopRegionSync';
import type {AudioSamples} from './audioSamples';

type ParsedChart = ReturnType<typeof parseChartFile>;

interface Section {
  name: string;
  msTime: number;
}

export interface ChartEditorProps {
  /** Parsed chart data. */
  chart: ParsedChart;
  /** The AudioManager instance driving playback. */
  audioManager: AudioManager;
  /** Raw PCM audio data (Float32 interleaved) for waveform display. */
  audioData?: AudioSamples | undefined;
  /**
   * PCM used for the highway's waveform surface (e.g. an isolated drum
   * stem). Falls back to `audioData` when omitted; must share its channel
   * count and duration.
   */
  highwayAudioData?: AudioSamples | undefined;
  /** Number of audio channels (1 or 2). */
  audioChannels?: number | undefined;
  /**
   * The host is still decoding this project's audio. The editor is open and
   * editable throughout — this only lets the surfaces that draw the song say
   * so instead of looking empty.
   */
  audioLoading?: boolean | undefined;
  /**
   * PCM for the piano-roll lyrics row's background vocals waveform (plan
   * 0063 Round 2 §5, Float32 interleaved). Absent when the project has no
   * cached vocals stem — the row still works, just without the waveform.
   */
  lyricsWaveData?: AudioSamples | undefined;
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
   * Called after the user edits the chart's `song.ini` metadata via the header
   * dialog. When provided, the header song info becomes clickable to open that
   * editor.
   *
   * The chart document is already updated by the time this runs; what the host
   * owes is its own project record, which carries the same identity fields
   * under its own name. Everything else rides the document to the host's
   * autosave.
   */
  onMetadataChange?:
    | ((meta: SongIniMetadataValue) => void | Promise<void>)
    | undefined;
  /**
   * Hide the editor's built-in top bar (song info + Export). Pages that
   * already render their own header above the editor (e.g. add-lyrics)
   * should set this to true to avoid duplicated headings.
   */
  hideHeader?: boolean | undefined;
  /**
   * Extra content rendered in the top bar between the song info and the
   * Export button (e.g. a page's difficulty picker). Ignored when
   * `hideHeader` is set.
   */
  headerExtra?: ReactNode | undefined;
  /** Content rendered in the left sidebar panel (page-specific). */
  leftPanelChildren?: ReactNode | undefined;
  /**
   * Wiring for the sidebar's Chart Assist section (plan 0074 Phase 2). Each
   * card renders only when the data its action needs is here, so a page
   * supplies exactly the cards it can actually back:
   * `/drum-transcription` supplies all of it, `/tempo` only
   * `audioSampleRate`, and a bare editor supplies none and shows no section.
   */
  chartAssist?: ChartAssistProps | undefined;
  /**
   * Wiring for the sidebar's Stems mixer section (plan 0074 Phase 5):
   * per-stem origin (for the AI-separated badge), an add-a-stem callback for
   * hosts that can rebuild their padded AudioManager, and which track names
   * an assist run currently has locked. A page that supplies nothing still
   * gets a mixer (from `audioManager.trackNames` alone) whenever
   * `capabilities.showStemsMixer` is on.
   */
  stemsMixer?: StemsMixerHostProps | undefined;
  /** Callback to provide chart text for export. */
  getChartText?: (() => Promise<string>) | undefined;
  /** Format-agnostic alternative to `getChartText` — see ExportDialog's
   * `getChartFile` doc. Needed by pages whose chart may be `.mid`. */
  getChartFile?:
    | ((options: {
        format: ChartFileFormat;
      }) => Promise<{fileName: string; data: Uint8Array}>)
    | undefined;
  /** Callback to provide audio sources for export. */
  getAudioSources?:
    | ((options: {includeStems: boolean}) => Promise<AudioSource[]>)
    | undefined;
  /**
   * Callback to provide passthrough asset files (e.g. album art, video,
   * secondary audio) recovered from an existing chart package, so export can
   * round-trip them (chart-flow feature). Omitted by pages with none.
   */
  getExtraAssets?: (() => Promise<AssetFile[]>) | undefined;
  /** The Song Details dialog's album art slot: the art the chart ships now,
   * and how to store a change. Omitted by a host with nowhere to keep the
   * bytes, which hides the field. */
  albumArt?: AlbumArtSlot | undefined;
  /** Preselects the export dialog's package format (e.g. to match an
   * existing chart package's original format). */
  defaultExportFormat?: 'zip' | 'sng' | undefined;
  /** The format an imported source chart used — see ExportDialog's
   * `sourceChartFormat` doc. */
  sourceChartFormat?: ChartFileFormat | undefined;
  /** Shows the chart-file select without an imported source format to warn
   * against — see ExportDialog's `chartFormatSelectable` doc. */
  chartFormatSelectable?: boolean | undefined;
  /** Use the shared timeline with stacked, independently editable track rows. */
  stackedPianoRoll?: boolean | undefined;
}

/**
 * Composable chart editor shell with a Moonscraper-inspired layout.
 *
 * A named-areas CSS grid (`.chart-editor-grid` below) drives two responsive
 * arrangements of the same four regions (header / sidebar / main / bottom),
 * switched with a plain `@media` query — no JS measurement:
 *
 * Below 1440px — identical to the editor's original flex layout: header
 * spans the full width, the sidebar sits beside the highway in the middle
 * row only, and the piano roll spans full width beneath everything.
 * ┌──────────────────────────────────────────────────┐
 * │                     Header                        │
 * ├──────────┬─────────────────────────────────────────┤
 * │ Sidebar  │              Highway                   │
 * │          │           (3D, fills space)             │
 * ├──────────┴─────────────────────────────────────────┤
 * │  Piano-roll timeline (ruler / tempo lane / notes)  │
 * ├─────────────────────────────────────────────────────┤
 * │  ◀◀  ▶  ▶▶  ──●────── 1:23 / 4:56    [speed] ...   │
 * └─────────────────────────────────────────────────────┘
 *
 * At >=1440px — the sidebar becomes a full-height rail; header, highway, and
 * the piano roll/transport stack to its right.
 * ┌──────────┬─────────────────────────────────────────┐
 * │          │                  Header                  │
 * │ Sidebar  ├─────────────────────────────────────────┤
 * │ (full    │              Highway                   │
 * │  height) │           (3D, fills space)             │
 * │          ├─────────────────────────────────────────┤
 * │          │  Piano-roll timeline + transport        │
 * └──────────┴─────────────────────────────────────────┘
 */
/**
 * The header's song identity, on ONE line: title, artist and charter run
 * inline (the approved prototype's `header .title` + `header .sub`) rather
 * than stacking the charter on a second row, which is what let the header
 * stay a single slim bar.
 */
function SongIdentity({
  songName,
  artistName,
  charterName,
  children,
}: {
  songName: string;
  artistName?: string | undefined;
  charterName?: string | undefined;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <h1 className="text-sm font-semibold text-foreground truncate">
        {songName}
      </h1>
      <span className="text-xs text-muted-foreground truncate">
        {artistName && `by ${artistName}`}
        {artistName && charterName && ' · '}
        {charterName && `Charted by ${charterName}`}
      </span>
      {children}
    </div>
  );
}

export default function ChartEditor({
  chart,
  audioManager,
  audioData,
  highwayAudioData,
  audioChannels = 2,
  audioLoading,
  lyricsWaveData,
  lyricsWaveChannels,
  durationSeconds,
  decodedOnsets,
  sections,
  songName,
  artistName,
  charterName,
  onMetadataChange,
  hideHeader,
  headerExtra,
  leftPanelChildren,
  chartAssist,
  stemsMixer,
  getChartText,
  getChartFile,
  getAudioSources,
  getExtraAssets,
  albumArt,
  defaultExportFormat,
  sourceChartFormat,
  chartFormatSelectable,
  stackedPianoRoll = false,
}: ChartEditorProps) {
  const [metadataOpen, setMetadataOpen] = useState(false);
  const {state, dispatch} = useChartEditorContext();
  // Compact type/spacing scale for as long as an editor is on screen,
  // portalled Radix surfaces included (`hooks/useEditorDensity.ts`).
  useEditorDensity();
  // The A/B loop reaches playback from here, the one component every editor
  // host mounts, so the region is honoured on surfaces that render no loop
  // controls of their own.
  useLoopRegionSync(audioManager);

  // The song.ini fields the header dialog edits. The catalog, difficulty and
  // provenance halves are read straight off the live document, so a save is
  // visible everywhere at once; identity comes down from the host, which owns
  // the project record those three fields also name.
  const metadataValue = useMemo<SongIniMetadataValue>(
    () =>
      readSongIniMetadata(state.chartDoc, {
        name: songName,
        artist: artistName ?? '',
        charter: charterName ?? '',
      }),
    [state.chartDoc, songName, artistName, charterName],
  );

  // Staleness source for the drum difficulty recommendation: the Expert drums
  // track's content stamp, the same hash the Chart Assist cards compare.
  // Hashing every note is only worth doing while the dialog can show the
  // result — this component re-renders on every chart edit.
  const currentDrumStamp = useMemo(() => {
    if (!metadataOpen) return undefined;
    const track = chart.trackData.find(
      candidate =>
        candidate.instrument === 'drums' && candidate.difficulty === 'expert',
    );
    return track ? computeTrackStamp(track) : undefined;
  }, [chart, metadataOpen]);

  // The document is written here, through the one conversion every host
  // shares, so no host can persist a subset of what the dialog collected. The
  // host is left with only what it alone owns: its project record's identity.
  const handleMetadataSave = useCallback(
    async (next: SongIniMetadataValue) => {
      if (state.chartDoc) {
        dispatch({
          type: 'SET_CHART_METADATA',
          chartDoc: applySongIniMetadata(state.chartDoc, next),
        });
      }
      await onMetadataChange?.(next);
    },
    [dispatch, onMetadataChange, state.chartDoc],
  );

  const hasMultipleStackedTracks = useMemo(
    () =>
      chart.trackData.filter(track =>
        ['guitar', 'bass', 'drums'].includes(track.instrument),
      ).length > 1,
    [chart],
  );

  return (
    <div className="chart-editor-grid h-full w-full overflow-hidden bg-[var(--ed-surface)]">
      {/* `.chart-editor-grid` lives in `app/globals.css`: a named-areas grid
       *  switched with a plain `@media` query (no JS measurement). Only the
       *  container's `grid-template-areas`/`-columns` change between the two
       *  breakpoints — every child keeps a constant `grid-area` name. The
       *  `header` area holds this component's own 52px song-identity row,
       *  which sits directly beneath the site's compact header
       *  (`components/CompactSiteHeader.tsx`) - a separate row above the grid, not
       *  part of it. */}
      <EditorMCPTools />
      {/* Song info + export, this component's own header row. Pages that
       *  render their own row instead (e.g. add-lyrics) suppress this via
       *  `hideHeader`. */}
      {!hideHeader && (
        <EditorHeaderRow style={{gridArea: 'header'}}>
          {onMetadataChange ? (
            <button
              type="button"
              onClick={() => setMetadataOpen(true)}
              title="Edit song details"
              className="group min-w-0 mr-auto text-left rounded-sm -mx-1 px-1 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <SongIdentity
                songName={songName}
                artistName={artistName}
                charterName={charterName}>
                <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
              </SongIdentity>
            </button>
          ) : (
            <div className="min-w-0 mr-auto">
              <SongIdentity
                songName={songName}
                artistName={artistName}
                charterName={charterName}
              />
            </div>
          )}
          {headerExtra && (
            <div className="shrink-0 ml-4 flex items-center">{headerExtra}</div>
          )}
          {(state.chartDoc || getChartText || getChartFile) && (
            <div className="shrink-0 ml-4">
              <ExportDialog
                songName={songName}
                artistName={artistName}
                charterName={charterName}
                iniMetadata={state.chartDoc ? metadataValue : undefined}
                getChartText={getChartText}
                getChartFile={getChartFile}
                chartDoc={state.chartDoc ?? undefined}
                getAudioSources={getAudioSources}
                getExtraAssets={getExtraAssets}
                defaultFormat={defaultExportFormat}
                sourceChartFormat={sourceChartFormat}
                chartFormatSelectable={chartFormatSelectable}
              />
            </div>
          )}
        </EditorHeaderRow>
      )}

      {onMetadataChange && (
        <SongMetadataDialog
          open={metadataOpen}
          onOpenChange={setMetadataOpen}
          value={metadataValue}
          onSave={handleMetadataSave}
          chart={chart}
          currentDrumStamp={currentDrumStamp}
          albumArt={albumArt}
        />
      )}

      {/* Left sidebar — occupies only the middle row below 1440px (today's
       *  layout); becomes a full-height rail spanning all three rows at
       *  >=1440px. Same DOM node, same `grid-area: sidebar` in both modes —
       *  only the container's area map changes. */}
      <aside
        style={{gridArea: 'sidebar'}}
        className="flex min-h-0 overflow-hidden">
        <LeftSidebar
          audioManager={audioManager}
          leftPanelChildren={leftPanelChildren}
          chartAssist={chartAssist}
          stemsMixer={stemsMixer}
        />
      </aside>

      {/* Center: the highway. */}
      {/* A `section`, not a `main`: the root app layout already wraps every
       *  route in the page's single `main` landmark. */}
      {/* Flush against the sidebar (owner feedback, plan 0076 item 3: the
       *  highway area must touch its container, no left gutter). At >=1440px
       *  the sidebar is a full-height rail, so this keeps the `header`,
       *  `main` and `bottom` rows sharing one left edge against it. The
       *  shell's own outer padding (`SiteMain` in
       *  `components/SiteChrome.tsx`, `px-3` on editor routes) is what
       *  remains visible outside the grid. */}
      <section
        aria-label="Editing surface"
        style={{gridArea: 'main'}}
        className="flex min-w-0 min-h-0 overflow-hidden bg-background">
        <div className="relative flex-1 min-w-0 min-h-0">
          <HighwayEditor
            chart={chart}
            audioManager={audioManager}
            className="h-full w-full"
            audioData={highwayAudioData ?? audioData}
            audioLoading={audioLoading}
            audioChannels={audioChannels}
            durationSeconds={durationSeconds}
            stackedPianoRoll={stackedPianoRoll && hasMultipleStackedTracks}
          />
        </div>
      </section>

      {/* Bottom bar: transport + piano-roll timeline panel. The panel replaces
       *  both the old waveform strip and the right-side minimap; section
       *  navigation lives in the transport (skip buttons) and the panel's
       *  click-to-seek ruler flags. */}
      <div style={{gridArea: 'bottom'}} className="min-w-0">
        {/* Owner feedback (2026-08-03, light mode): the transport has the
         *  play button on it and sits between the highway and the piano
         *  roll, so it reads as the same dark editor-surface chrome those
         *  two already use in both themes - not `bg-background`, which
         *  flips to white in light mode. The `--ed-surface-*` tokens
         *  (`app/globals.css`) are theme-independent for exactly this
         *  reason: this repo's Tailwind `darkMode` is `media` (OS
         *  preference), so a `dark:` class would still go white under a
         *  light OS theme. */}
        <div className="border-t border-[color:var(--ed-surface-hover)] bg-[var(--ed-surface)] px-4 py-2.5 text-[color:var(--ed-surface-fg)]">
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
          stackedPianoRoll={stackedPianoRoll && hasMultipleStackedTracks}
          className="border-t border-[color:var(--ed-surface-hover)]"
        />
      </div>
    </div>
  );
}
