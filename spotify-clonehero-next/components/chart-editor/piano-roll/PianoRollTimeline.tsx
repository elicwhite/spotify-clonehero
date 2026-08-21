'use client';

/**
 * Piano-roll timeline — bottom panel for the chart editor (plan 0062).
 *
 * A single DPR-aware canvas-2D panel that replaces the old `WaveformDisplay`
 * strip and the right-side `TimelineMinimap`. Bands, top→bottom: time ruler
 * (bar numbers + section flags), lyrics row (syllable chips + phrase bands,
 * present only on charts with vocals), tempo lane (tempo markers + TS chips),
 * schema-driven note lanes (drums keep their kick/pad layout; guitar/bass
 * show Open + five frets), source-selectable waveform row. The lyrics row sits
 * directly under the ruler (plan 0063 Round 2 §4) —
 * lyrics are ms-locked and never move under a tempo edit, so they read
 * naturally as a "caption track" above the tempo/note grid rather than mixed
 * into it.
 *
 * Timing authority is `AudioManager` (the same clock the highway reads). The
 * x-axis is real time (`x = (ms - leftMs) * pxPerMs`) so the waveform stays
 * fixed while the grid moves under tempo edits. Chart data (notes, tempos,
 * time signatures, sections, selection, hover) comes from `ChartEditorContext`
 * — the one store; the panel holds only view state (leftMs, pxPerMs, follow).
 *
 * Navigation (62-1): zoom (wheel), pan (shift+wheel / trackpad deltaX), scrub
 * (ruler + waveform), catch-up playhead follow, section-flag click-to-seek
 * and drag-to-move. The ruler's right-click menu (item 19, plan 0076) is the
 * section strip's only add/rename/delete affordance: "Add section here" at
 * the clicked (snapped) tick on empty space, "Rename section…"/"Delete
 * section" on an existing flag — mirrors `buildTempoMenu`'s hit-vs-empty
 * split and reuses the lyrics row's inline text-input overlay.
 *
 * Note editing (62-2): shared selection/hover, note drag (delta-snapped, lane
 * change single-note only, lane-locked multi-drag), left-drag marquee
 * box-select with shift semantics, click/drag placement, guitar/bass sustain
 * tails with snapped endpoint resize, articulation context-menu controls, and
 * erase parity with the active tool. Every edit dispatches the SAME command
 * the highway uses (`MoveEntitiesCommand`, `AddNoteCommand`, ...) through the
 * shared edit semantics in `../editing/` — the two views cannot construct
 * disagreeing edits.
 *
 * Tempo/downbeat editing (62-3): sparse ◆ markers are draggable (generous hit
 * radius, hover glow, `ew-resize` cursor, dashed ghost line, marker 0
 * immovable). A drag previews live through `pendingTempoCandidate` — the one
 * preview channel — and commits `MoveTempoMarkerCommand` on release, reading
 * the glue mode (KEEP-MS / KEEP-TICKS) from `ChartEditorContext`. The tempo
 * lane's right-click menu adds/deletes markers, rephases/marks downbeats, and
 * runs the half/double structural correction (×2 / ÷2, re-predict) via the
 * shared command layer (61-3 / 61-6 / 61-7); TS chips derive from the
 * persisted `timeSignatures` (real denominators). The glue mode is
 * audio-glued (KEEP-MS) and code-level only — settable via
 * SET_TEMPO_GLUE_MODE, with no visible toggle.
 *
 * Lyrics-row editing (0063 Round 2 §2/§3): a chip's hit box is its rendered
 * pill rect (measured text width, not a fixed window), and hovering a chip
 * (not just dragging one) shows the dashed ghost line at its tick so the
 * grab point is visible before a drag starts. Right-click opens one of three
 * menus depending on what's under the pointer — a chip ("Edit lyric…" /
 * "Delete lyric"), a phrase band's body ("Delete phrase" / "Add lyric…"), or
 * empty row space ("Add phrase here") — plus a waveform show/hide toggle on
 * all three. "Edit lyric…"/"Add lyric…" open a small positioned `<input>`
 * overlay (`InlineTextEditor`): Enter commits via `SetLyricTextCommand` /
 * `AddLyricCommand`, Escape cancels, blur commits (so the overlay never
 * lingers open). A phrase band's start/end edge is drag-resizable
 * (`ew-resize` cursor within `PHRASE_EDGE_HIT_RADIUS` px), reusing the
 * `phrase-start`/`phrase-end` entity kinds through `MoveEntitiesCommand` —
 * the same command the highway's own marker drag issues. An optional vocals
 * stem waveform (§5) renders faint behind the bands/chips, sourced from the
 * `lyricsWaveData`/`lyricsWaveChannels` props (absent on legacy projects
 * with no cached vocals stem — the row still works, just without it).
 */

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {AudioManager} from '@/lib/preview/audioManager';
import {cn} from '@/lib/utils';
import {
  buildTimedTempos,
  msToTick,
  tickToMs,
} from '@/lib/drum-transcription/timing';
import {
  snapTickToGrid,
  findTrackInParsedChart,
  synctrackFromChart,
  audioExtendedEndTick,
  lyricId,
  parsePhraseId,
  phraseStartId,
  phraseEndId,
  phraseTranslationBounds,
  DEFAULT_VOCALS_PART,
  getAudioAnchor,
  schemaForTrack,
  fullLaneRange,
  laneToType as schemaLaneToType,
  drums4LaneSchema,
  planDownbeatAt,
  planTimeSignatureMove,
} from '@/lib/chart-edit';
import type {
  ChartDocument,
  DownbeatPlan,
  InstrumentSchema,
  TrackKey,
} from '@/lib/chart-edit';
import type {Synctrack} from '@/lib/tempo-map/types';
import {octaveRescaleSync} from '@/lib/tempo-map/structural-correction';
import {
  repredictTempo,
  shiftOnsets,
} from '@/lib/drum-transcription/pipeline/repredict';
import type {DecodedOnsetsFile} from '@/lib/drum-transcription/ml/types';
import {useChartEditorContext} from '../ChartEditorContext';
import ContextMenuPopover, {
  useDismissOnOutsidePointerDown,
  type ContextMenuItem,
} from '../ContextMenuPopover';
import {getSelectedIds, selectRenderDoc} from '@/lib/chart-editor-core';
import {
  entityContextFromScope,
  isTrackScope,
  localNoteIdsForTrack,
  trackKeyId,
  trackQualifiedNoteId,
  trackKeyFromScope,
} from '../scope';
import {availableTrackKeys} from '@/lib/chart-editor-core/trackInventory';
import {toast} from 'sonner';
import {useExecuteCommand} from '../hooks/useEditCommands';
import {
  AddBPMCommand,
  AddNoteCommand,
  AddTempoMarkerCommand,
  BatchCommand,
  DeleteNotesCommand,
  DeleteTempoMarkerCommand,
  MoveEntitiesCommand,
  MovePhrasesCommand,
  MoveTempoMarkerCommand,
  CommitTempoCandidateCommand,
  RephaseDownbeatsCommand,
  ToggleFlagCommand,
  SetNoteTechniqueCommand,
  ResizeNotesCommand,
  PlaceDownbeatCommand,
  MoveTimeSignatureCommand,
  RemoveTimeSignatureCommand,
  AddLyricCommand,
  DeleteLyricCommand,
  SetLyricTextCommand,
  AddPhraseCommand,
  DeletePhraseCommand,
  AddSectionCommand,
  DeleteSectionCommand,
  RenameSectionCommand,
  type EditCommand,
} from '../commands';
import {
  computeNoteDragDelta,
  exceedsDragThreshold,
  selectionLaneSpan,
} from '../editing/gestures';
import {
  MARQUEE_KINDS,
  bandsTouched,
  computeMarqueeSelection,
  emptyMarqueeSelection,
  type MarqueeKind,
  type MarqueeSelection,
  type PanelBands,
} from '../editing/marquee';
import {
  prospectiveNoteAt,
  type ProspectiveNote,
} from '../editing/prospectiveNote';
import {
  clampMarkerMs,
  hitTempoMarker,
  hitTsChip,
  nearestBeatTick,
  TS_CHIP_H,
  TS_CHIP_TOP,
} from './tempoHitTest';
import {
  extractPianoRollNotes,
  isGuitarBassSchema,
  techniqueForFlags,
  lanesForSchema,
  type FretTechnique,
  type PianoRollNote,
} from './notes';
import {buildBeatGrid, barBeatAtTick} from './scene';
import {measureTextWidth} from './textWidth';
import BpmValuePopover from './BpmValuePopover';
import TapTempoPopover from './TapTempoPopover';
import {useSetClickSuppressed} from '../AudioServiceContext';
import {
  laneAtY,
  marqueeBounds,
  pickNoteAt,
  pickNotePartAt,
  pickLyricChipAt,
  pickPhraseEdgeAt,
  pickPhraseBandAt,
  phraseEdgeDragBounds,
  xToTickNoSnap,
  type LaneGeometry,
  type NotePartHit,
} from './hitTest';
import {buildLyricsRowScene, fullySelectedPhraseTicks} from './lyricsScene';
import {
  edgeScrollDeltaPx,
  fitToWidth,
  followLeftMs,
  msToX,
  panByPx,
  xToMs,
  zoomAt,
  zoomBounds,
  type PianoRollView,
} from './viewMath';
import {
  MAX_PANEL_HEIGHT,
  MIN_PANEL_HEIGHT,
  clampPanelHeight,
  loadPanelHeight,
  savePanelHeight,
} from './panelHeight';
import {buildAmpPyramidYielding, type AmpPyramid} from './wavePeaks';
import {resolveEscapeTier} from './escapeRouting';
import {
  isInsideLoopShade,
  loopEndRegionAt,
  loopStartRegionAt,
  moveLoopEdge,
  pickLoopFlagAt,
} from './loopFlags';
import {
  buildWaveformSources,
  defaultWaveformSourceId,
  type WaveformSource,
} from './waveformSources';

import {
  COLORS,
  LYRICS_ROW_H,
  OVERLAY_COLORS,
  RULER_H,
  STACKED_GUTTER_W,
  STACKED_LANE_H,
  STACKED_ROW_HEADER_H,
  TEMPO_H,
  WAVE_ROW_H,
  lyricsRowHeight,
  type ChartScene,
  type LoopDrag,
  type LyricDrag,
  type PanelNoteDrag,
  type PanelNoteResize,
  type PanelPlaceNote,
  type PhraseEdgeDrag,
  type SectionDrag,
  type SectionFlag,
  type TempoMarker,
  type TempoMarkerDrag,
  type TimeSignatureDrag,
  type TrackRowGeometry,
  type TrackRowScene,
  type TsChip,
  visiblePianoRollRows,
} from './sceneTypes';
import {
  drawGrid,
  drawLaneLabels,
  drawLyricsRow,
  drawNotes,
  drawRuler,
  drawStackedGutter,
  drawTempoLane,
  drawWave,
} from './draw';
import type {AudioSamples} from '../audioSamples';

/** Half-width (px) of a note's pointer hit box around its glyph center. */
const NOTE_HIT_HALF_WIDTH = 8;

/**
 * The track a marquee started outside the note lanes reports as its scope.
 * A tempo-lane or lyrics-row drag can still reach the note lanes, so it
 * needs a track to qualify any note ids it sweeps up; the active scope's
 * track is that track, with the scene's own fallbacks behind it.
 */
/** Tick set from selection ids that are plain `String(tick)` (tempo
 *  markers, signature chips, section flags). */
function tickSetFromIds(ids: ReadonlySet<string>): ReadonlySet<number> {
  const out = new Set<number>();
  for (const id of ids) {
    const tick = Number.parseInt(id, 10);
    if (Number.isFinite(tick)) out.add(tick);
  }
  return out;
}

/** Shared "no ticks" set, so a drag that carries no whole phrase doesn't
 *  allocate one per pointer-down. */
const EMPTY_TICKS: ReadonlySet<number> = new Set<number>();

/** Tick set from `partName:tick` phrase-edge selection ids. */
function phraseTickSet(ids: ReadonlySet<string>): ReadonlySet<number> {
  const out = new Set<number>();
  for (const id of ids) {
    const parsed = parsePhraseId(id);
    if (parsed) out.add(parsed.tick);
  }
  return out;
}

function marqueeFallbackTrackKey(scene: ChartScene): TrackKey {
  return (
    scene.activeTrackKey ??
    scene.rows[0]?.key ?? {instrument: 'drums', difficulty: 'expert'}
  );
}

/**
 * True while a class-(b) structural tempo correction (re-predict / resnap) is
 * previewed through `pendingTempoCandidate` — the read-only accept/reject
 * contract (0061 §7 / 0062 finding). Note-editing gestures are gated in this
 * state because the panel hit-tests the candidate doc while commands target the
 * committed doc. A class-(a) marker drag's transient candidate is NOT gated
 * here (it holds the pointer, so no note edit can start under it anyway).
 */
function isStructuralPreview(state: {
  pendingTempoCandidate: {op: string} | null;
}): boolean {
  const op = state.pendingTempoCandidate?.op;
  return op === 're-predict' || op === 'resnap';
}

/**
 * In-flight marquee rectangle in canvas px.
 *
 * The marquee is a WHOLE-PANEL gesture: it selects every selectable entity
 * whose region intersects the rectangle, across every band the rectangle
 * covers (note lanes, tempo lane, lyrics row, and the ruler's section flags
 * when the drag reaches up into it). Dragging entirely within one band is
 * therefore how a selection is narrowed to that band's entities, with no
 * modifier key.
 */
interface PanelMarquee {
  trackKey: TrackKey;
  /**
   * True when the drag started inside a stacked track row. Such a marquee
   * is clamped to that row and only ever selects its notes — the stacked
   * layout's rows are independent tracks, so a rectangle must not leak
   * across them. A marquee started in a shared band (tempo lane, lyrics
   * row) is never row-scoped.
   */
  rowScoped: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type PointerMode =
  | 'idle'
  | 'scrub'
  | 'place-drag'
  | 'drag'
  | 'marquee'
  | 'erase'
  | 'tempo'
  | 'timesig'
  | 'section'
  | 'loop'
  | 'lyric'
  | 'phrase-edge'
  | 'resize';

/** One entry in a right-click context menu (§10). */
type MenuItem = ContextMenuItem;

/** What an open popover shows: the usual action list, or one of the tempo
 *  lane's entry tools (tap tempo, typed BPM), which replace the list in place
 *  so they keep the right-click's position.
 *
 *  `clientX`/`clientY` are viewport coordinates of the gesture: both tools are
 *  taller than an action list and the panel is a short `overflow-hidden` box,
 *  so they anchor in the viewport instead of inside the panel, which would
 *  clip them. */
type MenuContent =
  | {kind: 'items'; items: MenuItem[]}
  | {
      kind: 'tap';
      anchorTick: number;
      anchorMs: number;
      anchorLabel: string;
      clientX: number;
      clientY: number;
    }
  | {
      kind: 'bpm';
      /** Tick of the existing marker being retyped. */
      anchorTick: number;
      anchorLabel: string;
      /** The marker's current BPM, which the field starts at. */
      initialBpm: number;
      clientX: number;
      clientY: number;
    };

/** Open context-menu state (note lane or tempo lane, §7/§8/§10).
 *  `x`/`y` are canvas-local, matching the popover's `absolute` anchor. */
interface MenuState {
  x: number;
  y: number;
  content: MenuContent;
}

/** Inline text editor overlay state: a small positioned `<input>` rendered
 *  over the canvas, whose `onCommit` runs a command with the input's final
 *  text. Generic over any positioned text-commit flow — the lyrics row's
 *  "Edit lyric…"/"Add lyric…" (Round 2 §2) and the section strip's
 *  rename/add (plan 0076 item 19) all go through it. */
interface InlineTextEditor {
  /** Canvas-space position (px) to anchor the input at. */
  x: number;
  y: number;
  initialText: string;
  onCommit: (text: string) => void;
}

interface StackedNoteHit {
  row: TrackRowGeometry;
  scene: ChartScene;
  note: PianoRollNote;
  part: NotePartHit | null;
}

function stackedRowGeometry(
  scene: ChartScene,
  laneTop: number,
): {rows: TrackRowGeometry[]; height: number} {
  let cursor = laneTop;
  const rows = scene.rows.map(row => {
    const rowHeight =
      STACKED_ROW_HEADER_H + Math.max(1, row.lanes.length) * STACKED_LANE_H;
    const geometry: TrackRowGeometry = {
      row,
      top: cursor,
      laneTop: cursor + STACKED_ROW_HEADER_H,
      bottom: cursor + rowHeight,
      laneH: STACKED_LANE_H,
    };
    cursor += rowHeight;
    return geometry;
  });
  return {rows, height: cursor - laneTop};
}

function sceneForTrackRow(scene: ChartScene, row: TrackRowScene): ChartScene {
  return {
    ...scene,
    notes: row.notes,
    lanes: row.lanes,
    schema: row.schema,
    activeTrackKey: row.key,
  };
}

/** Contexts, so a draw does not re-fetch one every frame. */
const panelContexts = new WeakMap<
  HTMLCanvasElement,
  CanvasRenderingContext2D
>();

/**
 * The 2D context for one of the panel's canvases.
 *
 * Cached: `draw` and the three band copies each fetched one per frame.
 *
 * (Declaring these canvases opaque with `{alpha: false}` measured as no
 * change at all — the copies are bound by pixel throughput, not blending —
 * so they keep the alpha channel rather than take the `clearRect`-paints-black
 * behaviour for nothing.)
 */
function panelContext(
  canvas: HTMLCanvasElement,
): CanvasRenderingContext2D | null {
  const cached = panelContexts.get(canvas);
  if (cached) return cached;
  const ctx = canvas.getContext('2d');
  if (ctx) panelContexts.set(canvas, ctx);
  return ctx;
}

/**
 * Copy one horizontal band out of the offscreen canvas into the sticky canvas
 * that shows it.
 *
 * `band`, when given, narrows the copy to a sub-range of the region — the
 * rows band is taller than its scroll viewport, and `draw` only paints the
 * part of it that is near the viewport, so copying the whole thing moves
 * megapixels a frame that nothing painted and nobody can see. Whatever the
 * destination already holds outside `band` is left alone: it is off screen by
 * construction, and a scroll repaints before it is not.
 */
function copyCanvasRegion(
  source: HTMLCanvasElement,
  destination: HTMLCanvasElement,
  sourceY: number,
  height: number,
  band?: {top: number; bottom: number},
): void {
  const dpr = window.devicePixelRatio || 1;
  const width = source.width / dpr;
  if (width <= 0 || height <= 0) return;
  const pixelHeight = Math.max(1, Math.round(height * dpr));
  const resized =
    destination.width !== source.width || destination.height !== pixelHeight;
  if (destination.width !== source.width) destination.width = source.width;
  if (destination.height !== pixelHeight) destination.height = pixelHeight;
  if (destination.style.width !== `${width}px`)
    destination.style.width = `${width}px`;
  if (destination.style.height !== `${height}px`)
    destination.style.height = `${height}px`;
  const ctx = panelContext(destination);
  if (!ctx) return;

  // A resize blanks the canvas, so the narrowed copy would leave the rest of
  // it empty rather than holding the previous frame — take the whole band.
  const localTop =
    band && !resized ? Math.max(0, Math.min(height, band.top - sourceY)) : 0;
  const localBottom =
    band && !resized
      ? Math.max(0, Math.min(height, band.bottom - sourceY))
      : height;
  const localHeight = localBottom - localTop;
  if (localHeight <= 0) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, localTop, width, localHeight);
  ctx.drawImage(
    source,
    0,
    Math.round((sourceY + localTop) * dpr),
    source.width,
    Math.round(localHeight * dpr),
    0,
    localTop,
    width,
    localHeight,
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PianoRollTimelineProps {
  audioManager: AudioManager;
  /** Total song duration in seconds. */
  durationSeconds: number;
  /** Drum-stem PCM for the waveform row (Float32 interleaved). */
  audioData?: AudioSamples | undefined;
  /** Number of audio channels (1 or 2). */
  audioChannels?: number | undefined;
  /**
   * Viewport fraction the playhead pins at while following (§3). Default 20%.
   * Code-level configuration only (per QA round-1: the user-facing anchor
   * dropdown was removed); a host page may still override it via this prop.
   */
  followAnchor?: number | undefined;
  /**
   * The project's retained decoded onsets (plan 0061 §3a), for the half/double
   * structural-correction op's RE-PREDICT (0061 §7). `null`/absent → a
   * never-transcribed project, so the control falls back to bounded RESNAP with
   * a disclosure. Loaded from OPFS by the host page.
   */
  decodedOnsets?: DecodedOnsetsFile | null | undefined;
  /** Vocals-stem PCM for the lyrics row's background waveform (plan 0063
   *  Round 2 §5, Float32 interleaved). Absent on legacy projects with no
   *  cached vocals stem — the row still works, just without the waveform. */
  lyricsWaveData?: AudioSamples | undefined;
  /** Channel count for `lyricsWaveData`. */
  lyricsWaveChannels?: number | undefined;
  /** Render all supported instrument/difficulty lanes in one shared canvas. */
  stackedPianoRoll?: boolean | undefined;
  className?: string | undefined;
}

export default function PianoRollTimeline({
  audioManager,
  durationSeconds,
  audioData,
  audioChannels = 2,
  followAnchor = 0.2,
  decodedOnsets,
  lyricsWaveData,
  lyricsWaveChannels = 2,
  stackedPianoRoll = false,
  className,
}: PianoRollTimelineProps) {
  const {state, dispatch, capabilities} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();
  const chartDoc = state.chartDoc;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stackedTopCanvasRef = useRef<HTMLCanvasElement>(null);
  const stackedRowsCanvasRef = useRef<HTMLCanvasElement>(null);
  /** The rows band's scroll viewport. Only the slice of the stacked rows
   *  inside it is on screen, so only those rows are painted. */
  const rowsScrollRef = useRef<HTMLDivElement>(null);
  /** That viewport's scroll offset and height, cached. Reading them off the
   *  element inside `draw` forces a style/layout flush on every frame; they
   *  only change on scroll or resize, both of which write here. */
  const rowsViewRef = useRef({top: 0, height: 0});
  const stackedWaveCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** The popover subtree, which the container's wheel listener must not eat:
   *  a clipped context menu scrolls itself. */
  const overlayRef = useRef<HTMLDivElement>(null);

  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  /** Open an action-list popover, or nothing when there is nothing to offer. */
  const openItemsMenu = useCallback(
    (x: number, y: number, items: MenuItem[]) =>
      setMenu(items.length ? {x, y, content: {kind: 'items', items}} : null),
    [],
  );
  // A tap session holds up to minutes of work and a BPM field holds a
  // half-typed number, so neither is dismissed by a stray pointerdown the way
  // an action list is: Escape and Cancel close them.
  const closeUnlessEntering = useCallback(
    () => setMenu(open => (open?.content.kind === 'items' ? null : open)),
    [],
  );
  const tapMenu = menu?.content.kind === 'tap' ? menu.content : null;
  const bpmMenu = menu?.content.kind === 'bpm' ? menu.content : null;
  /** Whichever entry tool is up, for the popover's shared viewport anchoring. */
  const entryMenu = tapMenu ?? bpmMenu;

  // -- Inline text editor: the lyrics row's "Edit lyric…"/"Add lyric…" and
  // the section strip's rename/add all open a small positioned <input> over
  // the canvas rather than a modal — consistent with the rest of the panel's
  // lightweight canvas+DOM overlays (the context menu itself, the
  // waveform-source chip).
  const [inlineTextEditor, setInlineTextEditor] =
    useState<InlineTextEditor | null>(null);
  // Escape sets `inlineTextEditor` to null, which unmounts the (focused) <input>;
  // some browsers enqueue a `blur` for a removed focused element, which
  // would otherwise re-run `onCommit` right after the cancel. This flag
  // makes Escape's cancel win.
  const inlineTextEditorCancelledRef = useRef(false);

  // -- Vocals-stem waveform toggle (Round 2 §5): plain view state, not
  // persisted (no project id reaches the panel — same rationale as the
  // waveform-source selection below).
  const [showVocalsWave, setShowVocalsWave] = useState(true);
  // `draw` is a `useCallback` with an empty dep array (it reads everything
  // else through refs) — mirror the state into a ref so it sees toggles
  // without needing to be redefined (and re-threaded through every caller)
  // on every flip.
  const showVocalsWaveRef = useRef(showVocalsWave);
  useEffect(() => {
    showVocalsWaveRef.current = showVocalsWave;
    dirtyRef.current = true;
    drawRef.current(Math.max(0, audioManager.chartTime * 1000));
  }, [showVocalsWave, audioManager]);

  // -- Waveform source (§11, QA round-1 change 4): which of the project's audio
  // sources the waveform row draws. The list comes from `AudioManager` (the
  // runtime owner of the stems); selection is panel view-state (session-only —
  // no project id reaches the panel, so nothing is persisted to localStorage).
  const [waveSources, setWaveSources] = useState<WaveformSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  /** The manager `selectedSourceId` was resolved against. Until it names the
   *  live one, the selection still describes the previous manager's tracks —
   *  and rebuilding the peaks against it would scan the whole song for a
   *  source that is about to be replaced. */
  const [sourcesManager, setSourcesManager] = useState<AudioManager | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(audioManager.ready).then(() => {
      if (cancelled) return;
      const list = buildWaveformSources(audioManager.trackNames ?? []);
      setWaveSources(list);
      setSelectedSourceId(prev =>
        prev && list.some(s => s.id === prev)
          ? prev
          : defaultWaveformSourceId(list),
      );
      setSourcesManager(audioManager);
    });
    return () => {
      cancelled = true;
    };
  }, [audioManager]);
  // PCM + channel count for the selected source, always asked of the
  // AudioManager by name: it is the one thing that knows which bytes a track
  // name maps to. `audioData` is only the fallback for a manager that can't
  // answer (no `getTrackPcm`, or a name it doesn't carry) — it is whatever
  // single buffer the host happens to hold, which is not necessarily the
  // selected source or even the default one.
  const wavePcm = useMemo<{
    data: Float32Array | undefined;
    channels: number;
  } | null>(() => {
    // Null while the source list is still catching up with a manager swap:
    // the peaks below cost a pass over every sample in the song, and the
    // answer would be thrown away a tick later.
    if (sourcesManager !== audioManager) return null;
    if (selectedSourceId) {
      const pcm = audioManager.getTrackPcm?.(selectedSourceId);
      if (pcm) return pcm;
    }
    return {data: audioData?.data, channels: audioChannels};
  }, [
    selectedSourceId,
    sourcesManager,
    audioData,
    audioChannels,
    audioManager,
  ]);

  // -- Panel height (§1): resizable via a top-edge drag handle, persisted to
  // localStorage under one key shared across every host page. Lazily read
  // once on mount (not during SSR — `loadPanelHeight` falls back to the
  // default when there's no `window`).
  // Tap tempo holds the click silent while a session is open; the mixer is
  // what applies it, so this only publishes the intent.
  const setClickSuppressed = useSetClickSuppressed();

  const [panelHeight, setPanelHeight] = useState(() => loadPanelHeight());

  const viewRef = useRef<
    PianoRollView & {follow: boolean; initialized: boolean}
  >({leftMs: 0, pxPerMs: 0.075, follow: true, initialized: false});
  const sceneRef = useRef<ChartScene | null>(null);
  const stackedPianoRollRef = useRef(stackedPianoRoll);
  stackedPianoRollRef.current = stackedPianoRoll;
  const contentHeightRef = useRef(0);
  const ampRef = useRef<AmpPyramid>({levels: [], durationMs: 0});
  /** Vocals-stem waveform mip-map for the lyrics row (Round 2 §5) — built
   *  from `lyricsWaveData`, empty when the prop is absent. */
  const vocalsAmpRef = useRef<AmpPyramid>({levels: [], durationMs: 0});
  const selectionRef = useRef<ReadonlySet<string>>(new Set());
  const hoverIdRef = useRef<string | null>(null);
  /** Lyric-kind mirrors of `selectionRef`/`hoverIdRef` (plan 0063 Part D) —
   *  kept separate so a note-lane and a lyrics-row highlight never bleed
   *  into each other's draw pass. */
  const lyricSelectionRef = useRef<ReadonlySet<string>>(new Set());
  const lyricHoverIdRef = useRef<string | null>(null);
  /** Tick-keyed selection mirrors for the entities the draw layer paints by
   *  tick rather than by entity id: the tempo lane's markers and signature
   *  chips, the ruler's section flags, and the lyrics row's phrase edges.
   *  All of them can be swept up by the panel marquee. */
  const tempoSelectionRef = useRef<ReadonlySet<number>>(new Set());
  const tsSelectionRef = useRef<ReadonlySet<number>>(new Set());
  const sectionSelectionRef = useRef<ReadonlySet<number>>(new Set());
  const phraseStartSelectionRef = useRef<ReadonlySet<number>>(new Set());
  const phraseEndSelectionRef = useRef<ReadonlySet<number>>(new Set());
  /** Per-chip measured pill width (px), populated each frame by
   *  `drawLyricsRow` (`ctx.measureText`) — hit-testing (`pickLyricChipAt`)
   *  reads the SAME widths the pill was actually painted at (Round 2 §3). */
  const lyricChipWidthsRef = useRef<Map<string, number>>(new Map());
  const followAnchorRef = useRef(followAnchor);
  const scrubbingRef = useRef(false);
  const prevPlayingRef = useRef(false);
  const lastPlayheadRef = useRef(-1);
  const dirtyRef = useRef(true);
  const drawRef = useRef<(playheadMs: number) => void>(() => {});
  /**
   * Pointer x (viewport px) of the in-flight scrub, or null. The frame loop
   * reads it to auto-scroll while the pointer rests at a viewport edge: a
   * held pointer sends NO further move events, so the pan has to come from
   * the loop, not from `handlePointerMove`.
   */
  const scrubPointerXRef = useRef<number | null>(null);
  /** `performance.now()` of the last edge-scroll step (frame delta source). */
  const scrubEdgeTsRef = useRef(0);
  const seekToRef = useRef<(ms: number) => void>(() => {});

  // -- Note-editing interaction state (refs: no re-render per pointer move) --
  const pointerModeRef = useRef<PointerMode>('idle');
  const pointerStartRef = useRef<{x: number; y: number} | null>(null);
  const noteDragRef = useRef<PanelNoteDrag | null>(null);
  const noteResizeRef = useRef<PanelNoteResize | null>(null);
  const placeNoteRef = useRef<PanelPlaceNote | null>(null);
  const marqueeRef = useRef<PanelMarquee | null>(null);
  /** Index of the tempo marker under the pointer (idle hover), or -1. */
  const hoverMarkerRef = useRef(-1);
  /**
   * Add-mode ghost: the note a click would place at the pointer's lane +
   * snapped tick (null when not in add-mode / not over an empty lane / a
   * structural preview locks editing). Rendered at ~50% opacity in the draw
   * pass. A ref (not state) so pointer-move updates never re-render React.
   */
  const ghostRef = useRef<ProspectiveNote | null>(null);
  /** In-flight tempo-marker drag (§7); null when not dragging a marker. */
  const tempoDragRef = useRef<TempoMarkerDrag | null>(null);
  /** The committed doc a live tempo drag previews from (captured at grab). */
  const tempoBaseDocRef = useRef<ChartDocument | null>(null);
  /** In-flight time-signature-chip drag; null when not dragging a chip. */
  const tsDragRef = useRef<TimeSignatureDrag | null>(null);
  /** Measured label width per signature tick, recorded by `drawTempoLane` so
   *  `hitTsChip` tests the pill that was actually painted. */
  const tsChipWidthsRef = useRef<Map<number, number>>(new Map());
  /** Tick of the signature chip under the pointer (idle hover), or null. */
  const tsHoverTickRef = useRef<number | null>(null);
  /** In-flight section-flag drag (§6); null when not dragging a section. */
  const sectionDragRef = useRef<SectionDrag | null>(null);
  /** In-flight A/B loop-flag drag; null when no flag is being dragged. */
  const loopDragRef = useRef<LoopDrag | null>(null);
  /** In-flight lyric-chip drag (plan 0063 Part D §2); null when idle. */
  const lyricDragRef = useRef<LyricDrag | null>(null);
  /** In-flight phrase-edge (band start/end) drag (Round 2 §2); null when idle. */
  const phraseEdgeDragRef = useRef<PhraseEdgeDrag | null>(null);
  /** Per-kind selection captured at marquee start, for shift-add merging.
   *  Empty for a plain (unshifted) drag, which replaces the selection. */
  const marqueeBaseRef = useRef<MarqueeSelection>(emptyMarqueeSelection());
  const marqueeShiftRef = useRef(false);
  /** Panel-height resize drag: the height + pointer y at gesture start. */
  const resizeDragRef = useRef<{startHeight: number; startY: number} | null>(
    null,
  );
  /** Latest state pieces the pointer handlers read without re-subscribing. */
  const editStateRef = useRef(state);
  editStateRef.current = state;
  /** Latest `capabilities.showPianoRollNotes`, read by `draw()`/`panelGeometry()`
   *  (both empty-dep `useCallback`s) so they never need to be redefined. */
  const showPianoRollNotesRef = useRef(capabilities.showPianoRollNotes);
  showPianoRollNotesRef.current = capabilities.showPianoRollNotes;
  /** Latest `previewOctave` (defined below, after `executeCommand`/`dispatch`
   *  are in scope) — the tempo-lane context menu (built earlier in the file)
   *  reads through this ref rather than depending on the function directly,
   *  so its `useCallback` doesn't need to be declared after it. */
  const previewOctaveRef = useRef<(factor: number) => void>(() => {});

  // While a tempo gesture is in flight, both views render from the candidate
  // doc instead of the committed one (0061 §7 — the one preview channel). The
  // shared `selectRenderDoc` selector is the single source of this choice, so
  // the panel and the highway can never disagree about what's drawn.
  const effectiveDoc = selectRenderDoc(state);

  // -- Tempo/beat cache (perf pass: "beat-ms cache invalidation") ------------
  // `buildTimedTempos` + `buildBeatGrid` are the expensive, O(song-length)
  // computations here (a full beat walk over the whole chart). A pure note
  // edit is by far the most frequent edit on a long chart, and
  // `cloneDocFor('note', doc)` (every note command's clone) never touches
  // `tempos`/`timeSignatures`/`resolution` — those arrays keep the *same
  // reference* across a note-only edit. Memoizing on those references (not
  // on `effectiveDoc` identity) means adding/moving/deleting a note never
  // re-walks the beat grid; only an actual tempo/TS/duration change does.
  const parsedTempos = effectiveDoc?.parsedChart.tempos;
  const parsedTimeSignatures = effectiveDoc?.parsedChart.timeSignatures;
  const resolution = effectiveDoc?.parsedChart.resolution;
  const tempoCache = useMemo(() => {
    if (!parsedTempos || !parsedTimeSignatures || resolution === undefined) {
      return null;
    }
    const timedTempos = buildTimedTempos(parsedTempos, resolution);
    const durationMs = durationSeconds * 1000;
    const maxTempoTick = parsedTempos.reduce((m, t) => Math.max(m, t.tick), 0);
    const maxTsTick = parsedTimeSignatures.reduce(
      (m, t) => Math.max(m, t.tick),
      0,
    );
    const tickAtDuration =
      durationMs > 0
        ? msToTick(durationMs, timedTempos, resolution, 'ceil')
        : 0;
    // One shared definition of the audio-extended beat span (task 61-6a's
    // module): the downbeat commands snap within this SAME span, so a tail
    // beat offered in the menu resolves to the same beat when the command runs.
    const endTick = audioExtendedEndTick(
      Math.max(maxTempoTick, maxTsTick),
      tickAtDuration,
      resolution,
    );
    const beats = buildBeatGrid(
      parsedTimeSignatures,
      resolution,
      endTick,
      timedTempos,
    );
    const tempos: TempoMarker[] = parsedTempos.map(t => ({
      tick: t.tick,
      ms: tickToMs(t.tick, timedTempos, resolution),
      bpm: t.beatsPerMinute,
    }));
    const timeSignatures: TsChip[] = parsedTimeSignatures.map(ts => ({
      tick: ts.tick,
      ms: tickToMs(ts.tick, timedTempos, resolution),
      label: `${ts.numerator}/${ts.denominator}`,
    }));
    return {
      resolution,
      timedTempos,
      beats,
      tempos,
      timeSignatures,
      durationMs,
      endTick,
    };
  }, [parsedTempos, parsedTimeSignatures, resolution, durationSeconds]);

  // -- Derived scene from the (possibly previewed) chart doc ------------------
  // Cheap relative to `tempoCache`: note extraction + small section/total-ms
  // bookkeeping. This *does* re-run on every note edit (it must — the notes
  // changed) but no longer re-walks the beat grid to do it.
  const scene = useMemo<ChartScene | null>(() => {
    if (!effectiveDoc || !tempoCache) return null;
    const parsed = effectiveDoc.parsedChart;
    const {
      resolution,
      timedTempos,
      beats,
      tempos,
      timeSignatures,
      durationMs,
      endTick,
    } = tempoCache;

    // `showPianoRollNotes: false` (e.g. /tempo) hides note lanes and the
    // lyrics row entirely — the piano roll shows only the tempo grid,
    // ruler, and sections.
    const activeTrackKey =
      capabilities.showPianoRollNotes && isTrackScope(state.activeScope)
        ? state.activeScope.track
        : null;
    // Every chartable track, regardless of Chart Matrix visibility — the
    // gutter's "manage tracks" menu (`openStackedViewMenu`) needs the full
    // set so a hidden track can still be checked back on from the piano
    // roll, not just unchecked.
    const allTrackRows: TrackRowScene[] = capabilities.showPianoRollNotes
      ? availableTrackKeys(parsed.trackData).flatMap(key => {
          const track = findTrackInParsedChart(parsed, key)?.track ?? null;
          const schema = track ? schemaForTrack(track, parsed.drumType) : null;
          if (!track || !schema) return [];
          return [
            {
              key,
              schema,
              lanes: lanesForSchema(schema),
              notes: extractPianoRollNotes(track, schema),
            },
          ];
        })
      : [];
    // The stacked layout's row list only ever names tracks the user has
    // selected in the Chart Matrix (`state.visibleTrackKeys`); a hidden track
    // gets no row at all.
    const rows: TrackRowScene[] = visiblePianoRollRows(
      allTrackRows,
      state.visibleTrackKeys,
    );
    const activeRow = activeTrackKey
      ? (rows.find(row => trackKeyId(row.key) === trackKeyId(activeTrackKey)) ??
        null)
      : null;
    const schema: InstrumentSchema | null = activeRow?.schema ?? null;
    const lanes = activeRow?.lanes ?? [];
    const notes = activeRow?.notes ?? [];
    const maxNoteTick = rows.reduce(
      (max, row) =>
        row.notes.reduce(
          (rowMax, note) =>
            Math.max(
              rowMax,
              note.tick +
                (isGuitarBassSchema(row.schema) ? (note.length ?? 0) : 0),
            ),
          max,
        ),
      0,
    );

    const sections: SectionFlag[] = parsed.sections.map(s => ({
      tick: s.tick,
      ms: tickToMs(s.tick, timedTempos, resolution),
      name: s.name,
    }));

    const {chips: lyricChips, bands: lyricBands} =
      capabilities.showPianoRollNotes
        ? buildLyricsRowScene(parsed.vocalTracks, timedTempos, resolution)
        : {chips: [], bands: []};

    const withMs = (list: {ms: number}[]) =>
      list.reduce((m, x) => Math.max(m, x.ms), 0);
    const lastBeatMs = beats.length ? beats[beats.length - 1].ms : 0;
    const totalMs = Math.max(
      durationMs,
      lastBeatMs,
      withMs(sections),
      maxNoteTick > 0 ? tickToMs(maxNoteTick, timedTempos, resolution) : 0,
    );

    return {
      resolution,
      timedTempos,
      beats,
      tempos,
      timeSignatures,
      sections,
      notes,
      rows,
      allTrackKeys: allTrackRows.map(row => row.key),
      activeTrackKey,
      lanes,
      schema,
      totalMs,
      durationMs,
      endTick,
      lyricChips,
      lyricBands,
      lyricsVisible: lyricBands.length > 0,
    };
  }, [
    tempoCache,
    effectiveDoc,
    state.activeScope,
    state.visibleTrackKeys,
    capabilities.showPianoRollNotes,
  ]);

  useEffect(() => {
    sceneRef.current = scene;
    dirtyRef.current = true;
  }, [scene]);

  // -- Waveform peak mip-map (only rebuilt when the audio changes; perf pass —
  // "peaks per zoom bucket" §11, not a single fixed-resolution envelope) -----
  useEffect(() => {
    // No source resolved yet — leave the peaks that are already drawn alone
    // rather than blanking the row for a frame.
    if (!wavePcm) return;
    let cancelled = false;
    void (async () => {
      const pyramid = await buildAmpPyramidYielding(
        wavePcm.data,
        wavePcm.channels,
        durationSeconds * 1000,
        () => cancelled,
      );
      if (!pyramid) return;
      ampRef.current = pyramid;
      dirtyRef.current = true;
      drawRef.current(Math.max(0, audioManager.chartTime * 1000));
    })();
    return () => {
      cancelled = true;
    };
  }, [wavePcm, durationSeconds, audioManager]);

  // -- Vocals-stem waveform mip-map for the lyrics row (Round 2 §5). Reuses
  // the same peak-pyramid machinery as the bottom waveform row; empty when
  // `lyricsWaveData` is absent (legacy projects with no cached vocals stem).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pyramid = await buildAmpPyramidYielding(
        lyricsWaveData?.data,
        lyricsWaveChannels,
        durationSeconds * 1000,
        () => cancelled,
      );
      if (!pyramid) return;
      vocalsAmpRef.current = pyramid;
      dirtyRef.current = true;
      drawRef.current(Math.max(0, audioManager.chartTime * 1000));
    })();
    return () => {
      cancelled = true;
    };
  }, [lyricsWaveData, lyricsWaveChannels, durationSeconds, audioManager]);

  // -- Selection push (shared with the highway) ------------------------------
  useEffect(() => {
    selectionRef.current = getSelectedIds(state, 'note');
    lyricSelectionRef.current = getSelectedIds(state, 'lyric');
    tempoSelectionRef.current = tickSetFromIds(getSelectedIds(state, 'tempo'));
    tsSelectionRef.current = tickSetFromIds(getSelectedIds(state, 'timesig'));
    sectionSelectionRef.current = tickSetFromIds(
      getSelectedIds(state, 'section'),
    );
    phraseStartSelectionRef.current = phraseTickSet(
      getSelectedIds(state, 'phrase-start'),
    );
    phraseEndSelectionRef.current = phraseTickSet(
      getSelectedIds(state, 'phrase-end'),
    );
    dirtyRef.current = true;
  }, [state]);

  // -- A/B loop push: the ruler's loop band/flags read `state.loopRegion`
  // through `editStateRef`, so a change made anywhere else (the transport's
  // A/B buttons) needs an explicit repaint. While paused the panel is in its
  // low-rate idle poll, so draw immediately rather than waiting for it.
  useEffect(() => {
    dirtyRef.current = true;
    drawRef.current(Math.max(0, audioManager.chartTime * 1000));
  }, [state.loopRegion, audioManager]);

  // -- Hover push (shared with the highway; note + lyric kinds) --------------
  useEffect(() => {
    hoverIdRef.current =
      state.hovered?.kind === 'note' ? state.hovered.id : null;
    lyricHoverIdRef.current =
      state.hovered?.kind === 'lyric' ? state.hovered.id : null;
    dirtyRef.current = true;
  }, [state.hovered]);

  // Tear down the add-mode ghost the instant the tool changes away from
  // add-note or a structural preview locks editing — both happen without a
  // pointer move, so the pointer-move clear path wouldn't fire.
  useEffect(() => {
    const locked = isStructuralPreview({
      pendingTempoCandidate: state.pendingTempoCandidate,
    });
    if (state.activeTool === 'place' && !locked) return;
    if (ghostRef.current) {
      ghostRef.current = null;
      dirtyRef.current = true;
      drawRef.current(Math.max(0, audioManager.chartTime * 1000));
    }
  }, [state.activeTool, state.pendingTempoCandidate, audioManager]);

  // Redraw immediately when the shared cursor moves from OUTSIDE this panel —
  // e.g. wheel-scrubbing the highway, which seeks `AudioManager` in continuous
  // ms and dispatches `SET_CURSOR_TICK` per wheel event. While paused the panel
  // is in its low-rate idle poll (IDLE_POLL_MS), so without this the playhead
  // would only catch up ~8x/sec and read as stepped even though the seek target
  // is continuous. The panel's own scrub seeks without dispatching the cursor,
  // so it never double-handles here. We draw at the live `chartTime` (which
  // `seekToChartTime` updates synchronously), never at the grid-rounded cursor.
  useEffect(() => {
    if (audioManager.isPlaying) return;
    lastPlayheadRef.current = -1;
    dirtyRef.current = true;
    drawRef.current(Math.max(0, audioManager.chartTime * 1000));
  }, [state.cursorTick, audioManager]);

  // Keep the follow-anchor ref in sync with the (code-level) prop.
  useEffect(() => {
    followAnchorRef.current = followAnchor;
  }, [followAnchor]);

  // -- Draw ------------------------------------------------------------------
  const draw = useCallback((playheadMs: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = panelContext(canvas);
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    if (w <= 0 || h <= 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const view = viewRef.current;
    const scene = sceneRef.current;
    const selection = selectionRef.current;
    // The original timeline remains the only renderer. In stacked mode only
    // the note-lane band changes: the ruler, lyrics, tempo lane and waveform
    // are still drawn once, with every row using the original drawNotes path.
    const showNotes = showPianoRollNotesRef.current;
    const stacked =
      showNotes && stackedPianoRollRef.current && (scene?.rows.length ?? 0) > 1;
    const timelineW = stacked ? Math.max(1, w - STACKED_GUTTER_W) : w;
    const lyricsTop = RULER_H;
    const lyricsH = lyricsRowHeight(scene);
    const tempoTop = lyricsTop + lyricsH;
    const laneTop = tempoTop + TEMPO_H;
    const rowLayout =
      stacked && scene ? stackedRowGeometry(scene, laneTop) : null;
    const laneBottom = rowLayout ? laneTop + rowLayout.height : h - WAVE_ROW_H;
    // Stacked rows are taller than the band that shows them, and the band
    // scrolls. Painting a row nobody can see costs a full pass over its notes,
    // so rows outside the scrolled slice are skipped.
    //
    // A screenful either side is painted anyway. The band scrolls on the
    // compositor and `handleRowsScroll` only runs once the main thread gets
    // the event, so a frame can be composited at a scroll offset this draw
    // never saw — with no margin that frame shows empty lanes. The margin is
    // how far a fast scroll can outrun the repaint before anything unpainted
    // comes into view.
    const rowsView = rowsViewRef.current;
    const rowsBanded = rowLayout !== null && rowsView.height > 0;
    const rowsSliceTop = rowsBanded ? laneTop + rowsView.top : laneTop;
    const rowsPaintTop = rowsBanded ? rowsSliceTop - rowsView.height : laneTop;
    const rowsPaintBottom = rowsBanded
      ? rowsSliceTop + rowsView.height * 2
      : laneBottom;
    const rowOnScreen = (row: TrackRowGeometry): boolean =>
      row.bottom >= rowsPaintTop && row.top <= rowsPaintBottom;
    const laneCount = Math.max(1, scene?.lanes.length ?? 1);
    const laneH = (laneBottom - laneTop) / laneCount;

    ctx.fillStyle = COLORS.chrome;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    if (stacked) ctx.translate(STACKED_GUTTER_W, 0);

    if (showNotes) {
      if (rowLayout && scene) {
        for (const row of rowLayout.rows) {
          if (!rowOnScreen(row)) continue;
          for (let lane = 0; lane < row.row.lanes.length; lane++) {
            ctx.fillStyle = lane % 2 ? COLORS.laneAlt : COLORS.laneBg;
            ctx.fillRect(
              0,
              row.laneTop + lane * row.laneH,
              timelineW,
              row.laneH,
            );
          }
          ctx.fillStyle = COLORS.tempoBg;
          ctx.fillRect(0, row.top, timelineW, STACKED_ROW_HEADER_H);
        }
      } else {
        for (let l = 0; l < laneCount; l++) {
          ctx.fillStyle = l % 2 ? COLORS.laneAlt : COLORS.laneBg;
          ctx.fillRect(0, laneTop + l * laneH, timelineW, laneH);
        }
      }
    }

    if (scene) {
      drawGrid(ctx, timelineW, h, laneTop, laneBottom, view, scene);
      if (showNotes) {
        if (rowLayout) {
          for (const row of rowLayout.rows) {
            if (!rowOnScreen(row)) continue;
            const rowScene = sceneForTrackRow(scene, row.row);
            const rowSelection = new Set(
              localNoteIdsForTrack(selection, row.row.key),
            );
            const rowHover = hoverIdRef.current
              ? (localNoteIdsForTrack([hoverIdRef.current], row.row.key)[0] ??
                null)
              : null;
            const rowDrag =
              noteDragRef.current &&
              trackKeyId(noteDragRef.current.trackKey) ===
                trackKeyId(row.row.key)
                ? noteDragRef.current
                : null;
            const rowResize =
              noteResizeRef.current &&
              trackKeyId(noteResizeRef.current.trackKey) ===
                trackKeyId(row.row.key)
                ? noteResizeRef.current
                : null;
            const rowPlace =
              placeNoteRef.current &&
              trackKeyId(placeNoteRef.current.trackKey) ===
                trackKeyId(row.row.key)
                ? placeNoteRef.current
                : null;
            const rowGhost = rowPlace ? ghostRef.current : null;
            drawNotes(
              ctx,
              timelineW,
              row.laneTop,
              row.laneH,
              view,
              rowScene,
              rowSelection,
              rowHover,
              rowDrag,
              rowResize,
              rowPlace,
              rowGhost,
            );
            ctx.strokeStyle = COLORS.gridBeat;
            ctx.beginPath();
            ctx.moveTo(0, row.bottom + 0.5);
            ctx.lineTo(timelineW, row.bottom + 0.5);
            ctx.stroke();
          }
        } else {
          // Single-track mode draws local `tick:type` ids, so the shared
          // track-qualified selection/hover is translated to the active
          // track at the boundary — ids owned by another track drop out.
          const activeKey = scene.activeTrackKey;
          drawNotes(
            ctx,
            timelineW,
            laneTop,
            laneH,
            view,
            scene,
            activeKey
              ? new Set(localNoteIdsForTrack(selection, activeKey))
              : new Set<string>(),
            activeKey && hoverIdRef.current
              ? (localNoteIdsForTrack([hoverIdRef.current], activeKey)[0] ??
                  null)
              : null,
            noteDragRef.current,
            noteResizeRef.current,
            placeNoteRef.current,
            ghostRef.current,
          );
        }
      }
      drawTempoLane(
        ctx,
        timelineW,
        view,
        scene,
        hoverMarkerRef.current,
        tempoDragRef.current,
        tempoTop,
        tsChipWidthsRef.current,
        tsDragRef.current,
        tsHoverTickRef.current,
        tempoSelectionRef.current,
        tsSelectionRef.current,
      );
      if (scene.lyricsVisible) {
        const drag = lyricDragRef.current;
        const hoveredChip = !drag
          ? scene.lyricChips.find(c => c.id === lyricHoverIdRef.current)
          : undefined;
        const ghostTick = drag?.moved
          ? drag.originalTick
          : (hoveredChip?.tick ?? null);
        const noteDrag = noteDragRef.current;
        const noteDragTickDelta =
          noteDrag?.active === true ? noteDrag.tickDelta : null;
        drawLyricsRow(
          ctx,
          timelineW,
          view,
          scene,
          lyricsTop,
          lyricsH,
          lyricSelectionRef.current,
          lyricHoverIdRef.current,
          drag,
          ghostTick,
          lyricChipWidthsRef.current,
          showVocalsWaveRef.current ? vocalsAmpRef.current : null,
          phraseEdgeDragRef.current,
          phraseStartSelectionRef.current,
          phraseEndSelectionRef.current,
          noteDragTickDelta,
        );
      }
      drawRuler(
        ctx,
        timelineW,
        view,
        scene,
        laneBottom,
        sectionDragRef.current,
        // A live flag drag previews from its own region so the band tracks
        // the pointer without a dispatch per pointer-move.
        loopDragRef.current?.region ?? editStateRef.current.loopRegion,
        sectionSelectionRef.current,
      );

      const tempoDrag = tempoDragRef.current;
      if (tempoDrag) {
        const gx = Math.round(msToX(tempoDrag.origMs, view)) + 0.5;
        ctx.strokeStyle = COLORS.ghost;
        ctx.setLineDash([4, 4]);
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(gx, RULER_H);
        ctx.lineTo(gx, laneBottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    ctx.fillStyle = COLORS.rulerBg;
    ctx.fillRect(0, laneBottom, timelineW, WAVE_ROW_H);
    ctx.strokeStyle = COLORS.gridBeat;
    ctx.beginPath();
    ctx.moveTo(0, laneBottom + 0.5);
    ctx.lineTo(timelineW, laneBottom + 0.5);
    ctx.stroke();
    if (scene)
      drawWave(ctx, timelineW, laneBottom + 3, h - 3, view, ampRef.current);

    if (showNotes && scene && !rowLayout)
      drawLaneLabels(ctx, laneTop, laneH, scene.lanes);

    const marquee = marqueeRef.current;
    if (marquee) {
      const mx = Math.min(marquee.x0, marquee.x1);
      const my = Math.min(marquee.y0, marquee.y1);
      const mw = Math.abs(marquee.x1 - marquee.x0);
      const mh = Math.abs(marquee.y1 - marquee.y0);
      ctx.fillStyle = OVERLAY_COLORS.marqueeFill;
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeStyle = OVERLAY_COLORS.marqueeStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(mx + 0.5, my + 0.5, mw, mh);
    }

    const px = msToX(playheadMs, view);
    if (px >= -2 && px <= timelineW + 2) {
      ctx.strokeStyle = COLORS.playhead;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
      ctx.fillStyle = COLORS.playhead;
      ctx.beginPath();
      ctx.moveTo(px - 5, 0);
      ctx.lineTo(px + 5, 0);
      ctx.lineTo(px, 7);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 1;
    }
    ctx.restore();

    if (rowLayout && scene) {
      drawStackedGutter(ctx, STACKED_GUTTER_W, rowLayout.rows, h);
      const topCanvas = stackedTopCanvasRef.current;
      const rowsCanvas = stackedRowsCanvasRef.current;
      const waveCanvas = stackedWaveCanvasRef.current;
      if (topCanvas && rowsCanvas && waveCanvas) {
        copyCanvasRegion(canvas, topCanvas, 0, laneTop);
        copyCanvasRegion(
          canvas,
          rowsCanvas,
          laneTop,
          laneBottom - laneTop,
          rowsBanded ? {top: rowsPaintTop, bottom: rowsPaintBottom} : undefined,
        );
        copyCanvasRegion(canvas, waveCanvas, laneBottom, WAVE_ROW_H);
      }
    }
  }, []);

  drawRef.current = draw;

  const contentHeightForScene = useCallback(
    (currentScene: ChartScene | null) => {
      const container = containerRef.current;
      const viewportHeight =
        container?.getBoundingClientRect().height ??
        container?.clientHeight ??
        1;
      if (
        !currentScene ||
        !stackedPianoRollRef.current ||
        currentScene.rows.length < 2
      ) {
        return viewportHeight;
      }
      const laneTop = RULER_H + lyricsRowHeight(currentScene) + TEMPO_H;
      const {height} = stackedRowGeometry(currentScene, laneTop);
      return height + laneTop + WAVE_ROW_H;
    },
    [],
  );

  // -- Sizing (DPR-aware, ResizeObserver-driven) -----------------------------
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const applySize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, contentHeightForScene(sceneRef.current));
      contentHeightRef.current = height;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const stacked =
        stackedPianoRollRef.current && (sceneRef.current?.rows.length ?? 0) > 1;
      if (stacked) {
        const current = sceneRef.current;
        const sharedHeight = RULER_H + lyricsRowHeight(current) + TEMPO_H;
        const rowsHeight = Math.max(0, height - sharedHeight - WAVE_ROW_H);
        for (const region of [
          stackedTopCanvasRef.current,
          stackedRowsCanvasRef.current,
          stackedWaveCanvasRef.current,
        ]) {
          if (!region) continue;
          region.width = Math.round(width * dpr);
          region.style.width = `${width}px`;
        }
        if (stackedTopCanvasRef.current)
          stackedTopCanvasRef.current.style.height = `${sharedHeight}px`;
        if (stackedRowsCanvasRef.current)
          stackedRowsCanvasRef.current.style.height = `${rowsHeight}px`;
        if (stackedWaveCanvasRef.current)
          stackedWaveCanvasRef.current.style.height = `${WAVE_ROW_H}px`;
      }
      // Resizing the panel changes how much of the rows band is on screen,
      // which is what decides the rows `draw` paints.
      const rowsScroller = rowsScrollRef.current;
      if (rowsScroller) {
        rowsViewRef.current = {
          top: rowsScroller.scrollTop,
          height: rowsScroller.clientHeight,
        };
      }

      const scene = sceneRef.current;
      const view = viewRef.current;
      if (!view.initialized && scene && scene.totalMs > 0) {
        const fit = fitToWidth(width, scene.totalMs);
        view.leftMs = fit.leftMs;
        view.pxPerMs = fit.pxPerMs;
        view.initialized = true;
      }
      dirtyRef.current = true;
      drawRef.current(currentPlayheadMs());
    };

    const currentPlayheadMs = () => Math.max(0, audioManager.chartTime * 1000);

    applySize();
    const ro = new ResizeObserver(applySize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [audioManager, contentHeightForScene, scene, state.visibleTrackKeys]);

  // Initialize the view once the scene lands (in case the container was sized
  // before the chart doc arrived).
  useEffect(() => {
    const view = viewRef.current;
    const canvas = canvasRef.current;
    if (view.initialized || !scene || scene.totalMs <= 0 || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    if (width <= 0) return;
    const fit = fitToWidth(width, scene.totalMs);
    view.leftMs = fit.leftMs;
    view.pxPerMs = fit.pxPerMs;
    view.initialized = true;
    dirtyRef.current = true;
    drawRef.current(Math.max(0, audioManager.chartTime * 1000));
  }, [scene, audioManager]);

  // -- Animation frame loop (perf pass: rAF-only-while-playing) --------------
  // A continuous 60fps rAF loop is warranted exactly when something is
  // continuously changing: audio playback, or the user actively dragging
  // something in the panel (scrub/drag/marquee/tempo/section — "active", not
  // "idle"). Otherwise (paused, nothing in flight) redraws are event-driven:
  // every pointer/keyboard/context handler above already calls
  // `drawRef.current(...)` directly after mutating state/refs. The one gap
  // event-driven redraws can't cover is a playhead change that bypasses both
  // this panel AND the shared `ChartEditorContext` — e.g. the transport's
  // next/prev-section buttons, which seek `AudioManager` directly — so a
  // low-rate fallback poll (far below 60fps) stands in for the "event" that
  // doesn't exist. This is the "idle frames are not free" fix from the old
  // WaveformDisplay/TimelineMinimap unconditional-rAF-forever loops.
  const IDLE_POLL_MS = 120;
  useEffect(() => {
    let rafId = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let mode: 'raf' | 'idle' | null = null;

    const isActive = () =>
      audioManager.isPlaying || pointerModeRef.current !== 'idle';

    /**
     * Auto-scroll while a scrub drag holds the pointer in an edge band, so the
     * playhead the user is dragging stays on screen instead of stopping at the
     * viewport border. The pan re-seeks to the ms now under the (stationary)
     * pointer, which is what carries the playhead along with the view.
     */
    const edgeScroll = () => {
      const pointerX = scrubPointerXRef.current;
      const view = viewRef.current;
      const scene = sceneRef.current;
      const canvas = canvasRef.current;
      const now = performance.now();
      const dtMs = Math.min(50, now - scrubEdgeTsRef.current);
      scrubEdgeTsRef.current = now;
      if (pointerX === null || !scene || !canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const vw =
        stackedPianoRollRef.current && scene.rows.length > 1
          ? Math.max(1, width - STACKED_GUTTER_W)
          : width;
      const deltaPx = edgeScrollDeltaPx({pointerX, viewportWidth: vw, dtMs});
      if (deltaPx === 0) return;
      const before = view.leftMs;
      const panned = panByPx(view, deltaPx, vw, scene.totalMs);
      if (panned.leftMs === before) return; // already at the song's edge
      view.leftMs = panned.leftMs;
      dirtyRef.current = true;
      seekToRef.current(xToMs(pointerX, view));
    };

    const drawIfNeeded = () => {
      if (pointerModeRef.current === 'scrub') edgeScroll();
      const playheadMs = Math.max(0, audioManager.chartTime * 1000);
      const playing = audioManager.isPlaying;
      // Re-engage follow on the play rising edge (mirrors the highway).
      if (playing && !prevPlayingRef.current) viewRef.current.follow = true;
      prevPlayingRef.current = playing;

      let needDraw = dirtyRef.current;
      dirtyRef.current = false;

      if (Math.abs(playheadMs - lastPlayheadRef.current) > 0.05) {
        needDraw = true;
        lastPlayheadRef.current = playheadMs;
        const view = viewRef.current;
        const scene = sceneRef.current;
        const canvas = canvasRef.current;
        if (view.follow && scene && canvas && !scrubbingRef.current) {
          const dpr = window.devicePixelRatio || 1;
          const width = canvas.width / dpr;
          const viewportWidth =
            stackedPianoRollRef.current && scene.rows.length > 1
              ? Math.max(1, width - STACKED_GUTTER_W)
              : width;
          view.leftMs = followLeftMs({
            playheadMs,
            leftMs: view.leftMs,
            pxPerMs: view.pxPerMs,
            viewportWidth,
            anchorFraction: followAnchorRef.current,
            totalMs: scene.totalMs,
          });
        }
      }

      if (needDraw) drawRef.current(playheadMs);
    };

    const switchToIdle = () => {
      if (mode === 'idle') return;
      mode = 'idle';
      intervalId = setInterval(idleTick, IDLE_POLL_MS);
    };

    const switchToRaf = () => {
      if (mode === 'raf') return;
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      mode = 'raf';
      rafId = requestAnimationFrame(rafTick);
    };

    function rafTick() {
      drawIfNeeded();
      if (isActive()) {
        rafId = requestAnimationFrame(rafTick);
      } else {
        switchToIdle();
      }
    }

    function idleTick() {
      drawIfNeeded();
      if (isActive()) switchToRaf();
    }

    if (isActive()) switchToRaf();
    else switchToIdle();
    drawIfNeeded(); // initial draw regardless of mode

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (intervalId !== null) clearInterval(intervalId);
    };
  }, [audioManager]);

  /**
   * Scrolling the rows band brings rows into view that `draw` skipped as
   * off-screen. Repaint inline rather than flagging the frame loop: the
   * browser paints the new scroll offset at the end of this task, and a row
   * that has not been painted yet would show as empty lanes until the next
   * frame — which, with the transport paused, is a poll away.
   */
  const handleRowsScroll = useCallback(() => {
    const scroller = rowsScrollRef.current;
    if (scroller) {
      rowsViewRef.current = {
        top: scroller.scrollTop,
        height: scroller.clientHeight,
      };
    }
    dirtyRef.current = true;
    drawRef.current(Math.max(0, audioManager.chartTime * 1000));
  }, [audioManager]);

  // -- Interaction helpers ---------------------------------------------------
  const viewportWidth = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return 1;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    return stackedPianoRollRef.current &&
      (sceneRef.current?.rows.length ?? 0) > 1
      ? Math.max(1, width - STACKED_GUTTER_W)
      : width;
  }, []);

  const seekTo = useCallback(
    (ms: number) => {
      const scene = sceneRef.current;
      const totalMs = scene ? scene.totalMs : durationSeconds * 1000;
      const clamped = Math.max(0, Math.min(totalMs, ms));
      const sec = clamped / 1000;
      if (audioManager.isPlaying) {
        void audioManager.playChartTime(sec);
      } else {
        void audioManager.seekToChartTime(sec);
      }
      lastPlayheadRef.current = -1; // force a redraw next frame
    },
    [audioManager, durationSeconds],
  );

  seekToRef.current = seekTo;

  const seekZone = useCallback((y: number, laneBottom: number) => {
    return y <= RULER_H || y >= laneBottom;
  }, []);

  // -- Note-lane geometry + hit-testing --------------------------------------
  // Row order (Round 2 §4): ruler, lyrics, tempo, note lanes, waveform —
  // MUST match the `draw()` callback's geometry exactly, or hit-testing and
  // rendering disagree about which row a y pixel is in.
  const panelGeometry = useCallback(() => {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const h = canvas ? canvas.height / dpr : 1;
    const w = canvas ? canvas.width / dpr : 1;
    const lyricsTop = RULER_H;
    const lyricsH = lyricsRowHeight(sceneRef.current);
    const tempoTop = lyricsTop + lyricsH;
    const laneTop = tempoTop + TEMPO_H;
    const currentScene = sceneRef.current;
    const stacked =
      stackedPianoRollRef.current && (currentScene?.rows.length ?? 0) > 1;
    const stackedRows =
      stacked && currentScene
        ? stackedRowGeometry(currentScene, laneTop)
        : null;
    const laneBottom = stackedRows
      ? laneTop + stackedRows.height
      : h - WAVE_ROW_H;
    const laneCount = Math.max(1, currentScene?.lanes.length ?? 1);
    const laneH = stackedRows
      ? (stackedRows.rows[0]?.laneH ?? STACKED_LANE_H)
      : (laneBottom - laneTop) / laneCount;
    return {
      w,
      h,
      laneTop,
      laneBottom,
      laneH,
      laneCount,
      lyricsTop,
      lyricsH,
      tempoTop,
      rows: stackedRows?.rows ?? [],
      stacked,
    };
  }, []);

  const laneGeometry = useCallback((): LaneGeometry => {
    const g = panelGeometry();
    return {laneTop: g.laneTop, laneH: g.laneH, laneCount: g.laneCount};
  }, [panelGeometry]);

  /** The panel's vertical bands, for the marquee's band membership test. */
  const panelBands = useCallback((): PanelBands => {
    const g = panelGeometry();
    return {
      rulerTop: 0,
      rulerBottom: RULER_H,
      lyricsTop: g.lyricsTop,
      lyricsBottom: g.lyricsTop + g.lyricsH,
      tempoTop: g.tempoTop,
      tempoBottom: g.laneTop,
      laneTop: g.laneTop,
      laneBottom: g.laneBottom,
    };
  }, [panelGeometry]);

  const pointFromEvent = useCallback(
    (
      event:
        | React.MouseEvent<HTMLCanvasElement>
        | React.PointerEvent<HTMLCanvasElement>,
    ) => {
      const region = event.currentTarget.dataset['pianoRollRegion'];
      const geometry = panelGeometry();
      const rawX = event.nativeEvent.offsetX;
      let y = event.nativeEvent.offsetY;
      if (region === 'rows') y += geometry.laneTop;
      else if (region === 'waveform') y += geometry.laneBottom;
      const stacked =
        stackedPianoRollRef.current && (sceneRef.current?.rows.length ?? 0) > 1;
      return {
        x: stacked ? rawX - STACKED_GUTTER_W : rawX,
        rawX,
        y,
      };
    },
    [panelGeometry],
  );

  const stackedRowAtY = useCallback(
    (y: number): TrackRowGeometry | null => {
      const g = panelGeometry();
      if (!g.stacked) return null;
      return g.rows.find(row => y >= row.laneTop && y < row.bottom) ?? null;
    },
    [panelGeometry],
  );

  const stackedRowForKey = useCallback(
    (trackKey: TrackKey): TrackRowGeometry | null => {
      const g = panelGeometry();
      return (
        g.rows.find(row => trackKeyId(row.row.key) === trackKeyId(trackKey)) ??
        null
      );
    },
    [panelGeometry],
  );

  const pickStackedAt = useCallback(
    (x: number, y: number): StackedNoteHit | null => {
      const scene = sceneRef.current;
      const row = stackedRowAtY(y);
      if (!scene || !row) return null;
      const rowScene = sceneForTrackRow(scene, row.row);
      const geo: LaneGeometry = {
        laneTop: row.laneTop,
        laneH: row.laneH,
        laneCount: row.row.lanes.length,
      };
      const part = isGuitarBassSchema(rowScene.schema)
        ? pickNotePartAt(
            rowScene.notes,
            {
              view: viewRef.current,
              geo,
              timedTempos: scene.timedTempos,
              resolution: scene.resolution,
              hitHalfWidth: NOTE_HIT_HALF_WIDTH,
            },
            x,
            y,
          )
        : null;
      const note =
        part?.note ??
        pickNoteAt(
          rowScene.notes,
          {
            view: viewRef.current,
            geo,
            timedTempos: scene.timedTempos,
            resolution: scene.resolution,
            hitHalfWidth: NOTE_HIT_HALF_WIDTH,
          },
          x,
          y,
        );
      return note ? {row, scene: rowScene, note, part} : null;
    },
    [stackedRowAtY],
  );

  const pickAt = useCallback(
    (x: number, y: number): PianoRollNote | null => {
      const scene = sceneRef.current;
      if (!scene) return null;
      if (stackedPianoRollRef.current && scene.rows.length > 1) {
        return pickStackedAt(x, y)?.note ?? null;
      }
      if (isGuitarBassSchema(scene.schema)) {
        return (
          pickNotePartAt(
            scene.notes,
            {
              view: viewRef.current,
              geo: laneGeometry(),
              timedTempos: scene.timedTempos,
              resolution: scene.resolution,
              hitHalfWidth: NOTE_HIT_HALF_WIDTH,
            },
            x,
            y,
          )?.note ?? null
        );
      }
      return pickNoteAt(
        scene.notes,
        {
          view: viewRef.current,
          geo: laneGeometry(),
          timedTempos: scene.timedTempos,
          resolution: scene.resolution,
          hitHalfWidth: NOTE_HIT_HALF_WIDTH,
        },
        x,
        y,
      );
    },
    [laneGeometry, pickStackedAt],
  );

  const pickPartAt = useCallback(
    (x: number, y: number): NotePartHit | null => {
      const scene = sceneRef.current;
      if (!scene) return null;
      if (stackedPianoRollRef.current && scene.rows.length > 1) {
        return pickStackedAt(x, y)?.part ?? null;
      }
      if (!isGuitarBassSchema(scene.schema)) return null;
      return pickNotePartAt(
        scene.notes,
        {
          view: viewRef.current,
          geo: laneGeometry(),
          timedTempos: scene.timedTempos,
          resolution: scene.resolution,
          hitHalfWidth: NOTE_HIT_HALF_WIDTH,
        },
        x,
        y,
      );
    },
    [laneGeometry, pickStackedAt],
  );

  const snappedTickAt = useCallback((x: number): number => {
    const scene = sceneRef.current;
    if (!scene) return 0;
    const ms = xToMs(x, viewRef.current);
    const raw = msToTick(ms, scene.timedTempos, scene.resolution);
    return snapTickToGrid(
      raw,
      scene.resolution,
      editStateRef.current.gridDivision,
    );
  }, []);

  // Set (or clear) the add-mode ghost, redrawing only when it actually
  // changes so a stationary pointer doesn't churn the canvas.
  const setGhost = useCallback(
    (next: ProspectiveNote | null) => {
      const cur = ghostRef.current;
      if (
        cur === next ||
        (cur !== null &&
          next !== null &&
          cur.tick === next.tick &&
          cur.lane === next.lane &&
          cur.cymbal === next.cymbal)
      ) {
        return;
      }
      ghostRef.current = next;
      dirtyRef.current = true;
      drawRef.current(Math.max(0, audioManager.chartTime * 1000));
    },
    [audioManager],
  );

  // Shared note selection (shift-aware), mirroring the highway's cursor tool.
  // Ids are always track-qualified — the highway, the piano roll's stacked
  // rows and its single-track mode all read the same store, so an id without
  // its owning track would resolve in whichever pane/row happens to have a
  // note with the same local `tick:type`.
  const selectNote = useCallback(
    (id: string, shift: boolean, trackKey?: TrackKey) => {
      const st = editStateRef.current;
      const qualifiedId = trackKey ? trackQualifiedNoteId(trackKey, id) : id;
      const current = getSelectedIds(st, 'note');
      if (shift) {
        const next = new Set(current);
        if (next.has(qualifiedId)) next.delete(qualifiedId);
        else next.add(qualifiedId);
        dispatch({type: 'SET_SELECTION', kind: 'note', ids: next});
      } else if (!current.has(qualifiedId)) {
        dispatch({
          type: 'SET_SELECTION',
          kind: 'note',
          ids: new Set([qualifiedId]),
        });
        // A plain click replaces the selection, including a section left
        // selected from an earlier ruler click. Without this the section
        // outlives the click and Delete would remove it instead of the note.
        dispatch({type: 'SET_SELECTION', kind: 'section', ids: new Set()});
      }
    },
    [dispatch],
  );

  // Lyric selection (shift-aware), mirroring `selectNote` so a lyric chip
  // participates in multi-select the same way a note does: shift toggles
  // membership; a plain click on an already-selected chip preserves the rest
  // of the selection (so it can be dragged as a group).
  const selectLyric = useCallback(
    (id: string, shift: boolean) => {
      const st = editStateRef.current;
      const current = getSelectedIds(st, 'lyric');
      if (shift) {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        dispatch({type: 'SET_SELECTION', kind: 'lyric', ids: next});
      } else if (!current.has(id)) {
        dispatch({type: 'SET_SELECTION', kind: 'lyric', ids: new Set([id])});
        // Same replace-the-selection rule as `selectNote`: a plain chip click
        // drops a section that a previous ruler click left selected.
        dispatch({type: 'SET_SELECTION', kind: 'section', ids: new Set()});
      }
    },
    [dispatch],
  );

  /**
   * The phrases a lyric drag should carry whole: every phrase with both
   * edges selected, but only when the grabbed chip's own phrase
   * (`anchorPhraseTick`) is one of them. Grabbing a syllable in some other
   * phrase is an ordinary syllable drag, even if a phrase elsewhere happens
   * to be fully selected. Empty set means "not a whole-phrase drag".
   */
  const wholePhraseDragTicks = useCallback(
    (anchorPhraseTick: number): ReadonlySet<number> => {
      const bands = sceneRef.current?.lyricBands;
      if (!bands) return EMPTY_TICKS;
      const ticks = fullySelectedPhraseTicks(
        bands,
        phraseStartSelectionRef.current,
        phraseEndSelectionRef.current,
      );
      return ticks.includes(anchorPhraseTick) ? new Set(ticks) : EMPTY_TICKS;
    },
    [],
  );

  const applyWheel = useCallback(
    (rawX: number, deltaX: number, deltaY: number, shiftKey: boolean) => {
      const stacked =
        stackedPianoRollRef.current && (sceneRef.current?.rows.length ?? 0) > 1;
      if (stacked && rawX < STACKED_GUTTER_W) return false;
      const scene = sceneRef.current;
      if (!scene) return true;
      const view = viewRef.current;
      const w = viewportWidth();
      const pan = shiftKey || Math.abs(deltaX) > Math.abs(deltaY);
      if (pan) {
        const deltaPx = shiftKey ? deltaY || deltaX : deltaX;
        const next = panByPx(view, deltaPx, w, scene.totalMs);
        view.leftMs = next.leftMs;
        if (audioManager.isPlaying) view.follow = false;
      } else {
        const bounds = zoomBounds(w, scene.totalMs);
        const next = zoomAt(
          view,
          stacked ? rawX - STACKED_GUTTER_W : rawX,
          deltaY,
          w,
          scene.totalMs,
          bounds,
        );
        view.leftMs = next.leftMs;
        view.pxPerMs = next.pxPerMs;
      }
      dirtyRef.current = true;
      drawRef.current(Math.max(0, audioManager.chartTime * 1000));
      return true;
    },
    [audioManager, viewportWidth],
  );

  // One non-passive capture listener on the container covers every canvas and
  // the stacked rows' scroll box. React attaches `wheel` listeners passively,
  // in both phases, so a React `onWheel`/`onWheelCapture` cannot
  // `preventDefault()` — it logs "Unable to preventDefault inside passive
  // event listener invocation" and the page scrolls anyway. Capture on the
  // ancestor is also the only place that can prevent the default *before* the
  // `overflow-auto` rows box consumes the wheel as a native scroll.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (event: WheelEvent) => {
      // The context menu and the tap tool render inside this container and
      // scroll themselves when `computeContextMenuPlacement` clips them, so an
      // ancestor listener must leave their wheel events alone. `applyWheel`
      // cannot make this call: it returns true (→ preventDefault) even with no
      // scene.
      const target = event.target;
      if (target instanceof Node && overlayRef.current?.contains(target)) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const rawX = event.clientX - rect.left;
      if (!applyWheel(rawX, event.deltaX, event.deltaY, event.shiftKey)) return;
      event.preventDefault();
    };
    container.addEventListener('wheel', onWheel, {
      capture: true,
      passive: false,
    });
    return () =>
      container.removeEventListener('wheel', onWheel, {capture: true});
  }, [applyWheel]);

  /**
   * Start a whole-panel marquee. Called from every band that can host one
   * (note lanes, tempo lane, lyrics row) so the capture/base-selection/
   * clear-on-plain-drag contract has exactly one definition.
   *
   * A plain drag clears every marquee kind up front (the sweep picks back
   * up whatever it crosses); shift captures the current selection as the
   * base and merges into it, matching the note marquee's long-standing
   * shift convention.
   *
   * The ruler is NOT a start zone: a press there scrubs (or grabs a loop
   * flag / section flag). Its section flags are still marquee-selectable —
   * drag up into the ruler from the band below and the rectangle picks them
   * up like any other band's entities.
   */
  const beginMarquee = useCallback(
    (
      canvas: HTMLCanvasElement,
      pointerId: number,
      x: number,
      y: number,
      shiftKey: boolean,
      trackKey: TrackKey,
      rowScoped: boolean,
    ) => {
      const st = editStateRef.current;
      canvas.setPointerCapture(pointerId);
      pointerModeRef.current = 'marquee';
      pointerStartRef.current = {x, y};
      marqueeRef.current = {trackKey, rowScoped, x0: x, y0: y, x1: x, y1: y};
      const base = emptyMarqueeSelection();
      if (shiftKey) {
        for (const kind of MARQUEE_KINDS) {
          for (const id of getSelectedIds(st, kind)) base[kind].add(id);
        }
      } else {
        dispatch({type: 'SET_SELECTION_MULTI', selection: base});
      }
      marqueeBaseRef.current = base;
      marqueeShiftRef.current = shiftKey;
    },
    [dispatch],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Right-click never scrubs / drags / marquees — it only opens the
      // context menu (handled in onContextMenu). Left button only here (§3/§10).
      // macOS delivers a Control-click (the common laptop secondary-click) as
      // `button === 0` with `ctrlKey` set; treat it as a right-click too. If we
      // let it start a left gesture, the gesture's `setPointerCapture` suppresses
      // the following `contextmenu` event in Blink/WebKit and the menu never
      // opens (QA round-1 bug).
      if (e.button !== 0 || e.ctrlKey) return;
      const canvas = e.currentTarget;
      const scene = sceneRef.current;
      if (!scene) return;
      const g = panelGeometry();
      const point = pointFromEvent(e);
      const y = point.y;
      const stacked =
        stackedPianoRollRef.current && (scene.rows.length ?? 0) > 1;
      if (stacked && point.rawX < STACKED_GUTTER_W) return;
      const x = point.x;

      // Any new pointer interaction dismisses an open menu (§10), except the
      // tempo lane's entry tools, which only Escape and their own Cancel
      // close.
      closeUnlessEntering();

      // Scrub zones (ruler + waveform) keep their existing behavior, except a
      // hit on a section flag (ruler only) which begins a potential drag
      // instead of seeking immediately (§6): a plain click (no movement past
      // the drag threshold) still seeks on release, same as before; a real
      // drag moves the section, grid-snapped, via the shared
      // `MoveEntitiesCommand` (the same one the highway's marker drag uses).
      if (seekZone(y, g.laneBottom)) {
        canvas.setPointerCapture(e.pointerId);
        viewRef.current.follow = false;
        if (y <= RULER_H) {
          // Loop flags first: they render on top of the section flags, so
          // they win the pointer where the two overlap.
          const loopRegion = editStateRef.current.loopRegion;
          const loopFlag = pickLoopFlagAt(loopRegion, viewRef.current, x);
          if (loopRegion && loopFlag) {
            pointerModeRef.current = 'loop';
            pointerStartRef.current = {x, y};
            loopDragRef.current = {
              kind: loopFlag,
              region: loopRegion,
              moved: false,
            };
            return;
          }
          const hit = hitSection(
            canvasRef.current ?? canvas,
            x,
            viewRef.current,
            scene,
          );
          if (hit) {
            pointerModeRef.current = 'section';
            pointerStartRef.current = {x, y};
            sectionDragRef.current = {
              originalTick: hit.tick,
              currentTick: hit.tick,
              moved: false,
            };
            dispatch({
              type: 'SET_SELECTION',
              kind: 'section',
              ids: new Set([String(hit.tick)]),
            });
            dirtyRef.current = true;
            drawRef.current(Math.max(0, audioManager.chartTime * 1000));
            return;
          }
        }
        scrubbingRef.current = true;
        pointerModeRef.current = 'scrub';
        scrubPointerXRef.current = x;
        scrubEdgeTsRef.current = performance.now();
        seekTo(xToMs(x, viewRef.current));
        return;
      }

      // Lyrics row (plan 0063 Part D §2; Round 2 §4 moved it directly under
      // the ruler): grab a syllable chip and retime it continuously (NO grid
      // snap), or grab a phrase-band edge and resize it (Round 2 §2). A miss
      // falls through to nothing (right-click opens the row's context menu).
      if (y < g.tempoTop) {
        const hit = capabilities.selectable.has('lyric')
          ? pickLyricChipAt(
              scene.lyricChips,
              viewRef.current,
              x,
              lyricChipWidthsRef.current,
            )
          : null;
        if (hit) {
          canvas.setPointerCapture(e.pointerId);
          pointerModeRef.current = 'lyric';
          viewRef.current.follow = false;
          pointerStartRef.current = {x, y};
          // Both edges of the grabbed chip's phrase selected means "move
          // this phrase", so the drag carries the phrase (with every other
          // fully-selected one) and is bounded by how far those phrases can
          // travel, not by the grabbed chip's own phrase.
          const movingPhraseTicks = wholePhraseDragTicks(hit.phraseMinTick);
          const bounds =
            movingPhraseTicks.size > 0
              ? phraseTranslationBounds(
                  scene.lyricBands.map(b => ({
                    tick: b.tick,
                    length: b.tickEnd - b.tick,
                  })),
                  movingPhraseTicks,
                )
              : null;
          lyricDragRef.current = {
            chipId: hit.id,
            originalTick: hit.tick,
            currentTick: hit.tick,
            phraseMinTick: bounds
              ? hit.tick + bounds.minDelta
              : hit.phraseMinTick,
            phraseMaxTick: bounds
              ? hit.tick + bounds.maxDelta
              : hit.phraseMaxTick,
            movingPhraseTicks,
            moved: false,
          };
          selectLyric(hit.id, e.shiftKey);
          dirtyRef.current = true;
          drawRef.current(Math.max(0, audioManager.chartTime * 1000));
          return;
        }

        const edgeHit =
          capabilities.draggable.has('phrase-start') ||
          capabilities.draggable.has('phrase-end')
            ? pickPhraseEdgeAt(scene.lyricBands, viewRef.current, x)
            : null;
        if (edgeHit && capabilities.draggable.has(edgeHit.kind)) {
          const bounds = phraseEdgeDragBounds(
            scene.lyricBands,
            edgeHit.bandIndex,
            edgeHit.kind,
          );
          canvas.setPointerCapture(e.pointerId);
          pointerModeRef.current = 'phrase-edge';
          viewRef.current.follow = false;
          pointerStartRef.current = {x, y};
          phraseEdgeDragRef.current = {
            kind: edgeHit.kind,
            originalTick: edgeHit.tick,
            currentTick: edgeHit.tick,
            minTick: bounds.min,
            maxTick: bounds.max,
            moved: false,
          };
          canvas.style.cursor = 'ew-resize';
          dirtyRef.current = true;
          drawRef.current(Math.max(0, audioManager.chartTime * 1000));
          return;
        }

        // Empty lyrics-row space (no chip, no phrase edge): begin a marquee
        // the same way empty note-lane space does, below. Cursor tool only,
        // mirroring the note-lane fallback's tool gate.
        if (editStateRef.current.activeTool === 'cursor') {
          beginMarquee(
            canvas,
            e.pointerId,
            x,
            y,
            e.shiftKey,
            marqueeFallbackTrackKey(scene),
            false,
          );
        }
        return;
      }

      // Tempo lane: grab a sparse marker and drag to refit the grid (§7).
      // Marker 0 (song-start anchor) is immovable; a miss falls through to
      // nothing (right-click opens the add/downbeat/×2÷2 menu instead).
      if (y < g.laneTop) {
        // Signature chips sit in the lane's top strip and take the pointer
        // there, using the same capture/threshold/commit-on-up pattern as a
        // section flag. `hitTsChip` already excludes the chart's initial
        // meter, which stays put.
        const tsIndex =
          y < g.tempoTop + TS_CHIP_TOP + TS_CHIP_H
            ? hitTsChip(
                scene.timeSignatures,
                viewRef.current,
                x,
                tsChipWidthsRef.current,
              )
            : -1;
        if (tsIndex >= 0) {
          const chip = scene.timeSignatures[tsIndex];
          canvas.setPointerCapture(e.pointerId);
          pointerModeRef.current = 'timesig';
          viewRef.current.follow = false;
          pointerStartRef.current = {x, y};
          tsDragRef.current = {
            originalTick: chip.tick,
            currentTick: chip.tick,
            moved: false,
          };
          canvas.style.cursor = 'ew-resize';
          dirtyRef.current = true;
          drawRef.current(Math.max(0, audioManager.chartTime * 1000));
          return;
        }
        const k = hitTempoMarker(scene.tempos, viewRef.current, x);
        if (k > 0) {
          canvas.setPointerCapture(e.pointerId);
          pointerModeRef.current = 'tempo';
          viewRef.current.follow = false;
          const marker = scene.tempos[k];
          tempoBaseDocRef.current = editStateRef.current.chartDoc;
          tempoDragRef.current = {
            index: k,
            markerTick: marker.tick,
            origMs: marker.ms,
            currentMs: marker.ms,
            moved: false,
          };
          canvas.style.cursor = 'ew-resize';
          dirtyRef.current = true;
          drawRef.current(Math.max(0, audioManager.chartTime * 1000));
          return;
        }
        // Empty tempo-lane space: begin a marquee, exactly as the note lanes
        // and lyrics row do. A drag kept inside this lane selects markers and
        // signature chips only; dragging down into the lanes or up into the
        // ruler widens it. Right-click still opens the add/downbeat menu.
        if (editStateRef.current.activeTool === 'cursor') {
          beginMarquee(
            canvas,
            e.pointerId,
            x,
            y,
            e.shiftKey,
            marqueeFallbackTrackKey(scene),
            false,
          );
        }
        return;
      }

      // Note-lane band: editing. Gated while a class-(b) structural candidate
      // is previewed (accept/reject bar up): the panel hit-tests the candidate
      // doc but commands execute against the committed doc, so a click here
      // could target a candidate-only note or the wrong committed one. The
      // preview is read-only + accept/reject; scrub/zoom (handled above) stay
      // live. (A class-(a) marker drag can't reach this branch — its pointerdown
      // already returned in the tempo-lane block and captures the pointer.)
      if (isStructuralPreview(editStateRef.current)) return;

      const st = editStateRef.current;
      const tool = st.activeTool;
      const row = stacked ? stackedRowAtY(y) : null;
      if (stacked && !row) return;
      const interactionScene = row ? sceneForTrackRow(scene, row.row) : scene;
      const interactionTrackKey =
        row?.row.key ?? trackKeyFromScope(st.activeScope);
      const interactionLaneGeometry = row
        ? {
            laneTop: row.laneTop,
            laneH: row.laneH,
            laneCount: row.row.lanes.length,
          }
        : laneGeometry();
      const partHit = tool === 'cursor' ? pickPartAt(x, y) : null;
      const hit = pickAt(x, y);
      pointerStartRef.current = {x, y};

      if (tool === 'place') {
        if (!interactionTrackKey) return;
        const lane = laneAtY(y, interactionLaneGeometry);
        if (lane === null) return;
        if (hit) {
          // Toggle: a note already here is removed.
          executeCommand(
            new DeleteNotesCommand(
              new Set([hit.id]),
              interactionTrackKey,
              interactionScene.schema ?? undefined,
            ),
          );
        } else if (interactionScene.schema) {
          // A click creates a hit; a drag to the right creates the sustain.
          // The note is committed on pointer-up so the same gesture works for
          // both zero-length and sustained guitar/bass notes.
          canvas.setPointerCapture(e.pointerId);
          const startTick = snappedTickAt(x);
          placeNoteRef.current = {
            trackKey: interactionTrackKey,
            lane,
            startTick,
            currentTick: startTick,
            active: false,
          };
          pointerModeRef.current = 'place-drag';
          setGhost(prospectiveNoteAt(lane, startTick, interactionScene.schema));
        }
        return;
      }

      if (tool === 'erase') {
        pointerModeRef.current = 'erase';
        canvas.setPointerCapture(e.pointerId);
        if (hit && interactionTrackKey) {
          executeCommand(
            new DeleteNotesCommand(
              new Set([hit.id]),
              interactionTrackKey,
              interactionScene.schema ?? undefined,
            ),
          );
        }
        return;
      }

      // Cursor tool: select + drag, or marquee on empty space.
      if (!capabilities.selectable.has('note')) return;
      canvas.setPointerCapture(e.pointerId);

      if (
        partHit?.part === 'end' &&
        interactionTrackKey &&
        capabilities.draggable.has('note')
      ) {
        selectNote(partHit.note.id, e.shiftKey, interactionTrackKey);
        pointerModeRef.current = 'resize';
        noteResizeRef.current = {
          trackKey: interactionTrackKey,
          noteId: partHit.note.id,
          originalLength: partHit.note.length ?? 0,
          currentLength: partHit.note.length ?? 0,
          active: false,
        };
        canvas.style.cursor = 'ew-resize';
        return;
      }

      if (hit) {
        selectNote(hit.id, e.shiftKey, interactionTrackKey);
        dispatch({
          type: 'SET_HOVER',
          hovered: {
            kind: 'note',
            id: interactionTrackKey
              ? trackQualifiedNoteId(interactionTrackKey, hit.id)
              : hit.id,
          },
        });
        if (capabilities.draggable.has('note')) {
          pointerModeRef.current = 'drag';
          noteDragRef.current = {
            trackKey: interactionTrackKey!,
            anchorTick: hit.tick,
            anchorLane: hit.lane,
            tickDelta: 0,
            laneDelta: 0,
            active: false,
          };
        }
        return;
      }

      // Empty space: begin a marquee. A plain drag clears every kind up
      // front and the sweep picks back up whatever it crosses, in whichever
      // bands it reaches.
      beginMarquee(
        canvas,
        e.pointerId,
        x,
        y,
        e.shiftKey,
        interactionTrackKey!,
        row !== null,
      );
    },
    [
      audioManager,
      beginMarquee,
      capabilities,
      closeUnlessEntering,
      dispatch,
      executeCommand,
      laneGeometry,
      panelGeometry,
      pickAt,
      pickPartAt,
      stackedRowAtY,
      seekTo,
      seekZone,
      selectLyric,
      selectNote,
      setGhost,
      snappedTickAt,
      pointFromEvent,
      wholePhraseDragTicks,
    ],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = e.currentTarget;
      const scene = sceneRef.current;
      if (!scene) return;
      const g = panelGeometry();
      const point = pointFromEvent(e);
      const y = point.y;
      const stacked =
        stackedPianoRollRef.current && (scene.rows.length ?? 0) > 1;
      const x = point.x;
      const mode = pointerModeRef.current;

      if (mode === 'scrub') {
        // Pointer capture keeps the events coming after the pointer leaves the
        // canvas, so `x` can be negative or past the width — exactly what the
        // frame loop's edge-scroll wants.
        scrubPointerXRef.current = x;
        seekTo(xToMs(x, viewRef.current));
        return;
      }

      // Live loop-flag drag: continuous ms (a playback range, not a chart
      // entity), clamped by `moveLoopEdge` so the edges keep their order.
      if (mode === 'loop' && loopDragRef.current) {
        const drag = loopDragRef.current;
        const start = pointerStartRef.current;
        const dx = start ? x - start.x : 0;
        if (!drag.moved && !exceedsDragThreshold(dx, 0)) return;
        const region = moveLoopEdge(
          drag.region,
          drag.kind,
          xToMs(x, viewRef.current),
        );
        loopDragRef.current = {...drag, region, moved: true};
        dirtyRef.current = true;
        drawRef.current(Math.max(0, audioManager.chartTime * 1000));
        return;
      }

      // Live section-flag drag (§6): absolute grid-snap (not delta-snap —
      // mirrors the highway's `screenToTick(x, y, w, h, gridDivision)`, the
      // same snap a section marker drag uses there).
      if (mode === 'section' && sectionDragRef.current) {
        const drag = sectionDragRef.current;
        const start = pointerStartRef.current;
        const dx = start ? x - start.x : 0;
        if (drag.moved || exceedsDragThreshold(dx, 0)) {
          const newTick = Math.max(0, snappedTickAt(x));
          if (newTick !== drag.currentTick || !drag.moved) {
            sectionDragRef.current = {
              ...drag,
              currentTick: newTick,
              moved: true,
            };
            dirtyRef.current = true;
            drawRef.current(Math.max(0, audioManager.chartTime * 1000));
          }
        }
        return;
      }

      // Live time-signature-chip drag: absolute grid-snap, the same snap the
      // section drag and every other placement uses.
      if (mode === 'timesig' && tsDragRef.current) {
        const drag = tsDragRef.current;
        const start = pointerStartRef.current;
        const dx = start ? x - start.x : 0;
        if (drag.moved || exceedsDragThreshold(dx, 0)) {
          const newTick = Math.max(0, snappedTickAt(x));
          if (newTick !== drag.currentTick || !drag.moved) {
            tsDragRef.current = {...drag, currentTick: newTick, moved: true};
            dirtyRef.current = true;
            drawRef.current(Math.max(0, audioManager.chartTime * 1000));
          }
        }
        return;
      }

      // Live tempo-marker drag: refit the grid; preview flows through the
      // pendingTempoCandidate channel (§7). Neighbours never move (the command
      // enforces it); the clamp keeps the marker off its neighbours on screen.
      if (mode === 'tempo' && tempoDragRef.current) {
        const drag = tempoDragRef.current;
        const desiredMs = xToMs(x, viewRef.current);
        const newMs = clampMarkerMs(
          scene.tempos,
          drag.index,
          desiredMs,
          scene.totalMs,
        );
        canvas.style.cursor = 'ew-resize';
        if (Math.abs(newMs - drag.currentMs) < 0.1 && drag.moved) return;
        drag.currentMs = newMs;
        if (Math.abs(newMs - drag.origMs) > 0.5) drag.moved = true;
        const base = tempoBaseDocRef.current;
        if (base) {
          const glue = editStateRef.current.tempoGlueMode;
          const candidateDoc = new MoveTempoMarkerCommand(
            drag.markerTick,
            newMs,
            glue,
          ).execute(base);
          dispatch({
            type: 'SET_PENDING_TEMPO_CANDIDATE',
            candidate: {
              op: glue === 'grid' ? 'keep-ticks' : 'keep-ms',
              doc: candidateDoc,
            },
          });
        }
        return;
      }

      // Live lyric-chip drag: NO grid snap — the tick tracks the pointer
      // continuously, clamped to the chip's owning phrase (the same bound
      // `moveLyric` enforces).
      if (mode === 'lyric' && lyricDragRef.current) {
        const drag = lyricDragRef.current;
        const start = pointerStartRef.current;
        const dx = start ? x - start.x : 0;
        const rawTick = xToTickNoSnap(
          x,
          viewRef.current,
          scene.timedTempos,
          scene.resolution,
        );
        const clampedTick = Math.max(
          drag.phraseMinTick,
          Math.min(drag.phraseMaxTick, Math.max(0, rawTick)),
        );
        const moved = drag.moved || exceedsDragThreshold(dx, 0);
        if (clampedTick !== drag.currentTick || moved !== drag.moved) {
          lyricDragRef.current = {...drag, currentTick: clampedTick, moved};
          dirtyRef.current = true;
          drawRef.current(Math.max(0, audioManager.chartTime * 1000));
        }
        return;
      }

      // Live phrase-edge drag (Round 2 §2): NO grid snap, clamped to
      // `phraseEdgeDragBounds` (mirrors what `movePhraseStart`/`movePhraseEnd`
      // will actually clamp to on commit).
      if (mode === 'phrase-edge' && phraseEdgeDragRef.current) {
        const drag = phraseEdgeDragRef.current;
        const start = pointerStartRef.current;
        const dx = start ? x - start.x : 0;
        const rawTick = xToTickNoSnap(
          x,
          viewRef.current,
          scene.timedTempos,
          scene.resolution,
        );
        const clampedTick = Math.max(
          drag.minTick,
          Math.min(drag.maxTick, Math.max(0, rawTick)),
        );
        canvas.style.cursor = 'ew-resize';
        const moved = drag.moved || exceedsDragThreshold(dx, 0);
        if (clampedTick !== drag.currentTick || moved !== drag.moved) {
          phraseEdgeDragRef.current = {
            ...drag,
            currentTick: clampedTick,
            moved,
          };
          dirtyRef.current = true;
          drawRef.current(Math.max(0, audioManager.chartTime * 1000));
        }
        return;
      }

      if (mode === 'place-drag' && placeNoteRef.current) {
        const drag = placeNoteRef.current;
        const start = pointerStartRef.current;
        const dx = start ? x - start.x : 0;
        const currentTick = snappedTickAt(x);
        const moved = drag.active || exceedsDragThreshold(dx, 0);
        if (currentTick !== drag.currentTick || moved !== drag.active) {
          placeNoteRef.current = {...drag, currentTick, active: moved};
          dirtyRef.current = true;
          drawRef.current(Math.max(0, audioManager.chartTime * 1000));
        }
        return;
      }

      // Live guitar/bass sustain resize: the endpoint follows the snapped
      // grid, while the note head/lane remain fixed. Dragging left through the
      // head simply previews a zero-length note.
      if (mode === 'resize' && noteResizeRef.current) {
        const drag = noteResizeRef.current;
        const start = pointerStartRef.current;
        const dx = start ? x - start.x : 0;
        const row = stacked ? stackedRowForKey(drag.trackKey) : null;
        const rowScene = row ? sceneForTrackRow(scene, row.row) : scene;
        const anchor = rowScene.notes.find(n => n.id === drag.noteId);
        if (anchor) {
          const nextLength = Math.max(0, snappedTickAt(x) - anchor.tick);
          const moved = drag.active || exceedsDragThreshold(dx, 0);
          if (nextLength !== drag.currentLength || moved !== drag.active) {
            noteResizeRef.current = {
              ...drag,
              currentLength: nextLength,
              active: moved,
            };
            dirtyRef.current = true;
            drawRef.current(Math.max(0, audioManager.chartTime * 1000));
          }
        }
        return;
      }

      // Live note drag: delta-snapped, lane change single-note only.
      if (mode === 'drag' && noteDragRef.current) {
        const start = pointerStartRef.current;
        const drag = noteDragRef.current;
        const dx = start ? x - start.x : 0;
        const dy = start ? y - start.y : 0;
        if (drag.active || exceedsDragThreshold(dx, dy)) {
          const row = stacked ? stackedRowForKey(drag.trackKey) : null;
          const dragScene = row ? sceneForTrackRow(scene, row.row) : scene;
          const dragGeo = row
            ? {
                laneTop: row.laneTop,
                laneH: row.laneH,
                laneCount: row.row.lanes.length,
              }
            : laneGeometry();
          const dragSchema = dragScene.schema ?? drums4LaneSchema;
          const {min: minLane, max: maxLane} = fullLaneRange(dragSchema);
          const span = selectionLaneSpan(
            localNoteIdsForTrack(
              getSelectedIds(editStateRef.current, 'note'),
              drag.trackKey,
            ),
            dragSchema,
            drag.anchorLane,
          );
          const {tickDelta, laneDelta} = computeNoteDragDelta({
            anchorTick: drag.anchorTick,
            anchorLane: drag.anchorLane,
            snappedCursorTick: snappedTickAt(x),
            cursorLane:
              row && (y < row.laneTop || y >= row.bottom)
                ? null
                : laneAtY(y, dragGeo),
            prevLaneDelta: drag.laneDelta,
            minLane,
            maxLane,
            selectionMinLane: span.min,
            selectionMaxLane: span.max,
          });
          if (
            !drag.active ||
            tickDelta !== drag.tickDelta ||
            laneDelta !== drag.laneDelta
          ) {
            noteDragRef.current = {...drag, tickDelta, laneDelta, active: true};
            dirtyRef.current = true;
            drawRef.current(Math.max(0, audioManager.chartTime * 1000));
          }
        }
        return;
      }

      // Live marquee: sweep every band the rectangle reaches (shift merges
      // with the selection captured at drag start).
      if (mode === 'marquee' && marqueeRef.current) {
        const marquee = marqueeRef.current;
        const row = marquee.rowScoped
          ? stackedRowForKey(marquee.trackKey)
          : null;
        const constrainedY = row
          ? Math.max(row.laneTop, Math.min(row.bottom, y))
          : y;
        marqueeRef.current = {...marquee, x1: x, y1: constrainedY};
        // A row-scoped marquee works in row-local y, so its lane math and
        // its band test both run against the row's own geometry.
        const marqueeRect = row
          ? {
              ...marqueeRef.current,
              y0: marquee.y0 - row.laneTop,
              y1: constrainedY - row.laneTop,
            }
          : marqueeRef.current;
        const marqueeGeo = row
          ? {
              laneTop: 0,
              laneH: row.laneH,
              laneCount: row.row.lanes.length,
            }
          : laneGeometry();
        const bounds = marqueeBounds(marqueeRect, viewRef.current, marqueeGeo);
        const my0 = Math.min(marqueeRect.y0, marqueeRect.y1);
        const my1 = Math.max(marqueeRect.y0, marqueeRect.y1);

        // Band membership is what narrows a selection: `marqueeBounds`' lane
        // math always clamps to a valid lane index (0..laneCount-1) even when
        // the rectangle never gets near the note lanes, so a drag confined to
        // the tempo lane would otherwise resolve to lane 0 and sweep up red
        // notes whose ms range happens to overlap. `bandsTouched` gates each
        // band on the rectangle's actual vertical span.
        const touched = row
          ? {
              ruler: false,
              lyrics: false,
              tempo: false,
              lanes: my0 < row.bottom - row.laneTop && my1 > 0,
            }
          : bandsTouched(my0, my1, panelBands());
        // In the stacked layout every note belongs to a specific row, so
        // only a row-scoped marquee can select notes; a tempo-lane or
        // lyrics-row drag there stays out of the lanes.
        if (!row && stacked) touched.lanes = false;

        const rowSchema = row?.row.schema ?? scene.schema ?? drums4LaneSchema;
        const swept = computeMarqueeSelection({
          bounds,
          touched,
          allowed: capabilities.selectable,
          sources: {
            notes: (row ? row.row.notes : scene.notes).map(n => ({
              tick: n.tick,
              type: schemaLaneToType(rowSchema, n.lane),
              length: 0,
              flags: 0,
            })),
            schema: rowSchema,
            timedTempos: scene.timedTempos,
            resolution: scene.resolution,
            lyricChips: scene.lyricsVisible ? scene.lyricChips : [],
            phraseBands: scene.lyricsVisible ? scene.lyricBands : [],
            partName: DEFAULT_VOCALS_PART,
            tempoMarkers: scene.tempos,
            timeSignatures: scene.timeSignatures,
            sections: scene.sections,
          },
        });

        // Notes are stored track-qualified; every other kind's id is already
        // the id the store holds.
        const marqueeTrackKey = row?.row.key ?? marquee.trackKey;
        const next: Partial<Record<MarqueeKind, ReadonlySet<string>>> = {};
        for (const kind of MARQUEE_KINDS) {
          const merged = new Set(marqueeBaseRef.current[kind]);
          for (const id of swept[kind]) {
            merged.add(
              kind === 'note' ? trackQualifiedNoteId(marqueeTrackKey, id) : id,
            );
          }
          next[kind] = merged;
        }
        dispatch({type: 'SET_SELECTION_MULTI', selection: next});

        dirtyRef.current = true;
        drawRef.current(Math.max(0, audioManager.chartTime * 1000));
        return;
      }

      // Paint-erase while dragging with the erase tool.
      if (mode === 'erase') {
        const hit = pickAt(x, y);
        const row = stacked ? stackedRowAtY(y) : null;
        const trackKey =
          row?.row.key ?? trackKeyFromScope(editStateRef.current.activeScope);
        const eraseScene = row ? sceneForTrackRow(scene, row.row) : scene;
        if (hit && trackKey) {
          executeCommand(
            new DeleteNotesCommand(
              new Set([hit.id]),
              trackKey,
              eraseScene.schema ?? undefined,
            ),
          );
        }
        return;
      }

      // Idle hover: cursor + shared hover highlight.
      const clearMarkerHover = () => {
        if (hoverMarkerRef.current !== -1 || tsHoverTickRef.current !== null) {
          hoverMarkerRef.current = -1;
          tsHoverTickRef.current = null;
          dirtyRef.current = true;
          drawRef.current(Math.max(0, audioManager.chartTime * 1000));
        }
      };
      if (seekZone(y, g.laneBottom)) {
        // A section flag under the cursor is both click-to-seek and
        // draggable (§6) — `grab` signals the latter; elsewhere in the
        // scrub zones it's a plain seek target.
        const overLoopFlag =
          y <= RULER_H &&
          pickLoopFlagAt(
            editStateRef.current.loopRegion,
            viewRef.current,
            x,
          ) !== null;
        const overSection =
          !overLoopFlag &&
          y <= RULER_H &&
          hitSection(canvasRef.current ?? canvas, x, viewRef.current, scene);
        canvas.style.cursor = overLoopFlag
          ? 'ew-resize'
          : overSection
            ? 'grab'
            : 'pointer';
        clearMarkerHover();
        setGhost(null);
        if (hoverIdRef.current !== null || lyricHoverIdRef.current !== null) {
          dispatch({type: 'SET_HOVER', hovered: null});
        }
        return;
      }
      // Lyrics row (plan 0063 Part D; Round 2 §4 moved it under the ruler):
      // hover a syllable chip (grab cursor + ghost line at its tick, §3b), or
      // — when no chip is under the pointer — a phrase-band edge (ew-resize,
      // Round 2 §2).
      if (y < g.tempoTop) {
        clearMarkerHover();
        const hit = capabilities.selectable.has('lyric')
          ? pickLyricChipAt(
              scene.lyricChips,
              viewRef.current,
              x,
              lyricChipWidthsRef.current,
            )
          : null;
        setGhost(null);
        if (hit) {
          canvas.style.cursor = 'grab';
        } else {
          const edgeHit =
            capabilities.draggable.has('phrase-start') ||
            capabilities.draggable.has('phrase-end')
              ? pickPhraseEdgeAt(scene.lyricBands, viewRef.current, x)
              : null;
          canvas.style.cursor =
            edgeHit && capabilities.draggable.has(edgeHit.kind)
              ? 'ew-resize'
              : 'default';
        }
        const nextId = hit ? hit.id : null;
        if (nextId !== lyricHoverIdRef.current || hoverIdRef.current !== null) {
          dispatch({
            type: 'SET_HOVER',
            hovered: hit ? {kind: 'lyric', id: hit.id} : null,
          });
        }
        return;
      }
      // Tempo lane: hover a tempo marker or a signature chip (glow +
      // ew-resize cursor, §7).
      if (y < g.laneTop) {
        const tsIndex =
          y < g.tempoTop + TS_CHIP_TOP + TS_CHIP_H
            ? hitTsChip(
                scene.timeSignatures,
                viewRef.current,
                x,
                tsChipWidthsRef.current,
              )
            : -1;
        const tsTick = tsIndex >= 0 ? scene.timeSignatures[tsIndex].tick : null;
        const k =
          tsTick === null
            ? hitTempoMarker(scene.tempos, viewRef.current, x)
            : -1;
        const hoverK = k > 0 ? k : -1;
        canvas.style.cursor =
          hoverK >= 0 || tsTick !== null ? 'ew-resize' : 'default';
        setGhost(null);
        if (
          hoverK !== hoverMarkerRef.current ||
          tsTick !== tsHoverTickRef.current
        ) {
          hoverMarkerRef.current = hoverK;
          tsHoverTickRef.current = tsTick;
          dirtyRef.current = true;
          drawRef.current(Math.max(0, audioManager.chartTime * 1000));
        }
        return;
      }
      clearMarkerHover();
      const hoveredPart = pickPartAt(x, y);
      const hovered = pickAt(x, y);
      const hoverRow = stacked ? stackedRowAtY(y) : null;
      const hoverScene = hoverRow
        ? sceneForTrackRow(scene, hoverRow.row)
        : scene;
      const st = editStateRef.current;
      // Add-mode ghost: over an empty lane (a click there would ADD; over an
      // existing note a click TOGGLES it off, so no ghost). Uses the same
      // snap + prospective-note computation the highway and the actual add
      // command use, so the ghost predicts the identical note. Suppressed
      // while a structural preview locks editing.
      const placing = st.activeTool === 'place' && !isStructuralPreview(st);
      if (placing && !hovered) {
        const hoverGeo = hoverRow
          ? {
              laneTop: hoverRow.laneTop,
              laneH: hoverRow.laneH,
              laneCount: hoverRow.row.lanes.length,
            }
          : laneGeometry();
        const lane = laneAtY(y, hoverGeo);
        setGhost(
          lane === null || !hoverScene.schema
            ? null
            : prospectiveNoteAt(lane, snappedTickAt(x), hoverScene.schema),
        );
      } else {
        setGhost(null);
      }
      canvas.style.cursor =
        hoveredPart?.part === 'end'
          ? 'ew-resize'
          : hovered
            ? 'grab'
            : placing
              ? 'crosshair'
              : 'default';
      const hoverTrackKey =
        hoverRow?.row.key ?? trackKeyFromScope(st.activeScope);
      const nextId = hovered
        ? hoverTrackKey
          ? trackQualifiedNoteId(hoverTrackKey, hovered.id)
          : hovered.id
        : null;
      if (nextId !== hoverIdRef.current || lyricHoverIdRef.current !== null) {
        dispatch({
          type: 'SET_HOVER',
          hovered: hovered ? {kind: 'note', id: nextId!} : null,
        });
      }
    },
    [
      audioManager,
      capabilities,
      dispatch,
      executeCommand,
      laneGeometry,
      panelBands,
      panelGeometry,
      pickAt,
      pickPartAt,
      stackedRowForKey,
      stackedRowAtY,
      seekTo,
      seekZone,
      setGhost,
      snappedTickAt,
      pointFromEvent,
    ],
  );

  const endPointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const mode = pointerModeRef.current;
      const canvas = e.currentTarget;

      if (mode === 'place-drag' && placeNoteRef.current) {
        const drag = placeNoteRef.current;
        const scene = sceneRef.current;
        const row = scene?.rows.find(
          candidate => trackKeyId(candidate.key) === trackKeyId(drag.trackKey),
        );
        const placeScene = row && scene ? sceneForTrackRow(scene, row) : scene;
        if (placeScene?.schema) {
          const prospective = prospectiveNoteAt(
            drag.lane,
            drag.startTick,
            placeScene.schema,
          );
          executeCommand(
            new AddNoteCommand(
              {
                tick: prospective.tick,
                type: prospective.type,
                length: drag.active
                  ? Math.max(0, drag.currentTick - drag.startTick)
                  : 0,
                flags: prospective.flags,
              },
              drag.trackKey,
              placeScene.schema,
            ),
          );
        }
        placeNoteRef.current = null;
        ghostRef.current = null;
      }

      if (mode === 'resize' && noteResizeRef.current) {
        const drag = noteResizeRef.current;
        const scene = sceneRef.current;
        const delta = drag.currentLength - drag.originalLength;
        const row = scene?.rows.find(
          candidate => trackKeyId(candidate.key) === trackKeyId(drag.trackKey),
        );
        const resizeScene = row && scene ? sceneForTrackRow(scene, row) : scene;
        if (drag.active && delta !== 0 && resizeScene?.schema) {
          const ids = new Set(
            localNoteIdsForTrack(
              getSelectedIds(editStateRef.current, 'note'),
              drag.trackKey,
            ),
          );
          ids.add(drag.noteId);
          executeCommand(
            new ResizeNotesCommand(
              Array.from(ids),
              delta,
              drag.trackKey,
              resizeScene.schema,
            ),
          );
        }
        noteResizeRef.current = null;
      }

      if (mode === 'drag' && noteDragRef.current) {
        const drag = noteDragRef.current;
        if (drag.active && (drag.tickDelta !== 0 || drag.laneDelta !== 0)) {
          const st = editStateRef.current;
          const ids = localNoteIdsForTrack(
            getSelectedIds(st, 'note'),
            drag.trackKey,
          );
          // A mixed note+lyric selection (built via shift-click or marquee)
          // moves together: lyrics ride along at the notes' grid-snapped
          // tickDelta (no lane delta — lyrics don't have lanes), each
          // independently clamped to its own phrase by `moveLyric` inside
          // the lyric handler. Both moves land in one `BatchCommand` so
          // undo/redo treats the group drag as a single edit.
          //
          // Co-selected tempo markers and signature chips deliberately stay
          // put. A marker move is not a tick translation: `applyMarkerMoveBpms`
          // moves it in MS and rewrites the BPM of the segments on both sides,
          // so "move five markers by this delta" needs its own lib operation
          // (and its own `MIN_SEGMENT_MS` clamping) before it can mean
          // anything. Sections are chart-wide and likewise ride only their own
          // ruler drag.
          const lyricIds = Array.from(getSelectedIds(st, 'lyric'));
          const cmds: EditCommand[] = [];
          if (ids.length > 0) {
            cmds.push(
              new MoveEntitiesCommand(
                'note',
                ids,
                drag.tickDelta,
                drag.laneDelta,
                {trackKey: drag.trackKey},
              ),
            );
          }
          if (lyricIds.length > 0) {
            cmds.push(
              new MoveEntitiesCommand('lyric', lyricIds, drag.tickDelta, 0),
            );
          }
          if (cmds.length === 1) {
            executeCommand(cmds[0]);
          } else if (cmds.length > 1) {
            executeCommand(new BatchCommand(cmds));
          }
        }
      }

      // Commit a tempo-marker drag: the committed op is the same one the live
      // preview ran (same base doc, same glue, same final ms), so no geometry
      // jumps on release. EXECUTE_COMMAND clears the pending candidate; a
      // no-move drag just drops it.
      if (mode === 'tempo' && tempoDragRef.current) {
        const drag = tempoDragRef.current;
        if (drag.moved) {
          executeCommand(
            new MoveTempoMarkerCommand(
              drag.markerTick,
              drag.currentMs,
              editStateRef.current.tempoGlueMode,
            ),
          );
        } else {
          dispatch({type: 'SET_PENDING_TEMPO_CANDIDATE', candidate: null});
        }
      }

      // Commit a time-signature-chip drag: the drop runs the shared bar-line
      // placement, so it rewrites the measure before the new tick exactly the
      // way "make this a downbeat" does.
      if (mode === 'timesig' && tsDragRef.current) {
        const drag = tsDragRef.current;
        if (drag.moved && drag.currentTick !== drag.originalTick) {
          const chart = editStateRef.current.chartDoc?.parsedChart;
          if (chart) {
            commitBarLinePlanRef.current(
              planTimeSignatureMove(
                chart.timeSignatures,
                chart.resolution,
                drag.originalTick,
                drag.currentTick,
              ),
              new MoveTimeSignatureCommand(drag.originalTick, drag.currentTick),
            );
          }
        }
      }

      // Commit a loop-flag drag. The loop is transport state, not chart
      // content, so it dispatches rather than going through the undo stack —
      // the same `SET_LOOP_REGION` the transport's A/B buttons dispatch. A
      // click that never passed the drag threshold leaves the loop alone
      // (grabbing a flag is not a seek).
      if (mode === 'loop' && loopDragRef.current) {
        const drag = loopDragRef.current;
        if (drag.moved) {
          dispatch({type: 'SET_LOOP_REGION', region: drag.region});
        }
        loopDragRef.current = null;
      }

      // Commit (or resolve as a click) a section-flag drag (§6): a real drag
      // issues the shared `MoveEntitiesCommand('section', ...)` — the exact
      // command the highway's own section-marker drag uses — grid-snapped;
      // anything short of the drag threshold falls back to the original
      // click-to-seek behavior.
      if (mode === 'section' && sectionDragRef.current) {
        const drag = sectionDragRef.current;
        if (drag.moved && drag.currentTick !== drag.originalTick) {
          executeCommand(
            new MoveEntitiesCommand(
              'section',
              [String(drag.originalTick)],
              drag.currentTick - drag.originalTick,
              0,
              entityContextFromScope(editStateRef.current.activeScope),
            ),
          );
          dispatch({
            type: 'SET_SELECTION',
            kind: 'section',
            ids: new Set([String(drag.currentTick)]),
          });
        } else {
          const scene = sceneRef.current;
          const section = scene?.sections.find(
            s => s.tick === drag.originalTick,
          );
          if (section) seekTo(section.ms);
        }
      }

      // Commit a lyric-chip drag (plan 0063 Part D §2): the same
      // `MoveEntitiesCommand('lyric', ...)` the highway's marker drag issues,
      // but the delta comes from the continuous (unsnapped) drag preview. When
      // the drag started on a lyric that's part of a bigger selection (other
      // lyrics via shift-click/marquee, and/or notes), everything selected
      // rides along at the SAME tickDelta — each lyric independently clamped
      // to its own phrase by `moveLyric`, matching single-chip drag semantics.
      //
      // A phrase with BOTH edges selected travels whole instead
      // (`MovePhrasesCommand`), carrying its own lyrics; only lyrics outside
      // those phrases still need a `lyric` move of their own.
      if (mode === 'lyric' && lyricDragRef.current) {
        const drag = lyricDragRef.current;
        if (drag.moved && drag.currentTick !== drag.originalTick) {
          const tickDelta = drag.currentTick - drag.originalTick;
          const st = editStateRef.current;
          const scene = sceneRef.current;
          const moving = drag.movingPhraseTicks;
          const chipFor = (id: string) =>
            scene?.lyricChips.find(c => c.id === id);
          const ridesWithPhrase = (id: string) => {
            const chip = chipFor(id);
            return chip !== undefined && moving.has(chip.phraseMinTick);
          };

          const lyricIds = Array.from(getSelectedIds(st, 'lyric'));
          const looseLyricIds = lyricIds.filter(id => !ridesWithPhrase(id));
          const noteIds = Array.from(getSelectedIds(st, 'note'));
          const cmds: EditCommand[] = [];
          if (moving.size > 0) {
            cmds.push(
              new MovePhrasesCommand(
                Array.from(moving),
                tickDelta,
                DEFAULT_VOCALS_PART,
              ),
            );
          }
          if (looseLyricIds.length > 0) {
            cmds.push(
              new MoveEntitiesCommand('lyric', looseLyricIds, tickDelta, 0),
            );
          }
          if (noteIds.length > 0) {
            cmds.push(
              new MoveEntitiesCommand(
                'note',
                noteIds,
                tickDelta,
                0,
                entityContextFromScope(st.activeScope),
              ),
            );
          }
          if (cmds.length === 1) {
            executeCommand(cmds[0]);
          } else if (cmds.length > 1) {
            executeCommand(new BatchCommand(cmds));
          }

          // Re-derive each moved lyric's post-move id so the selection stays
          // pinned to the moved chips instead of going stale: a chip riding
          // its phrase keeps its place inside it, everything else lands
          // where its own phrase's clamp (`moveLyric`) puts it.
          const nextLyricIds = new Set<string>();
          for (const id of lyricIds) {
            const chip = chipFor(id);
            if (!chip) continue;
            const tick = moving.has(chip.phraseMinTick)
              ? chip.tick + tickDelta
              : Math.max(
                  chip.phraseMinTick,
                  Math.min(chip.phraseMaxTick, chip.tick + tickDelta),
                );
            nextLyricIds.add(lyricId(tick, DEFAULT_VOCALS_PART));
          }
          dispatch({type: 'SET_SELECTION', kind: 'lyric', ids: nextLyricIds});

          // Phrase-edge ids are tick-keyed too, so a travelling phrase's
          // edges need re-keying or the band loses its selection (and with
          // it the ability to drag it again without re-selecting).
          if (moving.size > 0 && scene) {
            const nextStarts = new Set<string>();
            const nextEnds = new Set<string>();
            for (const band of scene.lyricBands) {
              if (!moving.has(band.tick)) continue;
              nextStarts.add(
                phraseStartId(band.tick + tickDelta, DEFAULT_VOCALS_PART),
              );
              nextEnds.add(
                phraseEndId(band.tickEnd + tickDelta, DEFAULT_VOCALS_PART),
              );
            }
            dispatch({
              type: 'SET_SELECTION',
              kind: 'phrase-start',
              ids: nextStarts,
            });
            dispatch({
              type: 'SET_SELECTION',
              kind: 'phrase-end',
              ids: nextEnds,
            });
          }
        }
      }

      // Commit a phrase-edge drag (Round 2 §2): the same `MoveEntitiesCommand`
      // the highway's own phrase-marker drag issues (`phrase-start`/
      // `phrase-end`), delta from the continuous (unsnapped) drag preview.
      if (mode === 'phrase-edge' && phraseEdgeDragRef.current) {
        const drag = phraseEdgeDragRef.current;
        if (drag.moved && drag.currentTick !== drag.originalTick) {
          const id =
            drag.kind === 'phrase-start'
              ? phraseStartId(drag.originalTick)
              : phraseEndId(drag.originalTick);
          executeCommand(
            new MoveEntitiesCommand(
              drag.kind,
              [id],
              drag.currentTick - drag.originalTick,
              0,
              entityContextFromScope(editStateRef.current.activeScope),
            ),
          );
        }
      }

      scrubbingRef.current = false;
      scrubPointerXRef.current = null;
      pointerModeRef.current = 'idle';
      noteDragRef.current = null;
      noteResizeRef.current = null;
      placeNoteRef.current = null;
      tempoDragRef.current = null;
      tempoBaseDocRef.current = null;
      tsDragRef.current = null;
      sectionDragRef.current = null;
      loopDragRef.current = null;
      lyricDragRef.current = null;
      phraseEdgeDragRef.current = null;
      marqueeRef.current = null;
      pointerStartRef.current = null;
      dirtyRef.current = true;
      if (canvas && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
      drawRef.current(Math.max(0, audioManager.chartTime * 1000));
    },
    [audioManager, dispatch, executeCommand, seekTo],
  );

  // Drop the add-mode ghost when the pointer leaves the panel (no lane is
  // under it any more). A gesture in flight keeps its own state; only the
  // idle-hover ghost is cleared here.
  const handlePointerLeave = useCallback(() => {
    if (pointerModeRef.current === 'place-drag') return;
    setGhost(null);
  }, [setGhost]);

  // -- Context menus (§7 / §8 / §10) -----------------------------------------
  const openStackedViewMenu = useCallback(
    (x: number, y: number) => {
      const currentScene = sceneRef.current;
      if (!currentScene) return;
      openItemsMenu(
        x,
        y,
        // Every chartable track, not just the ones currently listed in the
        // stacked view — otherwise a track hidden via this same menu could
        // never be checked back on from here.
        currentScene.allTrackKeys.map(key => {
          const visible = editStateRef.current.visibleTrackKeys.has(
            trackKeyId(key),
          );
          return {
            label: `${key.instrument} · ${key.difficulty}`,
            checked: visible,
            onSelect: () =>
              dispatch({
                type: 'SET_TRACK_VISIBILITY',
                track: key,
                visible: !visible,
              }),
          };
        }),
      );
    },
    [dispatch, openItemsMenu],
  );

  /**
   * Run a bar-line placement, or explain why it can't run. A plan the chart
   * format cannot express (a gap no legal signature measures, reachable with
   * snap set to Free) is reported instead of being rounded onto some other
   * tick behind the user's back; a plan that changes nothing stays silent.
   */
  const commitBarLinePlan = useCallback(
    (plan: DownbeatPlan, command: EditCommand): void => {
      if (plan.status === 'inexact') {
        toast.error('That position cannot start a bar', {
          description:
            'No time signature can measure the gap back to the previous bar line. Turn snap on, or pick a finer grid.',
        });
        return;
      }
      if (plan.status === 'noop') return;
      executeCommand(command);
    },
    [executeCommand],
  );
  const commitBarLinePlanRef = useRef(commitBarLinePlan);
  commitBarLinePlanRef.current = commitBarLinePlan;

  /** Build the tempo-lane menu (§7 delete-marker; §7/§8 add-marker + downbeat
   *  toggle; Round 2 §6's ×2/÷2 structural correction) at screen x. Returns
   *  [] when nothing actionable is under x. */
  const buildTempoMenu = useCallback(
    (x: number, scene: ChartScene): MenuItem[] => {
      const view = viewRef.current;
      const st = editStateRef.current;
      // ×2/÷2 need the same gating the old floating buttons had: a chart
      // loaded, no structural preview already up, and editing enabled.
      const canStructuralNow =
        !!st.chartDoc &&
        !isStructuralPreview(st) &&
        capabilities.showEditingControls;
      const octaveItems: MenuItem[] = [
        {
          label: 'Double tempo (×2, re-predict)',
          disabled: !canStructuralNow,
          onSelect: () => previewOctaveRef.current(2),
        },
        {
          label: 'Halve tempo (÷2, re-predict)',
          disabled: !canStructuralNow,
          onSelect: () => previewOctaveRef.current(0.5),
        },
      ];

      // Tap tempo replaces this menu's contents in place rather than opening
      // its own surface, so the tool sits exactly where the right-click was
      // and the anchor never has to travel across the app.
      const tapItem = (anchorTick: number): MenuItem => ({
        label: 'Tap tempo…',
        disabled: !canStructuralNow,
        onSelect: () => {
          const {bar, beat} = barBeatAtTick(anchorTick, scene.beats);
          const rect = containerRef.current?.getBoundingClientRect();
          setMenu(open =>
            open === null
              ? open
              : {
                  ...open,
                  content: {
                    kind: 'tap',
                    anchorTick,
                    anchorMs: tickToMs(
                      anchorTick,
                      scene.timedTempos,
                      scene.resolution,
                    ),
                    anchorLabel: `${bar}.${beat}`,
                    clientX: (rect?.left ?? 0) + open.x,
                    clientY: (rect?.top ?? 0) + open.y,
                  },
                },
          );
        },
      });

      // Typed BPM entry, the other half of the tap tool: same in-place swap,
      // same anchor tick, same command. Offered only on a marker that already
      // exists — a tempo value is a property of a marker, so the way to get a
      // new one is to add it (which inherits the governing tempo) and then set
      // its value.
      const bpmItem = (anchorTick: number, initialBpm: number): MenuItem => ({
        label: `Set tempo value (${initialBpm.toFixed(1)} BPM)…`,
        disabled: !capabilities.showEditingControls,
        onSelect: () => {
          const {bar, beat} = barBeatAtTick(anchorTick, scene.beats);
          const rect = containerRef.current?.getBoundingClientRect();
          setMenu(open =>
            open === null
              ? open
              : {
                  ...open,
                  content: {
                    kind: 'bpm',
                    anchorTick,
                    anchorLabel: `${bar}.${beat}`,
                    initialBpm,
                    clientX: (rect?.left ?? 0) + open.x,
                    clientY: (rect?.top ?? 0) + open.y,
                  },
                },
          );
        },
      });

      // An authored signature chip under the pointer is the only place the
      // remove item appears: the hit test reads the very chips the lane
      // painted, so it can never offer to remove a marker that isn't there.
      const tsIndex = hitTsChip(
        scene.timeSignatures,
        view,
        x,
        tsChipWidthsRef.current,
      );
      if (tsIndex >= 0) {
        const chip = scene.timeSignatures[tsIndex];
        return [
          ...octaveItems,
          tapItem(chip.tick),
          {
            label: `Remove time signature change (${chip.label})`,
            danger: true,
            onSelect: () =>
              executeCommand(new RemoveTimeSignatureCommand(chip.tick)),
          },
        ];
      }

      const k = hitTempoMarker(scene.tempos, view, x);
      if (k >= 0) {
        const marker = scene.tempos[k];
        return [
          ...octaveItems,
          tapItem(marker.tick),
          bpmItem(marker.tick, marker.bpm),
          {
            label: `Delete tempo marker (${marker.bpm.toFixed(1)} BPM)`,
            disabled: k === 0, // marker 0 is the immovable song-start anchor
            danger: true,
            onSelect: () =>
              executeCommand(
                new DeleteTempoMarkerCommand(
                  marker.tick,
                  editStateRef.current.tempoGlueMode,
                ),
              ),
          },
        ];
      }
      // Empty lane. The beat items (rephase, tap) speak in beats, so they
      // resolve to the nearest one.
      const beatTick = nearestBeatTick(scene.beats, view, x);
      // The tick under the pointer, per the current grid setting: where every
      // "…here" item on this lane places, and the fallback for a lane with no
      // beat grid to resolve against.
      const pointerTick = Math.max(0, snappedTickAt(x));
      // With no beat grid there is nothing to anchor the structural items to,
      // but a tap still has somewhere to land.
      if (beatTick === null) {
        return [...octaveItems, tapItem(pointerTick)];
      }
      const hasMarker = scene.tempos.some(t => t.tick === pointerTick);
      const isDownbeat = editStateRef.current.downbeatFlags.downbeats.some(
        d => d.tick === beatTick,
      );
      const chart = editStateRef.current.chartDoc?.parsedChart;
      const downbeatPlan = chart
        ? planDownbeatAt(chart.timeSignatures, chart.resolution, pointerTick)
        : null;
      // PRIMARY (QA round-1 / 0061 §6): the expected fix for a mis-phased
      // grid is a whole-song rephase — the phase error is global, not local.
      // Anchoring at an already bar-aligned beat is phase 0 (a no-op), so the
      // item is disabled there. Reuses the existing RephaseDownbeatsCommand.
      // SECONDARY: place a single bar line here, for a grid that drifts part
      // way through rather than being mis-phased from the start.
      return [
        ...octaveItems,
        tapItem(beatTick),
        {
          label: 'Make this beat 1 (rephase song)',
          disabled: isDownbeat,
          onSelect: () =>
            executeCommand(
              new RephaseDownbeatsCommand(beatTick, scene.endTick),
            ),
        },
        {
          // Placed at the pointer's tick, not the nearest beat: a beat can be
          // half a beat away from the click, which is far enough to drop the
          // new marker on top of one the pointer deliberately steered clear
          // of — within `TEMPO_MARKER_HIT_RADIUS` the lane hands out that
          // marker's own menu instead of this one, so the two would paint
          // over each other and the older one would look deleted.
          //
          // The BPM is the one already governing this tick, so the mapping is
          // unchanged until the marker is dragged or its value retyped.
          label: 'Add tempo marker here',
          disabled: hasMarker,
          onSelect: () =>
            executeCommand(new AddTempoMarkerCommand(pointerTick)),
        },
        {
          // One capability, one item: a bar line starts here, the measure
          // before it is rewritten to end here, and every later bar line
          // counts from here. On 1/16 snap a bar line can land on a
          // sixteenth — the pointer's tick, not the nearest quarter.
          label: 'Make this a downbeat',
          // Tick 0 always starts a bar, and a target already on a bar line
          // with its own signature has nothing to place.
          disabled: downbeatPlan === null || downbeatPlan.status === 'noop',
          onSelect: () => {
            if (!downbeatPlan) return;
            commitBarLinePlan(
              downbeatPlan,
              new PlaceDownbeatCommand(pointerTick),
            );
          },
        },
      ];
    },
    [executeCommand, capabilities, commitBarLinePlan, snappedTickAt],
  );

  /** Build the note context menu (§10): cymbal switch + delete, selection-
   *  aware. Selecting the clicked note first when it isn't already selected. */
  const buildNoteMenu = useCallback(
    (
      scene: ChartScene,
      hit: PianoRollNote,
      trackKey?: TrackKey,
    ): MenuItem[] => {
      const current = getSelectedIds(editStateRef.current, 'note');
      const localCurrent = trackKey
        ? localNoteIdsForTrack(current, trackKey)
        : Array.from(current);
      let targetIds: string[];
      if (localCurrent.includes(hit.id)) {
        targetIds = localCurrent;
      } else {
        targetIds = [hit.id];
        dispatch({
          type: 'SET_SELECTION',
          kind: 'note',
          ids: new Set([
            trackKey ? trackQualifiedNoteId(trackKey, hit.id) : hit.id,
          ]),
        });
      }
      const commandTrackKey =
        trackKey ?? trackKeyFromScope(editStateRef.current.activeScope);

      const byId = new Map(scene.notes.map(n => [n.id, n]));
      const targets = targetIds
        .map(id => byId.get(id))
        .filter((n): n is PianoRollNote => n !== undefined);
      const legalTargets = targets.filter(n => scene.lanes[n.lane]?.cymbalOk);
      const cymbalApplicable = legalTargets.length > 0;
      const commonCymbal =
        cymbalApplicable && legalTargets.every(n => n.cymbal);

      const items: MenuItem[] = [];
      if (isGuitarBassSchema(scene.schema)) {
        const techniques: FretTechnique[] = ['natural', 'strum', 'hopo', 'tap'];
        for (const technique of techniques) {
          const allMatch = targets.every(
            n => techniqueForFlags(n.flags ?? 0) === technique,
          );
          items.push({
            label:
              technique === 'natural'
                ? 'Natural (auto)'
                : technique === 'hopo'
                  ? 'HOPO'
                  : technique[0].toUpperCase() + technique.slice(1),
            checked: allMatch,
            onSelect: () => {
              if (commandTrackKey && scene.schema) {
                executeCommand(
                  new SetNoteTechniqueCommand(
                    targetIds,
                    technique,
                    commandTrackKey,
                    scene.schema,
                  ),
                );
              }
            },
          });
        }
      }
      if (cymbalApplicable) {
        items.push({
          label: commonCymbal ? 'Switch to tom' : 'Switch to cymbal',
          onSelect: () => {
            if (commandTrackKey) {
              executeCommand(
                new ToggleFlagCommand(
                  targetIds,
                  'cymbal',
                  commandTrackKey,
                  scene.schema ?? drums4LaneSchema,
                ),
              );
            }
          },
        });
      }
      items.push({
        label:
          targetIds.length > 1
            ? `Delete ${targetIds.length} notes`
            : 'Delete note',
        danger: true,
        onSelect: () => {
          if (commandTrackKey) {
            executeCommand(
              new DeleteNotesCommand(
                new Set(targetIds),
                commandTrackKey,
                scene.schema ?? undefined,
              ),
            );
          }
        },
      });
      return items;
    },
    [dispatch, executeCommand],
  );

  /** "Insert note" for the note-lane menu: places a zero-length note on the
   *  right-clicked lane at the pointer's grid-snapped tick. Lane → note type
   *  goes through the same `prospectiveNoteAt` the place tool's ghost uses,
   *  and it commits the same `AddNoteCommand`, so a menu insert and a place-
   *  tool click are the same undo step to the stack. Returns null on a
   *  surface that can't add notes, or when the pointer isn't over a lane —
   *  including a null `geo`, which is how the stacked layout reports "this y
   *  is between rows, not inside one". */
  const buildInsertNoteItem = useCallback(
    (
      x: number,
      y: number,
      noteScene: ChartScene,
      geo: LaneGeometry | null,
      trackKey: TrackKey | null,
    ): MenuItem | null => {
      if (
        !capabilities.showEditingControls ||
        !capabilities.editableEntities.has('note') ||
        !noteScene.schema ||
        !trackKey ||
        !geo
      ) {
        return null;
      }
      const lane = laneAtY(y, geo);
      if (lane === null) return null;
      const schema = noteScene.schema;
      // Clamped like the section/tempo add paths: the view can pan left of 0.
      const tick = Math.max(0, snappedTickAt(x));
      const prospective = prospectiveNoteAt(lane, tick, schema);
      return {
        label: 'Insert note',
        onSelect: () =>
          executeCommand(
            new AddNoteCommand(
              {
                tick: prospective.tick,
                type: prospective.type,
                length: 0,
                flags: prospective.flags,
              },
              trackKey,
              schema,
            ),
          ),
      };
    },
    [capabilities, executeCommand, snappedTickAt],
  );

  // Waveform-source picker menu (§11): radio-style list of the project's audio
  // sources, current one checked. Shared by the waveform-row right-click and
  // the corner chip.
  const buildSourceMenu = useCallback(
    (): MenuItem[] =>
      waveSources.map(s => ({
        label: s.label,
        checked: s.id === selectedSourceId,
        onSelect: () => setSelectedSourceId(s.id),
      })),
    [waveSources, selectedSourceId],
  );

  /** Open the inline text editor at canvas position `(x, y)`, prefilled
   *  with `initialText`. `onCommit` runs on Enter or blur with the input's
   *  final text; Escape cancels without calling it. */
  const openInlineTextEditor = useCallback(
    (
      x: number,
      y: number,
      initialText: string,
      onCommit: (text: string) => void,
    ) => {
      inlineTextEditorCancelledRef.current = false;
      setInlineTextEditor({x, y, initialText, onCommit});
    },
    [],
  );

  /** Build the section strip's context menu (item 19): mirrors
   *  `buildTempoMenu`'s hit-vs-empty split. Right-clicking an existing
   *  flag offers rename/delete (the strip's other gestures are
   *  drag-to-move and click-to-seek); empty
   *  ruler space offers "Add section here" at the clicked tick, snapped
   *  per the current grid setting (`snappedTickAt`). Rename/add reuse the
   *  shared inline `<input>` overlay (`openInlineTextEditor`) rather than a
   *  new overlay type.
   *
   *  Returns [] on a surface that can't edit sections (the preview viewer),
   *  the way `buildTempoMenu` gates its structural items: offering menu
   *  entries the session's `isCommandAllowed` would then drop is worse than
   *  offering no menu. */
  const buildSectionMenu = useCallback(
    (x: number, y: number, scene: ChartScene): MenuItem[] => {
      if (
        !capabilities.showEditingControls ||
        !capabilities.editableEntities.has('section')
      ) {
        return [];
      }
      const canvas = canvasRef.current;
      const hit = canvas ? hitSection(canvas, x, viewRef.current, scene) : null;
      if (hit) {
        return [
          {
            label: 'Rename section…',
            onSelect: () =>
              openInlineTextEditor(x, y, hit.name, text => {
                const trimmed = text.trim();
                if (trimmed && trimmed !== hit.name) {
                  executeCommand(
                    new RenameSectionCommand(hit.tick, hit.name, trimmed),
                  );
                }
              }),
          },
          {
            label: 'Delete section',
            danger: true,
            onSelect: () =>
              executeCommand(new DeleteSectionCommand(hit.tick, hit.name)),
          },
        ];
      }
      // Clamped like the section drag path: the view can pan left of tick 0.
      const tick = Math.max(0, snappedTickAt(x));
      const positionMs = tickToMs(tick, scene.timedTempos, scene.resolution);
      const loopRegion = editStateRef.current.loopRegion;
      // The A/B rule (`loopStartRegionAt`/`loopEndRegionAt`) at the
      // right-clicked position rather than the playhead — with no start set
      // yet, this offers "start" (which auto-places an end); once a start
      // exists, it offers "end" to place the matching marker. "Clear loop"
      // stays on the shaded band's own menu (`buildLoopMenu`).
      const loopItem: MenuItem =
        loopRegion === null
          ? {
              label: 'Set repeat loop start',
              onSelect: () =>
                dispatch({
                  type: 'SET_LOOP_REGION',
                  region: loopStartRegionAt(positionMs, loopRegion),
                }),
            }
          : {
              label: 'Set repeat loop end',
              onSelect: () =>
                dispatch({
                  type: 'SET_LOOP_REGION',
                  region: loopEndRegionAt(positionMs, loopRegion),
                }),
            };
      return [
        {
          label: 'Add section here',
          onSelect: () =>
            openInlineTextEditor(x, y, '', text => {
              const trimmed = text.trim();
              if (trimmed) {
                executeCommand(new AddSectionCommand(tick, trimmed));
              }
            }),
        },
        loopItem,
      ];
    },
    [
      capabilities,
      dispatch,
      executeCommand,
      openInlineTextEditor,
      snappedTickAt,
    ],
  );

  /** "Clear loop" for a right-click inside the A/B loop's shaded band.
   *  Returns [] outside the band, so the ruler falls through to its section
   *  menu. */
  const buildLoopMenu = useCallback(
    (x: number): MenuItem[] => {
      if (
        !isInsideLoopShade(editStateRef.current.loopRegion, viewRef.current, x)
      ) {
        return [];
      }
      return [
        {
          label: 'Clear loop',
          onSelect: () => dispatch({type: 'SET_LOOP_REGION', region: null}),
        },
      ];
    },
    [dispatch],
  );

  /** Build the lyrics row's context menu (Round 2 §2): a chip's edit/delete,
   *  a phrase band's delete/add-lyric, or empty row space's add-phrase — plus
   *  a vocals-waveform show/hide toggle (§5) appended to all three. */
  const buildLyricsMenu = useCallback(
    (x: number, y: number, scene: ChartScene): MenuItem[] => {
      const waveformToggle: MenuItem = {
        label: showVocalsWave ? 'Hide vocals waveform' : 'Show vocals waveform',
        onSelect: () => setShowVocalsWave(v => !v),
      };

      const chipHit = capabilities.selectable.has('lyric')
        ? pickLyricChipAt(
            scene.lyricChips,
            viewRef.current,
            x,
            lyricChipWidthsRef.current,
          )
        : null;
      if (chipHit) {
        return [
          {
            label: 'Edit lyric…',
            onSelect: () =>
              openInlineTextEditor(x, y, chipHit.text, text => {
                const trimmed = text.trim();
                if (trimmed) {
                  executeCommand(
                    new SetLyricTextCommand(
                      chipHit.tick,
                      trimmed,
                      DEFAULT_VOCALS_PART,
                    ),
                  );
                }
              }),
          },
          {
            label: 'Delete lyric',
            danger: true,
            onSelect: () =>
              executeCommand(
                new DeleteLyricCommand(chipHit.tick, DEFAULT_VOCALS_PART),
              ),
          },
          waveformToggle,
        ];
      }

      const clickTick = Math.max(
        0,
        xToTickNoSnap(x, viewRef.current, scene.timedTempos, scene.resolution),
      );
      const band = pickPhraseBandAt(scene.lyricBands, viewRef.current, x);
      if (band) {
        return [
          {
            label: 'Delete phrase',
            danger: true,
            onSelect: () =>
              executeCommand(
                new DeletePhraseCommand(band.tick, DEFAULT_VOCALS_PART),
              ),
          },
          {
            label: 'Add lyric…',
            onSelect: () =>
              openInlineTextEditor(x, y, '', text => {
                const trimmed = text.trim();
                if (trimmed) {
                  executeCommand(
                    new AddLyricCommand(
                      clickTick,
                      trimmed,
                      DEFAULT_VOCALS_PART,
                    ),
                  );
                }
              }),
          },
          waveformToggle,
        ];
      }

      return [
        {
          label: 'Add phrase here',
          onSelect: () =>
            executeCommand(
              new AddPhraseCommand(clickTick, DEFAULT_VOCALS_PART),
            ),
        },
        waveformToggle,
      ];
    },
    [capabilities, executeCommand, openInlineTextEditor, showVocalsWave],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const scene = sceneRef.current;
      if (!scene) return;
      const g = panelGeometry();
      const point = pointFromEvent(e);
      const y = point.y;
      const containerTop =
        containerRef.current?.getBoundingClientRect().top ?? 0;
      const menuY = e.clientY - containerTop;
      const stacked =
        stackedPianoRollRef.current && (scene.rows.length ?? 0) > 1;
      if (stacked && point.rawX < STACKED_GUTTER_W) {
        openStackedViewMenu(point.rawX, menuY);
        return;
      }
      const x = point.x;
      const menuX = stacked ? point.rawX : x;

      // Section strip (the ruler; item 19): an existing flag offers
      // rename/delete, empty space offers "Add section here" at the
      // clicked (snapped) tick. Checked first — it is the narrowest band
      // (0..RULER_H) and would otherwise fall through to the tempo lane's
      // broader `y < g.laneTop` check below.
      if (y <= RULER_H) {
        // The loop band's "Clear loop" wins inside the shading, except on a
        // section flag — a flag's own rename/delete is the more specific
        // target and would otherwise be unreachable inside a loop.
        const onSectionFlag =
          hitSection(
            canvasRef.current ?? e.currentTarget,
            x,
            viewRef.current,
            scene,
          ) !== null;
        const loopItems = onSectionFlag ? [] : buildLoopMenu(x);
        const items = loopItems.length
          ? loopItems
          : buildSectionMenu(x, y, scene);
        openItemsMenu(menuX, menuY, items);
        return;
      }

      // Lyrics row (Round 2 §2/§4/§5): directly under the ruler now.
      if (y > RULER_H && y < g.tempoTop) {
        const items = buildLyricsMenu(x, y, scene);
        openItemsMenu(menuX, menuY, items);
        return;
      }

      // Tempo lane (§7/§8; Round 2 §6's ×2/÷2 structural correction):
      // add/delete markers, mark/unmark downbeats.
      if (y < g.laneTop) {
        const items = buildTempoMenu(x, scene);
        openItemsMenu(menuX, menuY, items);
        return;
      }

      // Waveform row (§11): choose which audio source is displayed.
      if (y >= g.laneBottom) {
        const items = buildSourceMenu();
        // Open above the pointer so the list doesn't spill past the panel's
        // bottom edge.
        const top = Math.max(4, menuY - items.length * 30 - 6);
        openItemsMenu(menuX, top, items);
        return;
      }

      // Note lane (§10). Suppressed while a class-(b) structural preview is up —
      // its items (delete / cymbal toggle) execute against the committed doc,
      // which the read-only preview contract forbids editing.
      const row = stacked ? stackedRowAtY(y) : null;
      const hit = pickAt(x, y);
      if (isStructuralPreview(editStateRef.current)) {
        setMenu(null);
        return;
      }
      const noteScene = row ? sceneForTrackRow(scene, row.row) : scene;
      const noteTrackKey =
        row?.row.key ?? trackKeyFromScope(editStateRef.current.activeScope);
      const items: MenuItem[] = [];
      if (hit && capabilities.selectable.has('note')) {
        items.push(...buildNoteMenu(noteScene, hit, noteTrackKey));
      }
      // Same geometry the place tool resolves for a pointerdown, including
      // its `stacked && !row` bail: in the stacked layout a y that lands in a
      // row's header strip belongs to no row, and
      // the single-track lane geometry would map it to an unrelated lane on
      // the active-scope track.
      const insertGeo: LaneGeometry | null = row
        ? {
            laneTop: row.laneTop,
            laneH: row.laneH,
            laneCount: row.row.lanes.length,
          }
        : stacked
          ? null
          : laneGeometry();
      const insert = buildInsertNoteItem(
        x,
        y,
        noteScene,
        insertGeo,
        noteTrackKey ?? null,
      );
      if (insert) items.push(insert);
      openItemsMenu(menuX, menuY, items);
    },
    [
      buildInsertNoteItem,
      buildLoopMenu,
      buildLyricsMenu,
      buildNoteMenu,
      buildSectionMenu,
      buildSourceMenu,
      buildTempoMenu,
      capabilities,
      laneGeometry,
      openItemsMenu,
      openStackedViewMenu,
      panelGeometry,
      pickAt,
      stackedRowAtY,
      pointFromEvent,
    ],
  );

  // Drop whichever pointer gesture is in flight WITHOUT committing a command
  // (§12's Escape "gesture" tier). Mirrors `endPointer`'s cleanup but never
  // executes/dispatches a move — the eventual real pointerup still fires and
  // sees `pointerMode === 'idle'` already, so its command-commit branches
  // no-op (harmless double cleanup of already-null refs).
  const cancelInFlightGesture = useCallback(() => {
    if (pointerModeRef.current === 'tempo' && tempoDragRef.current) {
      dispatch({type: 'SET_PENDING_TEMPO_CANDIDATE', candidate: null});
    }
    pointerModeRef.current = 'idle';
    scrubbingRef.current = false;
    scrubPointerXRef.current = null;
    noteDragRef.current = null;
    marqueeRef.current = null;
    tempoDragRef.current = null;
    tempoBaseDocRef.current = null;
    tsDragRef.current = null;
    sectionDragRef.current = null;
    loopDragRef.current = null;
    lyricDragRef.current = null;
    phraseEdgeDragRef.current = null;
    pointerStartRef.current = null;
    dirtyRef.current = true;
    drawRef.current(Math.max(0, audioManager.chartTime * 1000));
  }, [dispatch, audioManager]);

  // Cancel an in-flight editing gesture the moment the committed doc identity
  // changes out from under it (0061 §7's invalidation rule). A command, undo,
  // or redo — dispatched from a hotkey, the highway, or anywhere else while the
  // pointer is down here — replaces `state.chartDoc`, but the gesture captured
  // its base against the PREVIOUS doc: `tempoBaseDocRef` for a marker drag,
  // note-drag anchors, the marquee's base selection, the section's original
  // tick. Re-previewing or committing against the new doc would desync the
  // views from the undo stack (e.g. a tempo drag would re-dispatch a candidate
  // from a stale base and commit against the post-undo doc). Dropping the
  // gesture without committing is the safe response; the eventual pointerup
  // sees `pointerMode === 'idle'` and its commit branches no-op.
  //
  // A normal same-gesture commit (pointerup → executeCommand) is NOT caught
  // here: `endPointer` sets `pointerMode = 'idle'` synchronously right after
  // dispatching, before this effect runs on the committed render. Resize and
  // scrub hold no doc reference, so they're left alone.
  const committedDocRef = useRef(chartDoc);
  useEffect(() => {
    if (committedDocRef.current === chartDoc) return;
    committedDocRef.current = chartDoc;
    const mode = pointerModeRef.current;
    if (mode !== 'idle' && mode !== 'resize' && mode !== 'scrub') {
      cancelInFlightGesture();
    }
  }, [chartDoc, cancelInFlightGesture]);

  // Escape/pointerdown dismissal (§12). A **capture-phase** listener on
  // `window` runs ahead of the hotkey registry's `document` bubble listener
  // (capture order is window -> ... -> document -> ... -> target -> ...
  // -> document -> window for bubble; a capture listener on window is the
  // very first thing to see the event). Consuming Escape here — closing the
  // menu, or cancelling an in-flight gesture — and calling
  // `stopPropagation()` prevents the global "clear selection" hotkey
  // (`useEditorKeyboard`) from ALSO firing on the same keypress. With
  // neither the menu nor a gesture active, `resolveEscapeTier` returns
  // `'none'` and the event is left alone so that global hotkey handles the
  // (correct) third tier — the panel never re-implements it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tier = resolveEscapeTier(
        menu !== null,
        pointerModeRef.current !== 'idle',
      );
      if (tier === 'menu') {
        setMenu(null);
        e.stopPropagation();
      } else if (tier === 'gesture') {
        cancelInFlightGesture();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, {capture: true});
    return () =>
      window.removeEventListener('keydown', onKeyDown, {capture: true});
  }, [menu, cancelInFlightGesture]);

  // The outside-click half of dismissal is the plain shared one; only Escape
  // needs this panel's tier logic above. The tempo lane's entry tools are
  // exempt: a tap session can hold a minute of tapping and a BPM field holds a
  // half-typed number, and `useDismissOnOutsidePointerDown` arms a
  // `{once: true}` listener behind a timer, so a rule that depended on their
  // contents would re-arm click-away dismissal on every change.
  useDismissOnOutsidePointerDown(
    menu !== null && menu.content.kind === 'items',
    closeMenu,
  );

  // -- Structural tempo correction control (61-7) ----------------------------
  // The preview state is DERIVED from the one store: a structural candidate is
  // active whenever `pendingTempoCandidate` carries a class-(b) op (a marker
  // drag uses 'keep-ms'/'keep-ticks' instead). No local mirror, no effect — the
  // hard invalidation rule (any command/undo/redo/reload clears the candidate)
  // then tears the accept/reject bar down for free.
  const structuralOp =
    state.pendingTempoCandidate?.op === 're-predict' ||
    state.pendingTempoCandidate?.op === 'resnap'
      ? state.pendingTempoCandidate.op
      : null;

  // Run the class-(b) RE-PREDICT op ONCE against the current doc and preview its
  // full candidate (warped map + re-snapped notes) through pendingTempoCandidate
  // — the ONE preview channel. No note-ms guard here: the user accepting/
  // rejecting the preview IS the guard (plan 0061 §7).
  const previewStructural = useCallback(
    (correctedSync: Synctrack) => {
      const base = editStateRef.current.chartDoc;
      if (!base) return;
      // Decoded onsets are recorded against the ORIGINAL (unpadded) audio;
      // when leading-silence padding is active, shift them onto the padded
      // timeline before RE-PREDICT re-derives notes from them (0064
      // addendum §7), or the fresh notes land `anchor.ms` early.
      const anchor = getAudioAnchor(base);
      const onsets =
        anchor && decodedOnsets
          ? shiftOnsets(decodedOnsets, anchor.ms)
          : (decodedOnsets ?? null);
      const result = repredictTempo(base, correctedSync, onsets);
      dispatch({
        type: 'SET_PENDING_TEMPO_CANDIDATE',
        candidate: {op: result.op, doc: result.doc},
      });
    },
    [dispatch, decodedOnsets],
  );

  const previewOctave = useCallback(
    (factor: number) => {
      const base = editStateRef.current.chartDoc;
      if (!base) return;
      previewStructural(
        octaveRescaleSync(synctrackFromChart(base.parsedChart), factor),
      );
    },
    [previewStructural],
  );
  // The tempo-lane context menu (built earlier in the file, before this
  // function exists) reads ×2/÷2 through this ref rather than depending on
  // `previewOctave` directly.
  previewOctaveRef.current = previewOctave;

  // Accept: commit EXACTLY the previewed candidate as one EditCommand (no
  // re-run, no drift). The pending-candidate invalidation rule guarantees it's
  // still derived from the live doc. Reject: clear the candidate byte-identically.
  const acceptStructural = useCallback(() => {
    const cand = editStateRef.current.pendingTempoCandidate;
    if (cand) executeCommand(new CommitTempoCandidateCommand(cand.doc));
  }, [executeCommand]);

  const rejectStructural = useCallback(() => {
    dispatch({type: 'SET_PENDING_TEMPO_CANDIDATE', candidate: null});
  }, [dispatch]);

  // -- Panel height resize (§1) -----------------------------------------------
  const panelHeightRef = useRef(panelHeight);
  panelHeightRef.current = panelHeight;

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      pointerModeRef.current = 'resize';
      resizeDragRef.current = {
        startHeight: panelHeightRef.current,
        startY: e.clientY,
      };
    },
    [],
  );

  const handleResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = resizeDragRef.current;
      if (!drag) return;
      // The handle sits above the panel; dragging it UP (negative dy) makes
      // the panel taller — the top edge moves with the pointer.
      const dy = e.clientY - drag.startY;
      setPanelHeight(clampPanelHeight(drag.startHeight - dy));
    },
    [],
  );

  const endResizeDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (resizeDragRef.current) savePanelHeight(panelHeightRef.current);
    resizeDragRef.current = null;
    pointerModeRef.current = 'idle';
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  const stackedLayout = stackedPianoRoll && (scene?.rows.length ?? 0) > 1;
  const stackedSharedHeight = RULER_H + lyricsRowHeight(scene) + TEMPO_H;
  const stackedRowsHeight = stackedLayout
    ? Math.max(0, stackedRowGeometry(scene!, stackedSharedHeight).height)
    : 0;

  return (
    <div
      className={cn('relative flex w-full select-none flex-col', className)}
      style={{height: panelHeight}}>
      {/* Top-edge resize handle (§1): drag to resize, persisted to
          localStorage under one key shared across every host page. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize piano-roll panel"
        aria-valuenow={Math.round(panelHeight)}
        aria-valuemin={MIN_PANEL_HEIGHT}
        aria-valuemax={MAX_PANEL_HEIGHT}
        title="Drag to resize"
        className="group flex h-2.5 shrink-0 cursor-row-resize items-center justify-center gap-[3px] bg-[color:var(--ed-surface-hover,theme(colors.border/70%))] transition-colors hover:bg-accent"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={endResizeDrag}
        onPointerCancel={endResizeDrag}>
        {/* Centered three-dot grip so the bar reads as draggable at a glance.
            Purely decorative — the separator itself carries the accessible
            name and the drag handlers. */}
        {[0, 1, 2].map(i => (
          <span
            key={i}
            aria-hidden="true"
            className="size-[3px] rounded-full bg-muted-foreground/60 transition-colors group-hover:bg-foreground"
          />
        ))}
      </div>
      <div
        ref={containerRef}
        className={cn(
          'relative min-h-0 w-full flex-1',
          stackedLayout ? 'flex flex-col overflow-hidden' : 'overflow-hidden',
        )}>
        {stackedLayout ? (
          <>
            <canvas
              ref={stackedTopCanvasRef}
              data-piano-roll-region="top"
              className="block w-full shrink-0"
              style={{height: stackedSharedHeight}}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endPointer}
              onPointerCancel={endPointer}
              onPointerLeave={handlePointerLeave}
              onContextMenu={handleContextMenu}
            />
            <div
              ref={rowsScrollRef}
              onScroll={handleRowsScroll}
              className="no-scrollbar min-h-0 flex-1 overflow-auto">
              <canvas
                ref={stackedRowsCanvasRef}
                data-piano-roll-region="rows"
                className="block w-full"
                style={{height: stackedRowsHeight}}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={endPointer}
                onPointerCancel={endPointer}
                onPointerLeave={handlePointerLeave}
                onContextMenu={handleContextMenu}
              />
            </div>
            <canvas
              ref={stackedWaveCanvasRef}
              data-piano-roll-region="waveform"
              className="block w-full shrink-0"
              style={{height: WAVE_ROW_H}}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endPointer}
              onPointerCancel={endPointer}
              onPointerLeave={handlePointerLeave}
              onContextMenu={handleContextMenu}
            />
            <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
          </>
        ) : (
          <canvas
            ref={canvasRef}
            className="block w-full"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            onPointerLeave={handlePointerLeave}
            onContextMenu={handleContextMenu}
          />
        )}
        {/* Note anchoring under tempo edits ("glue", §9) is audio-glued
            (KEEP-MS) and no longer user-toggleable (QA round-1). `tempoGlueMode`
            still lives on `ChartEditorContext` (defaults to 'audio') and stays
            settable in code via SET_TEMPO_GLUE_MODE — there is just no UI. The
            playhead follow-anchor (§3) is likewise code-level only now. */}
        {/* Half/double structural-correction preview accept/reject bar (§7).
            The ×2/÷2 triggers themselves live in the tempo lane's right-click
            menu; this bar only appears once a correction is previewed.
            Positioned just below the lyrics row (when present) so it never
            overlaps it. */}
        {structuralOp && (
          <div
            className="absolute left-2 z-40 flex items-center gap-1 text-[11px]"
            style={{
              top: RULER_H + (scene?.lyricsVisible ? LYRICS_ROW_H : 0) + 2,
            }}>
            <span className="rounded bg-popover/90 px-2 py-0.5 text-popover-foreground shadow-sm">
              {structuralOp === 're-predict'
                ? 'Re-predicted tempo (preview)'
                : 'Re-snapped, no audio onsets (preview)'}
            </span>
            <button
              type="button"
              className="rounded border border-border bg-emerald-600/90 px-2 py-0.5 text-white shadow-sm hover:bg-emerald-600"
              onClick={acceptStructural}>
              Accept
            </button>
            <button
              type="button"
              className="rounded border border-border bg-popover/90 px-2 py-0.5 text-popover-foreground shadow-sm hover:bg-accent hover:text-accent-foreground"
              onClick={rejectStructural}>
              Reject
            </button>
          </div>
        )}
        {/* `display: contents` keeps the popover's absolute positioning
            anchored to the container while giving the wheel listener above a
            subtree to bail on. */}
        <div ref={overlayRef} className="contents">
          {menu && (
            <ContextMenuPopover
              x={entryMenu ? entryMenu.clientX : menu.x}
              y={entryMenu ? entryMenu.clientY : menu.y}
              anchor={entryMenu ? 'fixed' : 'absolute'}
              items={
                menu.content.kind === 'items' ? menu.content.items : undefined
              }
              // The tempo lane's entry tools swap the popover's contents
              // instead of running an action, so they are the items that must
              // not close the popover.
              onAfterSelect={closeUnlessEntering}>
              {bpmMenu ? (
                <BpmValuePopover
                  initialBpm={bpmMenu.initialBpm}
                  anchorLabel={bpmMenu.anchorLabel}
                  onCommit={bpm => {
                    executeCommand(
                      new AddBPMCommand(
                        bpmMenu.anchorTick,
                        bpm,
                        editStateRef.current.tempoGlueMode,
                      ),
                    );
                    setMenu(null);
                  }}
                  onCancel={closeMenu}
                />
              ) : tapMenu ? (
                <TapTempoPopover
                  anchorTick={tapMenu.anchorTick}
                  anchorMs={tapMenu.anchorMs}
                  anchorLabel={tapMenu.anchorLabel}
                  audioManager={audioManager}
                  setClickSuppressed={setClickSuppressed}
                  onAccept={bpm => {
                    executeCommand(
                      new AddBPMCommand(
                        tapMenu.anchorTick,
                        bpm,
                        editStateRef.current.tempoGlueMode,
                      ),
                    );
                    setMenu(null);
                  }}
                  onCancel={closeMenu}
                />
              ) : undefined}
            </ContextMenuPopover>
          )}
        </div>
        {/* Lyrics row inline text editor (Round 2 §2): "Edit lyric…" / "Add
            lyric…" position a small `<input>` over the canvas rather than a
            modal. Enter commits; Escape cancels; blur also commits (so the
            input never lingers open with no way to close it). */}
        {inlineTextEditor && (
          <input
            key={`${inlineTextEditor.x}:${inlineTextEditor.y}`}
            autoFocus
            defaultValue={inlineTextEditor.initialText}
            className="absolute z-50 w-28 rounded border border-border bg-popover px-1.5 py-0.5 text-xs text-popover-foreground shadow-md focus:outline-none"
            style={{left: inlineTextEditor.x, top: inlineTextEditor.y}}
            onPointerDown={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                inlineTextEditorCancelledRef.current = true;
                setInlineTextEditor(null);
              }
              e.stopPropagation();
            }}
            onBlur={e => {
              if (inlineTextEditorCancelledRef.current) {
                inlineTextEditorCancelledRef.current = false;
                return;
              }
              inlineTextEditor.onCommit(e.currentTarget.value);
              setInlineTextEditor(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hit-testing (canvas-space)
// ---------------------------------------------------------------------------

function hitSection(
  canvas: HTMLCanvasElement,
  x: number,
  view: PianoRollView,
  scene: ChartScene,
): SectionFlag | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const font = '600 10px system-ui, sans-serif';
  ctx.font = font;
  for (const s of scene.sections) {
    const fx = msToX(s.ms, view);
    const labelW = measureTextWidth(ctx, font, s.name);
    if (x >= fx - 3 && x <= fx + labelW + 12) return s;
  }
  return null;
}

// Re-exported for future readout use (bar.beat position); keeps the pure
// helper wired even though the read-only panel doesn't surface it yet.
export {barBeatAtTick};
