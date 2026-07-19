'use client';

/**
 * Piano-roll timeline — bottom panel for the chart editor (plan 0062).
 *
 * A single DPR-aware canvas-2D panel that replaces the old `WaveformDisplay`
 * strip and the right-side `TimelineMinimap`. Bands, top→bottom: time ruler
 * (bar numbers + section flags), tempo lane (tempo markers + TS chips), five
 * note lanes (kick/red/yellow/blue/green), drum-stem waveform row.
 *
 * Timing authority is `AudioManager` (the same clock the highway reads). The
 * x-axis is real time (`x = (ms - leftMs) * pxPerMs`) so the waveform stays
 * fixed while the grid moves under tempo edits. Chart data (notes, tempos,
 * time signatures, sections, selection, hover) comes from `ChartEditorContext`
 * — the one store; the panel holds only view state (leftMs, pxPerMs, follow).
 *
 * Navigation (62-1): zoom (wheel), pan (shift+wheel / trackpad deltaX), scrub
 * (ruler + waveform), catch-up playhead follow, section-flag click-to-seek.
 *
 * Note editing (62-2): shared selection/hover, note drag (delta-snapped, lane
 * change single-note only, lane-locked multi-drag), left-drag marquee
 * box-select with shift semantics, click-to-add / erase parity with the
 * active tool, and a right-click note context menu (switch tom/cymbal,
 * delete). Every edit dispatches the SAME command the highway uses
 * (`MoveEntitiesCommand`, `AddNoteCommand`, ...) through the shared edit
 * semantics in `../editing/` — the two views cannot construct disagreeing
 * edits.
 *
 * Tempo/downbeat editing (62-3): sparse ◆ markers are draggable (generous hit
 * radius, hover glow, `ew-resize` cursor, dashed ghost line, marker 0
 * immovable). A drag previews live through `pendingTempoCandidate` — the one
 * preview channel — and commits `MoveTempoMarkerCommand` on release, reading
 * the glue mode (KEEP-MS / KEEP-TICKS) from `ChartEditorContext`. The tempo
 * lane's right-click menu adds/deletes markers and marks/unmarks downbeats via
 * the shared command layer (61-3 / 61-6); TS chips derive from the persisted
 * `timeSignatures` (real denominators). A visible glue toggle renders top-right.
 */

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {AudioManager} from '@/lib/preview/audioManager';
import {cn} from '@/lib/utils';
import {
  buildTimedTempos,
  msToTick,
  tickToMs,
} from '@/lib/drum-transcription/timing';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import {
  snapTickToGrid,
  findTrackInParsedChart,
  synctrackFromChart,
  audioExtendedEndTick,
} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import type {Synctrack} from '@/lib/tempo-map/types';
import {
  octaveRescaleSync,
  tapTempoSync,
} from '@/lib/tempo-map/structural-correction';
import {repredictTempo} from '@/lib/drum-transcription/pipeline/repredict';
import type {DecodedOnsetsFile} from '@/lib/drum-transcription/ml/types';
import {useChartEditorContext, selectRenderDoc} from '../ChartEditorContext';
import {getSelectedIds} from '../ChartEditorContext';
import {
  entityContextFromScope,
  isTrackScope,
  trackKeyFromScope,
} from '../scope';
import {useExecuteCommand} from '../hooks/useEditCommands';
import {
  AddNoteCommand,
  AddTempoMarkerCommand,
  DeleteNotesCommand,
  DeleteTempoMarkerCommand,
  MarkDownbeatCommand,
  MoveEntitiesCommand,
  MoveTempoMarkerCommand,
  CommitTempoCandidateCommand,
  ToggleFlagCommand,
  UnmarkDownbeatCommand,
  laneToType,
  defaultFlagsForType,
  LAST_PAD_LANE,
} from '../commands';
import {computeNoteDragDelta, exceedsDragThreshold} from '../editing/gestures';
import {selectNotesInRange} from '../editing/marquee';
import {clampMarkerMs, hitTempoMarker, nearestBeatTick} from './tempoHitTest';
import {
  extractPianoRollNotes,
  LANE_COUNT,
  LANE_CYMBAL_OK,
  PIANO_ROLL_LANES,
  type PianoRollNote,
} from './notes';
import {buildBeatGrid, barBeatAtTick, type GridBeat} from './scene';
import {laneAtY, marqueeBounds, pickNoteAt, type LaneGeometry} from './hitTest';
import {
  fitToWidth,
  followLeftMs,
  glyphWidth,
  msToX,
  panByPx,
  visibleMsRange,
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
import {buildAmpPyramid, sampleAmpRange, type AmpPyramid} from './wavePeaks';
import {resolveEscapeTier} from './escapeRouting';

// ---------------------------------------------------------------------------
// Layout + palette
// ---------------------------------------------------------------------------

const RULER_H = 24;
const TEMPO_H = 26;
const WAVE_ROW_H = 40;

const COLORS = {
  chrome: '#12151c',
  laneBg: '#171b24',
  laneAlt: '#151923',
  rulerBg: '#0d1017',
  rulerInk: '#8b94a5',
  tempoBg: '#10141c',
  gridBar: '#59677c',
  gridBeat: '#3a4557',
  gridSub: '#2a3342',
  waveRow: '#4a6288',
  playhead: '#ff4a57',
  sectionFlag: '#c9a34a',
  tempoNode: '#7ab8ff',
  tempoNodeHot: '#b3d6ff',
  tempoInk: '#a8c8ea',
  laneLabel: '#6b7484',
  ghost: '#f5c742',
} as const;

/** Half-width (px) of a note's pointer hit box around its glyph center. */
const NOTE_HIT_HALF_WIDTH = 8;

const OVERLAY_COLORS = {
  hoverHalo: 'rgba(255,255,255,0.32)',
  marqueeFill: 'rgba(122,184,255,0.14)',
  marqueeStroke: 'rgba(122,184,255,0.7)',
} as const;

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

/** Live note-drag state (piano-roll side; deltas anchored on the grabbed note). */
interface PanelNoteDrag {
  anchorTick: number;
  anchorLane: number;
  tickDelta: number;
  laneDelta: number;
  active: boolean;
}

/** In-flight marquee rectangle in canvas px. */
interface PanelMarquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type PointerMode =
  | 'idle'
  | 'scrub'
  | 'drag'
  | 'marquee'
  | 'erase'
  | 'tempo'
  | 'section'
  | 'resize';

/** One entry in a right-click context menu (§10). */
interface MenuItem {
  label: string;
  disabled?: boolean;
  /** Renders in the destructive (red) style. */
  danger?: boolean;
  onSelect: () => void;
}

/** Open context-menu state (note lane or tempo lane, §7/§8/§10). */
interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/** Live tempo-marker drag state (§7). Deltas anchored on the grabbed marker. */
interface TempoMarkerDrag {
  /** Index of the marker in the (ms-sorted) tempo list. */
  index: number;
  /** Fixed tick of the marker (only its ms moves). */
  markerTick: number;
  /** Original ms position — the dashed ghost line. */
  origMs: number;
  /** Latest clamped ms under the pointer. */
  currentMs: number;
  /** True once the marker has actually moved past its origin. */
  moved: boolean;
}

/** Live section-flag drag state (§6). Grid-snapped, absolute (not delta-snapped
 *  like notes) — mirrors the highway's `useMarkerDrag`'s `screenToTick` snap. */
interface SectionDrag {
  originalTick: number;
  currentTick: number;
  moved: boolean;
}

// ---------------------------------------------------------------------------
// Scene (derived, cached per chartDoc / audio)
// ---------------------------------------------------------------------------

interface TempoMarker {
  tick: number;
  ms: number;
  bpm: number;
}

interface TsChip {
  tick: number;
  ms: number;
  label: string;
}

interface SectionFlag {
  tick: number;
  ms: number;
  name: string;
}

interface ChartScene {
  resolution: number;
  timedTempos: TimedTempo[];
  beats: GridBeat[];
  tempos: TempoMarker[];
  timeSignatures: TsChip[];
  sections: SectionFlag[];
  notes: PianoRollNote[];
  totalMs: number;
  durationMs: number;
  /** Audio-extended beat-grid span (shared with the downbeat commands). */
  endTick: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PianoRollTimelineProps {
  audioManager: AudioManager;
  /** Total song duration in seconds. */
  durationSeconds: number;
  /** Drum-stem PCM for the waveform row (Float32 interleaved). */
  audioData?: Float32Array | undefined;
  /** Number of audio channels (1 or 2). */
  audioChannels?: number | undefined;
  /**
   * Viewport fraction the playhead pins at while following (§3). Default 50%;
   * 20% is a supported value. Exposed as a component prop (never hardcoded) —
   * this is also the initial value of the panel's own live anchor-fraction
   * setting control (top-right), which the user can change without a code
   * change; the prop only seeds the default per host page.
   */
  followAnchor?: number | undefined;
  /**
   * The project's retained decoded onsets (plan 0061 §3a), for the half/double
   * + tap-tempo control's RE-PREDICT op (0061 §7). `null`/absent → a
   * never-transcribed project, so the control falls back to bounded RESNAP with
   * a disclosure. Loaded from OPFS by the host page.
   */
  decodedOnsets?: DecodedOnsetsFile | null | undefined;
  className?: string | undefined;
}

export default function PianoRollTimeline({
  audioManager,
  durationSeconds,
  audioData,
  audioChannels = 2,
  followAnchor = 0.5,
  decodedOnsets,
  className,
}: PianoRollTimelineProps) {
  const {state, dispatch, capabilities} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();
  const chartDoc = state.chartDoc;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [menu, setMenu] = useState<MenuState | null>(null);

  // -- Structural tempo correction (61-7): half/double + tap-tempo re-predict --
  // Captured tap times in AUDIO ms (audioManager.chartTime at each tap), so the
  // fitted BPM + phase align to the recording, not to wall-clock.
  const [tapTimes, setTapTimes] = useState<number[]>([]);

  // -- Panel height (§1): resizable via a top-edge drag handle, persisted to
  // localStorage under one key shared across every host page. Lazily read
  // once on mount (not during SSR — `loadPanelHeight` falls back to the
  // default when there's no `window`).
  const [panelHeight, setPanelHeight] = useState(() => loadPanelHeight());

  // -- Follow anchor-fraction (§3): a live setting surface over the
  // `followAnchor` prop, which only seeds its initial value.
  const [anchorFraction, setAnchorFraction] = useState(followAnchor);

  const viewRef = useRef<
    PianoRollView & {follow: boolean; initialized: boolean}
  >({leftMs: 0, pxPerMs: 0.075, follow: true, initialized: false});
  const sceneRef = useRef<ChartScene | null>(null);
  const ampRef = useRef<AmpPyramid>({levels: [], durationMs: 0});
  const selectionRef = useRef<ReadonlySet<string>>(new Set());
  const hoverIdRef = useRef<string | null>(null);
  const followAnchorRef = useRef(anchorFraction);
  const scrubbingRef = useRef(false);
  const prevPlayingRef = useRef(false);
  const lastPlayheadRef = useRef(-1);
  const dirtyRef = useRef(true);
  const drawRef = useRef<(playheadMs: number) => void>(() => {});

  // -- Note-editing interaction state (refs: no re-render per pointer move) --
  const pointerModeRef = useRef<PointerMode>('idle');
  const pointerStartRef = useRef<{x: number; y: number} | null>(null);
  const noteDragRef = useRef<PanelNoteDrag | null>(null);
  const marqueeRef = useRef<PanelMarquee | null>(null);
  /** Index of the tempo marker under the pointer (idle hover), or -1. */
  const hoverMarkerRef = useRef(-1);
  /** In-flight tempo-marker drag (§7); null when not dragging a marker. */
  const tempoDragRef = useRef<TempoMarkerDrag | null>(null);
  /** The committed doc a live tempo drag previews from (captured at grab). */
  const tempoBaseDocRef = useRef<ChartDocument | null>(null);
  /** In-flight section-flag drag (§6); null when not dragging a section. */
  const sectionDragRef = useRef<SectionDrag | null>(null);
  /** Selection captured at marquee start, for shift-add merging. */
  const marqueeBaseRef = useRef<ReadonlySet<string>>(new Set());
  const marqueeShiftRef = useRef(false);
  /** Panel-height resize drag: the height + pointer y at gesture start. */
  const resizeDragRef = useRef<{startHeight: number; startY: number} | null>(
    null,
  );
  /** Latest state pieces the pointer handlers read without re-subscribing. */
  const editStateRef = useRef(state);
  editStateRef.current = state;

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

    const activeTrack = isTrackScope(state.activeScope)
      ? (findTrackInParsedChart(parsed, state.activeScope.track)?.track ?? null)
      : null;
    const notes = extractPianoRollNotes(activeTrack);
    const maxNoteTick = notes.length ? notes[notes.length - 1].tick : 0;

    const sections: SectionFlag[] = parsed.sections.map(s => ({
      tick: s.tick,
      ms: tickToMs(s.tick, timedTempos, resolution),
      name: s.name,
    }));

    const withMs = (list: {ms: number}[]) =>
      list.reduce((m, x) => Math.max(m, x.ms), 0);
    const lastBeatMs = beats.length ? beats[beats.length - 1].ms : 0;
    const totalMs = Math.max(
      durationMs,
      lastBeatMs,
      withMs(sections),
      notes.length ? tickToMs(maxNoteTick, timedTempos, resolution) : 0,
    );

    return {
      resolution,
      timedTempos,
      beats,
      tempos,
      timeSignatures,
      sections,
      notes,
      totalMs,
      durationMs,
      endTick,
    };
  }, [tempoCache, effectiveDoc, state.activeScope]);

  useEffect(() => {
    sceneRef.current = scene;
    dirtyRef.current = true;
  }, [scene]);

  // -- Waveform peak mip-map (only rebuilt when the audio changes; perf pass —
  // "peaks per zoom bucket" §11, not a single fixed-resolution envelope) -----
  useEffect(() => {
    ampRef.current = buildAmpPyramid(
      audioData,
      audioChannels,
      durationSeconds * 1000,
    );
    dirtyRef.current = true;
  }, [audioData, audioChannels, durationSeconds]);

  // -- Selection push (shared with the highway) ------------------------------
  useEffect(() => {
    selectionRef.current = getSelectedIds(state, 'note');
    dirtyRef.current = true;
  }, [state]);

  // -- Hover push (shared with the highway; note kind only) ------------------
  useEffect(() => {
    hoverIdRef.current =
      state.hovered?.kind === 'note' ? state.hovered.id : null;
    dirtyRef.current = true;
  }, [state.hovered]);

  // The prop only seeds the setting's initial value (§3); once the user has
  // a live anchorFraction, that's what drives follow — updating the ref here
  // (not re-deriving from the prop) is what makes the setting control (below)
  // actually take effect frame-to-frame.
  useEffect(() => {
    followAnchorRef.current = anchorFraction;
  }, [anchorFraction]);

  // -- Draw ------------------------------------------------------------------
  const draw = useCallback((playheadMs: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    if (w <= 0 || h <= 0) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const laneTop = RULER_H + TEMPO_H;
    const laneBottom = h - WAVE_ROW_H;
    const laneH = (laneBottom - laneTop) / LANE_COUNT;
    const view = viewRef.current;
    const scene = sceneRef.current;
    const selection = selectionRef.current;

    // chrome + lane tints
    ctx.fillStyle = COLORS.chrome;
    ctx.fillRect(0, 0, w, h);
    for (let l = 0; l < LANE_COUNT; l++) {
      ctx.fillStyle = l % 2 ? COLORS.laneAlt : COLORS.laneBg;
      ctx.fillRect(0, laneTop + l * laneH, w, laneH);
    }

    if (scene) {
      drawGrid(ctx, w, h, laneTop, laneBottom, view, scene);
      drawNotes(
        ctx,
        w,
        laneTop,
        laneH,
        view,
        scene,
        selection,
        hoverIdRef.current,
        noteDragRef.current,
      );
      drawTempoLane(
        ctx,
        w,
        view,
        scene,
        hoverMarkerRef.current,
        tempoDragRef.current,
      );
      drawRuler(ctx, w, view, scene, laneBottom, sectionDragRef.current);

      // Dashed ghost line at a dragged marker's original position (§7).
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

    // waveform row backdrop + top rule
    ctx.fillStyle = COLORS.rulerBg;
    ctx.fillRect(0, laneBottom, w, WAVE_ROW_H);
    ctx.strokeStyle = COLORS.gridBeat;
    ctx.beginPath();
    ctx.moveTo(0, laneBottom + 0.5);
    ctx.lineTo(w, laneBottom + 0.5);
    ctx.stroke();
    if (scene) {
      drawWave(ctx, w, laneBottom + 3, h - 3, view, ampRef.current);
    }

    drawLaneLabels(ctx, laneTop, laneH);

    // marquee box-select rectangle
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

    // playhead
    const px = msToX(playheadMs, view);
    if (px >= -2 && px <= w + 2) {
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
  }, []);

  drawRef.current = draw;

  // -- Sizing (DPR-aware, ResizeObserver-driven) -----------------------------
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const applySize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

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
  }, [audioManager]);

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

    const drawIfNeeded = () => {
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
          view.leftMs = followLeftMs({
            playheadMs,
            leftMs: view.leftMs,
            pxPerMs: view.pxPerMs,
            viewportWidth: width,
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

  // -- Interaction helpers ---------------------------------------------------
  const viewportWidth = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return 1;
    const dpr = window.devicePixelRatio || 1;
    return canvas.width / dpr;
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

  const seekZone = useCallback((y: number, laneBottom: number) => {
    return y <= RULER_H || y >= laneBottom;
  }, []);

  // -- Note-lane geometry + hit-testing --------------------------------------
  const panelGeometry = useCallback(() => {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const h = canvas ? canvas.height / dpr : 1;
    const w = canvas ? canvas.width / dpr : 1;
    const laneTop = RULER_H + TEMPO_H;
    const laneBottom = h - WAVE_ROW_H;
    const laneH = (laneBottom - laneTop) / LANE_COUNT;
    return {w, h, laneTop, laneBottom, laneH};
  }, []);

  const laneGeometry = useCallback((): LaneGeometry => {
    const g = panelGeometry();
    return {laneTop: g.laneTop, laneH: g.laneH};
  }, [panelGeometry]);

  const pickAt = useCallback(
    (x: number, y: number): PianoRollNote | null => {
      const scene = sceneRef.current;
      if (!scene) return null;
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
    [laneGeometry],
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

  // Shared note selection (shift-aware), mirroring the highway's cursor tool.
  const selectNote = useCallback(
    (id: string, shift: boolean) => {
      const st = editStateRef.current;
      const current = getSelectedIds(st, 'note');
      if (shift) {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        dispatch({type: 'SET_SELECTION', kind: 'note', ids: next});
      } else if (!current.has(id)) {
        dispatch({type: 'SET_SELECTION', kind: 'note', ids: new Set([id])});
      }
    },
    [dispatch],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const scene = sceneRef.current;
      if (!scene) return;
      const view = viewRef.current;
      const w = viewportWidth();
      const pan = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (pan) {
        const deltaPx = e.shiftKey ? e.deltaY || e.deltaX : e.deltaX;
        const next = panByPx(view, deltaPx, w, scene.totalMs);
        view.leftMs = next.leftMs;
        if (audioManager.isPlaying) view.follow = false;
      } else {
        const bounds = zoomBounds(w, scene.totalMs);
        const next = zoomAt(
          view,
          e.nativeEvent.offsetX,
          e.deltaY,
          w,
          scene.totalMs,
          bounds,
        );
        view.leftMs = next.leftMs;
        view.pxPerMs = next.pxPerMs;
      }
      dirtyRef.current = true;
      drawRef.current(Math.max(0, audioManager.chartTime * 1000));
    },
    [audioManager, viewportWidth],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Right-click never scrubs / drags / marquees — it only opens the
      // context menu (handled in onContextMenu). Left button only here (§3/§10).
      if (e.button !== 0) return;
      const canvas = canvasRef.current;
      const scene = sceneRef.current;
      if (!canvas || !scene) return;
      const g = panelGeometry();
      const y = e.nativeEvent.offsetY;
      const x = e.nativeEvent.offsetX;

      // Any new pointer interaction dismisses an open menu (§10).
      setMenu(null);

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
          const hit = hitSection(canvas, x, viewRef.current, scene);
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
        seekTo(xToMs(x, viewRef.current));
        return;
      }

      // Tempo lane: grab a sparse marker and drag to refit the grid (§7).
      // Marker 0 (song-start anchor) is immovable; a miss falls through to
      // nothing (right-click opens the add/downbeat menu instead).
      if (y < g.laneTop) {
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
      const trackKey = trackKeyFromScope(st.activeScope);
      const hit = pickAt(x, y);
      pointerStartRef.current = {x, y};

      if (tool === 'place') {
        if (!trackKey) return;
        const lane = laneAtY(y, laneGeometry());
        if (lane === null) return;
        if (hit) {
          // Toggle: a note already here is removed.
          executeCommand(new DeleteNotesCommand(new Set([hit.id]), trackKey));
        } else {
          const type = laneToType(lane);
          executeCommand(
            new AddNoteCommand(
              {
                tick: snappedTickAt(x),
                type,
                length: 0,
                flags: defaultFlagsForType(type),
              },
              trackKey,
            ),
          );
        }
        return;
      }

      if (tool === 'erase') {
        pointerModeRef.current = 'erase';
        canvas.setPointerCapture(e.pointerId);
        if (hit && trackKey) {
          executeCommand(new DeleteNotesCommand(new Set([hit.id]), trackKey));
        }
        return;
      }

      // Cursor tool: select + drag, or marquee on empty space.
      if (!capabilities.selectable.has('note')) return;
      canvas.setPointerCapture(e.pointerId);

      if (hit) {
        selectNote(hit.id, e.shiftKey);
        dispatch({type: 'SET_HOVER', hovered: {kind: 'note', id: hit.id}});
        if (capabilities.draggable.has('note')) {
          pointerModeRef.current = 'drag';
          noteDragRef.current = {
            anchorTick: hit.tick,
            anchorLane: hit.lane,
            tickDelta: 0,
            laneDelta: 0,
            active: false,
          };
        }
        return;
      }

      // Empty space: begin a marquee (plain click on empty clears selection).
      if (!e.shiftKey) {
        dispatch({type: 'SET_SELECTION', kind: 'note', ids: new Set()});
      }
      pointerModeRef.current = 'marquee';
      marqueeRef.current = {x0: x, y0: y, x1: x, y1: y};
      marqueeBaseRef.current = e.shiftKey
        ? new Set(getSelectedIds(st, 'note'))
        : new Set();
      marqueeShiftRef.current = e.shiftKey;
    },
    [
      audioManager,
      capabilities,
      dispatch,
      executeCommand,
      laneGeometry,
      panelGeometry,
      pickAt,
      seekTo,
      seekZone,
      selectNote,
      snappedTickAt,
    ],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const scene = sceneRef.current;
      if (!canvas || !scene) return;
      const g = panelGeometry();
      const y = e.nativeEvent.offsetY;
      const x = e.nativeEvent.offsetX;
      const mode = pointerModeRef.current;

      if (mode === 'scrub') {
        seekTo(xToMs(x, viewRef.current));
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

      // Live note drag: delta-snapped, lane change single-note only.
      if (mode === 'drag' && noteDragRef.current) {
        const start = pointerStartRef.current;
        const drag = noteDragRef.current;
        const dx = start ? x - start.x : 0;
        const dy = start ? y - start.y : 0;
        if (drag.active || exceedsDragThreshold(dx, dy)) {
          const {tickDelta, laneDelta} = computeNoteDragDelta({
            anchorTick: drag.anchorTick,
            anchorLane: drag.anchorLane,
            snappedCursorTick: snappedTickAt(x),
            cursorLane: laneAtY(y, laneGeometry()),
            selectionSize: getSelectedIds(editStateRef.current, 'note').size,
            prevLaneDelta: drag.laneDelta,
            minPadLane: 1,
            maxPadLane: LAST_PAD_LANE,
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

      // Live marquee: select notes inside the box (shift merges).
      if (mode === 'marquee' && marqueeRef.current) {
        marqueeRef.current = {...marqueeRef.current, x1: x, y1: y};
        const bounds = marqueeBounds(
          marqueeRef.current,
          viewRef.current,
          laneGeometry(),
        );
        const inBox = selectNotesInRange(
          scene.notes.map(n => ({
            tick: n.tick,
            type: laneToType(n.lane),
            length: 0,
            flags: {},
          })),
          bounds,
          scene.timedTempos,
          scene.resolution,
        );
        const merged = new Set(marqueeBaseRef.current);
        inBox.forEach(id => merged.add(id));
        dispatch({type: 'SET_SELECTION', kind: 'note', ids: merged});
        dirtyRef.current = true;
        drawRef.current(Math.max(0, audioManager.chartTime * 1000));
        return;
      }

      // Paint-erase while dragging with the erase tool.
      if (mode === 'erase') {
        const trackKey = trackKeyFromScope(editStateRef.current.activeScope);
        const hit = pickAt(x, y);
        if (hit && trackKey) {
          executeCommand(new DeleteNotesCommand(new Set([hit.id]), trackKey));
        }
        return;
      }

      // Idle hover: cursor + shared hover highlight.
      const clearMarkerHover = () => {
        if (hoverMarkerRef.current !== -1) {
          hoverMarkerRef.current = -1;
          dirtyRef.current = true;
          drawRef.current(Math.max(0, audioManager.chartTime * 1000));
        }
      };
      if (seekZone(y, g.laneBottom)) {
        // A section flag under the cursor is both click-to-seek and
        // draggable (§6) — `grab` signals the latter; elsewhere in the
        // scrub zones it's a plain seek target.
        const overSection =
          y <= RULER_H && hitSection(canvas, x, viewRef.current, scene);
        canvas.style.cursor = overSection ? 'grab' : 'pointer';
        clearMarkerHover();
        if (hoverIdRef.current !== null) {
          dispatch({type: 'SET_HOVER', hovered: null});
        }
        return;
      }
      // Tempo lane: hover a marker (glow + ew-resize cursor, §7).
      if (y < g.laneTop) {
        const k = hitTempoMarker(scene.tempos, viewRef.current, x);
        const hoverK = k > 0 ? k : -1;
        canvas.style.cursor = hoverK >= 0 ? 'ew-resize' : 'default';
        if (hoverK !== hoverMarkerRef.current) {
          hoverMarkerRef.current = hoverK;
          dirtyRef.current = true;
          drawRef.current(Math.max(0, audioManager.chartTime * 1000));
        }
        return;
      }
      clearMarkerHover();
      const hovered = pickAt(x, y);
      canvas.style.cursor = hovered ? 'grab' : 'default';
      const nextId = hovered ? hovered.id : null;
      if (nextId !== hoverIdRef.current) {
        dispatch({
          type: 'SET_HOVER',
          hovered: hovered ? {kind: 'note', id: hovered.id} : null,
        });
      }
    },
    [
      audioManager,
      dispatch,
      executeCommand,
      laneGeometry,
      panelGeometry,
      pickAt,
      seekTo,
      seekZone,
      snappedTickAt,
    ],
  );

  const endPointer = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const mode = pointerModeRef.current;
      const canvas = canvasRef.current;

      if (mode === 'drag' && noteDragRef.current) {
        const drag = noteDragRef.current;
        if (drag.active && (drag.tickDelta !== 0 || drag.laneDelta !== 0)) {
          const st = editStateRef.current;
          const ids = Array.from(getSelectedIds(st, 'note'));
          if (ids.length > 0) {
            executeCommand(
              new MoveEntitiesCommand(
                'note',
                ids,
                drag.tickDelta,
                drag.laneDelta,
                entityContextFromScope(st.activeScope),
              ),
            );
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

      scrubbingRef.current = false;
      pointerModeRef.current = 'idle';
      noteDragRef.current = null;
      tempoDragRef.current = null;
      tempoBaseDocRef.current = null;
      sectionDragRef.current = null;
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

  // -- Context menus (§7 / §8 / §10) -----------------------------------------
  /** Build the tempo-lane menu (§7 delete-marker; §7/§8 add-marker + downbeat
   *  toggle) at screen x. Returns [] when nothing actionable is under x. */
  const buildTempoMenu = useCallback(
    (x: number, scene: ChartScene): MenuItem[] => {
      const view = viewRef.current;
      const k = hitTempoMarker(scene.tempos, view, x);
      if (k >= 0) {
        const marker = scene.tempos[k];
        return [
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
      // Empty lane: add a marker on the current tempo line, or toggle the
      // downbeat, at the nearest beat.
      const beatTick = nearestBeatTick(scene.beats, view, x);
      if (beatTick === null) return [];
      const hasMarker = scene.tempos.some(t => t.tick === beatTick);
      const isDownbeat = editStateRef.current.downbeatFlags.downbeats.some(
        d => d.tick === beatTick,
      );
      return [
        {
          label: 'Add tempo marker here',
          disabled: hasMarker,
          onSelect: () => executeCommand(new AddTempoMarkerCommand(beatTick)),
        },
        {
          label: isDownbeat ? 'Remove downbeat' : 'Mark as downbeat',
          // Beat 0 is always a downbeat and never removable (§8).
          disabled: beatTick === 0,
          onSelect: () =>
            executeCommand(
              isDownbeat
                ? new UnmarkDownbeatCommand(beatTick, scene.endTick)
                : new MarkDownbeatCommand(beatTick, scene.endTick),
            ),
        },
      ];
    },
    [executeCommand],
  );

  /** Build the note context menu (§10): cymbal switch + delete, selection-
   *  aware. Selecting the clicked note first when it isn't already selected. */
  const buildNoteMenu = useCallback(
    (scene: ChartScene, hit: PianoRollNote): MenuItem[] => {
      const current = getSelectedIds(editStateRef.current, 'note');
      let targetIds: string[];
      if (current.has(hit.id)) {
        targetIds = Array.from(current);
      } else {
        targetIds = [hit.id];
        dispatch({type: 'SET_SELECTION', kind: 'note', ids: new Set([hit.id])});
      }

      const byId = new Map(scene.notes.map(n => [n.id, n]));
      const targets = targetIds
        .map(id => byId.get(id))
        .filter((n): n is PianoRollNote => n !== undefined);
      const legalTargets = targets.filter(n => LANE_CYMBAL_OK[n.lane]);
      const cymbalApplicable = legalTargets.length > 0;
      const commonCymbal =
        cymbalApplicable && legalTargets.every(n => n.cymbal);

      const items: MenuItem[] = [];
      if (cymbalApplicable) {
        items.push({
          label: commonCymbal ? 'Switch to tom' : 'Switch to cymbal',
          onSelect: () => {
            const trackKey = trackKeyFromScope(
              editStateRef.current.activeScope,
            );
            if (trackKey) {
              executeCommand(
                new ToggleFlagCommand(targetIds, 'cymbal', trackKey),
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
          const trackKey = trackKeyFromScope(editStateRef.current.activeScope);
          if (trackKey) {
            executeCommand(
              new DeleteNotesCommand(new Set(targetIds), trackKey),
            );
          }
        },
      });
      return items;
    },
    [dispatch, executeCommand],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const scene = sceneRef.current;
      if (!scene) return;
      const g = panelGeometry();
      const y = e.nativeEvent.offsetY;
      const x = e.nativeEvent.offsetX;

      // Tempo lane (§7/§8): add/delete markers, mark/unmark downbeats.
      if (y > RULER_H && y < g.laneTop) {
        const items = buildTempoMenu(x, scene);
        setMenu(items.length ? {x, y, items} : null);
        return;
      }

      // Ruler / waveform rows carry no menu.
      if (y <= RULER_H || y >= g.laneBottom) {
        setMenu(null);
        return;
      }

      // Note lane (§10). Suppressed while a class-(b) structural preview is up —
      // its items (delete / cymbal toggle) execute against the committed doc,
      // which the read-only preview contract forbids editing.
      const hit = pickAt(x, y);
      if (!hit || !capabilities.selectable.has('note') || isStructuralPreview(editStateRef.current)) {
        setMenu(null);
        return;
      }
      setMenu({x, y, items: buildNoteMenu(scene, hit)});
    },
    [buildNoteMenu, buildTempoMenu, capabilities, panelGeometry, pickAt],
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
    noteDragRef.current = null;
    marqueeRef.current = null;
    tempoDragRef.current = null;
    tempoBaseDocRef.current = null;
    sectionDragRef.current = null;
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
    if (!menu) {
      return () =>
        window.removeEventListener('keydown', onKeyDown, {capture: true});
    }
    const onDown = () => setMenu(null);
    // Defer so the opening right-click doesn't immediately dismiss it.
    const t = window.setTimeout(() => {
      window.addEventListener('pointerdown', onDown, {once: true});
    }, 0);
    return () => {
      window.removeEventListener('keydown', onKeyDown, {capture: true});
      window.removeEventListener('pointerdown', onDown);
      window.clearTimeout(t);
    };
  }, [menu, cancelInFlightGesture]);

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
      const result = repredictTempo(base, correctedSync, decodedOnsets ?? null);
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

  const captureTap = useCallback(() => {
    const ms = Math.max(0, audioManager.chartTime * 1000);
    setTapTimes(prev => [...prev, ms]);
  }, [audioManager]);

  const applyTaps = useCallback(() => {
    if (tapTimes.length < 2) return;
    const base = editStateRef.current.chartDoc;
    if (!base) return;
    // The taps must span a positive audio interval (captured during playback);
    // if they don't (all identical), fitTapTempo would throw — bail quietly.
    if (tapTimes[tapTimes.length - 1] - tapTimes[0] <= 0) return;
    previewStructural(tapTempoSync(tapTimes, base.parsedChart.timeSignatures));
    setTapTimes([]);
  }, [tapTimes, previewStructural]);

  // Accept: commit EXACTLY the previewed candidate as one EditCommand (no
  // re-run, no drift). The pending-candidate invalidation rule guarantees it's
  // still derived from the live doc. Reject: clear the candidate byte-identically.
  const acceptStructural = useCallback(() => {
    const cand = editStateRef.current.pendingTempoCandidate;
    if (cand) executeCommand(new CommitTempoCandidateCommand(cand.doc));
    setTapTimes([]);
  }, [executeCommand]);

  const rejectStructural = useCallback(() => {
    dispatch({type: 'SET_PENDING_TEMPO_CANDIDATE', candidate: null});
  }, [dispatch]);

  const canStructural =
    !!chartDoc && !structuralOp && capabilities.showEditingControls;

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
        className="h-1.5 shrink-0 cursor-row-resize bg-border/70 transition-colors hover:bg-accent"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={endResizeDrag}
        onPointerCancel={endResizeDrag}
      />
      <div ref={containerRef} className="relative min-h-0 w-full flex-1">
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onContextMenu={handleContextMenu}
        />
        {/* Glue toggle (§9): which op a class-(a) tempo command runs. Context
            state, resets to audio-glued per load — the panel only renders it. */}
        <button
          type="button"
          className="absolute right-2 top-1 z-40 rounded border border-border bg-popover/90 px-2 py-0.5 text-[11px] text-popover-foreground shadow-sm hover:bg-accent hover:text-accent-foreground"
          onClick={() =>
            dispatch({
              type: 'SET_TEMPO_GLUE_MODE',
              mode: state.tempoGlueMode === 'audio' ? 'grid' : 'audio',
            })
          }>
          Notes: glued to {state.tempoGlueMode === 'audio' ? 'audio' : 'grid'}
        </button>
        {/* Follow anchor-fraction setting surface (§3): a live control over
            the followAnchor prop's initial value. */}
        <select
          aria-label="Playhead follow anchor"
          title="Where the playhead pins in the viewport while following"
          className="absolute right-2 top-7 z-40 rounded border border-border bg-popover/90 px-1 py-0.5 text-[11px] text-popover-foreground shadow-sm"
          value={anchorFraction}
          onChange={e => setAnchorFraction(Number.parseFloat(e.target.value))}>
          <option value={0.2}>Anchor 20%</option>
          <option value={0.5}>Anchor 50%</option>
          <option value={0.8}>Anchor 80%</option>
        </select>
        {/* Half/double + tap-tempo structural correction (§7). Sits in the tempo
          lane's control slot; a preview swaps it for an accept/reject bar. */}
        <div className="absolute left-2 top-1 z-40 flex items-center gap-1 text-[11px]">
          {structuralOp ? (
            <>
              <span className="rounded bg-popover/90 px-2 py-0.5 text-popover-foreground shadow-sm">
                {structuralOp === 're-predict'
                  ? 'Re-predicted tempo — preview'
                  : 'Re-snapped (no audio onsets) — preview'}
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
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={!canStructural}
                className="rounded border border-border bg-popover/90 px-2 py-0.5 text-popover-foreground shadow-sm hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
                title="Double the tempo (half-time → real time), then re-predict"
                onClick={() => previewOctave(2)}>
                ×2
              </button>
              <button
                type="button"
                disabled={!canStructural}
                className="rounded border border-border bg-popover/90 px-2 py-0.5 text-popover-foreground shadow-sm hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
                title="Halve the tempo (double-time → real time), then re-predict"
                onClick={() => previewOctave(0.5)}>
                ÷2
              </button>
              <button
                type="button"
                disabled={!canStructural}
                className="rounded border border-border bg-popover/90 px-2 py-0.5 text-popover-foreground shadow-sm hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
                title="Tap along ~4 beats (during playback), then Apply"
                onClick={captureTap}>
                Tap{tapTimes.length > 0 ? ` (${tapTimes.length})` : ''}
              </button>
              {tapTimes.length >= 2 && (
                <button
                  type="button"
                  disabled={!canStructural}
                  className="rounded border border-border bg-popover/90 px-2 py-0.5 text-popover-foreground shadow-sm hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={applyTaps}>
                  Apply taps
                </button>
              )}
              {tapTimes.length > 0 && (
                <button
                  type="button"
                  className="rounded border border-border bg-popover/90 px-1.5 py-0.5 text-popover-foreground shadow-sm hover:bg-accent hover:text-accent-foreground"
                  title="Clear taps"
                  onClick={() => setTapTimes([])}>
                  ✕
                </button>
              )}
            </>
          )}
        </div>
        {menu && (
          <div
            className="absolute z-50 min-w-[160px] rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-md"
            style={{left: menu.x, top: menu.y}}
            onPointerDown={e => e.stopPropagation()}>
            {menu.items.map((item, i) => (
              <button
                key={i}
                type="button"
                disabled={item.disabled}
                className={cn(
                  'block w-full px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
                  item.danger && 'text-red-400',
                )}
                onClick={() => {
                  if (item.disabled) return;
                  item.onSelect();
                  setMenu(null);
                }}>
                {item.label}
              </button>
            ))}
          </div>
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
  ctx.font = '600 10px system-ui, sans-serif';
  for (const s of scene.sections) {
    const fx = msToX(s.ms, view);
    const labelW = ctx.measureText(s.name).width;
    if (x >= fx - 3 && x <= fx + labelW + 12) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Drawing bands
// ---------------------------------------------------------------------------

function drawGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  laneTop: number,
  laneBottom: number,
  view: PianoRollView,
  scene: ChartScene,
): void {
  const [msA, msB] = visibleMsRange(view, w);
  const beats = scene.beats;
  // Visible beat window.
  let a = 0;
  while (a < beats.length && beats[a].ms < msA - 50) a++;
  let b = beats.length - 1;
  while (b > a && beats[b].ms > msB + 50) b--;
  const visibleCount = Math.max(1, b - a);
  const avgBeatPx = w / visibleCount;

  ctx.lineWidth = 1;
  for (let i = a; i <= b && i < beats.length; i++) {
    const beat = beats[i];
    const x = Math.round(msToX(beat.ms, view)) + 0.5;
    if (beat.isDownbeat) {
      ctx.strokeStyle = COLORS.gridBar;
      ctx.beginPath();
      ctx.moveTo(x, RULER_H);
      ctx.lineTo(x, laneBottom);
      ctx.stroke();
      ctx.strokeStyle = COLORS.gridSub;
      ctx.beginPath();
      ctx.moveTo(x, laneBottom);
      ctx.lineTo(x, h);
      ctx.stroke();
    } else if (avgBeatPx > 10) {
      ctx.strokeStyle = COLORS.gridBeat;
      ctx.beginPath();
      ctx.moveTo(x, laneTop);
      ctx.lineTo(x, laneBottom);
      ctx.stroke();
    }
    // Subdivisions appear progressively with zoom.
    if (i + 1 < beats.length && avgBeatPx > 46) {
      const per = avgBeatPx > 110 ? 4 : 2;
      ctx.strokeStyle = COLORS.gridSub;
      const beatMs = beat.ms;
      const nextMs = beats[i + 1].ms;
      for (let s = 1; s < per; s++) {
        const sx =
          Math.round(msToX(beatMs + ((nextMs - beatMs) * s) / per, view)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(sx, laneTop);
        ctx.lineTo(sx, laneBottom);
        ctx.stroke();
      }
    }
  }
}

function drawNotes(
  ctx: CanvasRenderingContext2D,
  w: number,
  laneTop: number,
  laneH: number,
  view: PianoRollView,
  scene: ChartScene,
  selection: ReadonlySet<string>,
  hoverId: string | null,
  drag: PanelNoteDrag | null,
): void {
  const [msA, msB] = visibleMsRange(view, w);
  const nh = Math.min(laneH - 6, 13);
  // Local ms-per-tick near the viewport center for glyph sizing.
  const centerMs = (msA + msB) / 2;
  const centerTick = msToTick(centerMs, scene.timedTempos, scene.resolution);
  const msPerTick =
    (tickToMs(
      centerTick + scene.resolution,
      scene.timedTempos,
      scene.resolution,
    ) -
      tickToMs(centerTick, scene.timedTempos, scene.resolution)) /
    scene.resolution;
  const nw = glyphWidth({
    gridStepTicks: scene.resolution / 4,
    msPerTick,
    pxPerMs: view.pxPerMs,
    glyphHeight: nh,
  });

  const dragActive = drag?.active === true;
  const halfW = Math.max(nw, nh) / 2 + 2.5;
  for (const note of scene.notes) {
    const selected = selection.has(note.id);
    // Drag preview: selected notes render at their would-be drop position.
    let lane = note.lane;
    let tick = note.tick;
    let cymbal = note.cymbal;
    if (dragActive && selected) {
      tick = Math.max(0, note.tick + drag.tickDelta);
      if (drag.laneDelta !== 0 && note.lane > 0) {
        lane = Math.max(
          1,
          Math.min(LANE_COUNT - 1, note.lane + drag.laneDelta),
        );
      }
      // Would-be drop on an illegal lane renders as a tom (§6 affordance).
      cymbal = cymbal && LANE_CYMBAL_OK[lane];
    }
    const ms = tickToMs(tick, scene.timedTempos, scene.resolution);
    if (ms < msA - 50 && !(dragActive && selected)) continue;
    if (ms > msB + 50 && !(dragActive && selected)) {
      // Notes are tick-sorted, so when nothing is dragging nothing later is
      // visible; during a drag a selected note may be shifted off-window so
      // we keep scanning.
      if (!dragActive) break;
      continue;
    }
    const x = msToX(ms, view);
    const cy = laneTop + lane * laneH + laneH / 2;
    if (selected) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      roundRect(ctx, x - halfW, cy - nh / 2 - 2.5, halfW * 2, nh + 5, 3);
      ctx.fill();
    } else if (note.id === hoverId) {
      ctx.fillStyle = OVERLAY_COLORS.hoverHalo;
      roundRect(ctx, x - halfW, cy - nh / 2 - 2.5, halfW * 2, nh + 5, 3);
      ctx.fill();
    }
    ctx.fillStyle = PIANO_ROLL_LANES[lane].color;
    if (cymbal) {
      ctx.beginPath();
      ctx.moveTo(x, cy - nh * 0.62);
      ctx.lineTo(x + nw * 0.6, cy + nh * 0.5);
      ctx.lineTo(x - nw * 0.6, cy + nh * 0.5);
      ctx.closePath();
      ctx.fill();
    } else {
      roundRect(ctx, x - nw / 2, cy - nh / 2, nw, nh, Math.min(2.5, nw / 3));
      ctx.fill();
    }
  }
}

function drawTempoLane(
  ctx: CanvasRenderingContext2D,
  w: number,
  view: PianoRollView,
  scene: ChartScene,
  hoverMarker: number,
  tempoDrag: TempoMarkerDrag | null,
): void {
  ctx.fillStyle = COLORS.tempoBg;
  ctx.fillRect(0, RULER_H, w, TEMPO_H);
  ctx.strokeStyle = COLORS.gridBeat;
  ctx.beginPath();
  ctx.moveTo(0, RULER_H + TEMPO_H + 0.5);
  ctx.lineTo(w, RULER_H + TEMPO_H + 0.5);
  ctx.stroke();

  const cy = RULER_H + TEMPO_H * 0.62;
  ctx.font = '600 9.5px ui-monospace, Menlo, monospace';
  for (let k = 0; k < scene.tempos.length; k++) {
    const marker = scene.tempos[k];
    const x = msToX(marker.ms, view);
    if (x < -60 || x > w + 20) continue;
    // Marker 0 (song-start anchor) is never a drag/hover target.
    const hot = k > 0 && (hoverMarker === k || tempoDrag?.index === k);
    if (hot) {
      ctx.fillStyle = 'rgba(122,184,255,0.25)';
      ctx.beginPath();
      ctx.arc(x, cy, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = hot ? COLORS.tempoNodeHot : COLORS.tempoNode;
    ctx.beginPath();
    ctx.moveTo(x, cy - 5.5);
    ctx.lineTo(x + 5, cy);
    ctx.lineTo(x, cy + 5.5);
    ctx.lineTo(x - 5, cy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COLORS.tempoInk;
    ctx.fillText(marker.bpm.toFixed(1), x + 8, cy + 3.5);
  }

  // Time-signature chips at each meter change.
  ctx.font = '700 9.5px system-ui, sans-serif';
  let prevLabel = '';
  for (const ts of scene.timeSignatures) {
    if (ts.label === prevLabel) continue;
    prevLabel = ts.label;
    const x = msToX(ts.ms, view);
    if (x < -50 || x > w + 10) continue;
    const tw = ctx.measureText(ts.label).width;
    ctx.fillStyle = 'rgba(122,184,255,0.16)';
    roundRect(ctx, x + 3, RULER_H + 2, tw + 8, 12, 3);
    ctx.fill();
    ctx.fillStyle = COLORS.tempoInk;
    ctx.fillText(ts.label, x + 7, RULER_H + 11.5);
  }
}

function drawRuler(
  ctx: CanvasRenderingContext2D,
  w: number,
  view: PianoRollView,
  scene: ChartScene,
  laneBottom: number,
  sectionDrag: SectionDrag | null,
): void {
  ctx.fillStyle = COLORS.rulerBg;
  ctx.fillRect(0, 0, w, RULER_H);
  ctx.strokeStyle = COLORS.gridBeat;
  ctx.beginPath();
  ctx.moveTo(0, RULER_H + 0.5);
  ctx.lineTo(w, RULER_H + 0.5);
  ctx.stroke();

  const bars = scene.beats.filter(b => b.isDownbeat);
  const [msA, msB] = visibleMsRange(view, w);
  // Average bar spacing in px over the visible window, for label thinning.
  let visibleBars = 0;
  for (const bar of bars)
    if (bar.ms >= msA - 100 && bar.ms <= msB + 100) visibleBars++;
  const avgBarPx = w / Math.max(1, visibleBars);
  const labelEvery =
    avgBarPx > 44 ? 1 : avgBarPx > 22 ? 2 : avgBarPx > 11 ? 4 : 8;

  ctx.font = '500 10px ui-monospace, Menlo, monospace';
  for (const bar of bars) {
    const x = msToX(bar.ms, view);
    if (x < -40 || x > w + 40) continue;
    ctx.strokeStyle = COLORS.gridBar;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, RULER_H - 7);
    ctx.lineTo(Math.round(x) + 0.5, RULER_H);
    ctx.stroke();
    if ((bar.barNumber - 1) % labelEvery === 0) {
      ctx.fillStyle = COLORS.rulerInk;
      ctx.fillText(String(bar.barNumber), x + 3, RULER_H - 9);
    }
  }

  // Section flags (colored stem + label) — click-to-seek targets, and
  // draggable (§6): a flag being dragged renders at the pointer's
  // grid-snapped tick with a dashed ghost line marking its original
  // position, mirroring the tempo-marker drag's ghost.
  ctx.font = '600 10px system-ui, sans-serif';
  for (const s of scene.sections) {
    const dragging =
      sectionDrag?.moved === true && sectionDrag.originalTick === s.tick;
    let x = msToX(s.ms, view);
    if (dragging) {
      const gx = Math.round(x) + 0.5;
      ctx.strokeStyle = COLORS.ghost;
      ctx.setLineDash([4, 4]);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(gx, 2);
      ctx.lineTo(gx, laneBottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      x = msToX(
        tickToMs(sectionDrag!.currentTick, scene.timedTempos, scene.resolution),
        view,
      );
    }
    if (x > w + 10) continue;
    const tw = ctx.measureText(s.name).width;
    if (x + tw + 14 < 0) continue;
    ctx.fillStyle = COLORS.sectionFlag;
    ctx.fillRect(x, 2, 2, RULER_H - 4);
    ctx.globalAlpha = dragging ? 0.3 : 0.18;
    ctx.fillRect(x + 2, 2, tw + 10, 12);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.sectionFlag;
    ctx.fillText(s.name, x + 6, 11.5);
  }
}

function drawWave(
  ctx: CanvasRenderingContext2D,
  w: number,
  top: number,
  bottom: number,
  view: PianoRollView,
  pyramid: AmpPyramid,
): void {
  if (pyramid.levels.length === 0) return;
  const mid = (top + bottom) / 2;
  const half = (bottom - top) / 2;
  const STEP_PX = 2;
  // Peaks per zoom bucket (§11 / perf pass): each screen column samples the
  // MAX amplitude over the ms range it actually spans, from the mip-map
  // level matching that width — not a single point-sample per column, which
  // would drop transients between samples whenever pxPerMs makes a column
  // wider than the base bin.
  const sample = (x: number): number => {
    const msA = xToMs(x, view);
    const msB = xToMs(x + STEP_PX, view);
    return sampleAmpRange(pyramid, msA, msB);
  };
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = COLORS.waveRow;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  for (let x = 0; x <= w; x += STEP_PX) {
    ctx.lineTo(x, mid - sample(x) * half * 0.92);
  }
  for (let x = w; x >= 0; x -= STEP_PX) {
    ctx.lineTo(x, mid + sample(x) * half * 0.92);
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawLaneLabels(
  ctx: CanvasRenderingContext2D,
  laneTop: number,
  laneH: number,
): void {
  ctx.font = '600 9.5px system-ui, sans-serif';
  for (let l = 0; l < LANE_COUNT; l++) {
    const y = laneTop + l * laneH;
    ctx.fillStyle = 'rgba(13,16,23,0.72)';
    ctx.fillRect(0, y + 2, 44, 13);
    ctx.fillStyle = COLORS.laneLabel;
    ctx.fillText(PIANO_ROLL_LANES[l].name.toUpperCase(), 5, y + 12);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Re-exported for future readout use (bar.beat position); keeps the pure
// helper wired even though the read-only panel doesn't surface it yet.
export {barBeatAtTick};
