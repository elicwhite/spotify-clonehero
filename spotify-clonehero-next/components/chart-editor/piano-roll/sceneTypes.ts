/**
 * Shared vocabulary for the piano-roll panel: band layout constants, the
 * canvas palette, the derived scene shapes the panel renders, the live
 * gesture state the draw layer previews, and the tiny pure helpers both the
 * component and `draw.ts` need. No React, no canvas, no store access.
 */

import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import type {InstrumentSchema, TrackKey} from '@/lib/chart-edit';
import type {LoopRegion} from '@/lib/preview/loopRegion';
import {trackKeyId} from '@/lib/chart-editor-core/trackInventory';
import type {GridBeat} from './scene';
import type {PianoRollLane, PianoRollNote} from './notes';
import type {LyricBand, LyricChip} from './lyricsScene';
import type {LoopFlagKind} from './loopFlags';

// ---------------------------------------------------------------------------
// Layout + palette
// ---------------------------------------------------------------------------

export const RULER_H = 24;
export const TEMPO_H = 26;
/** Lyrics row height — the row is present only when the 'vocals' part has
 *  lyrics; see {@link lyricsRowHeight}. */
export const LYRICS_ROW_H = 22;
export const WAVE_ROW_H = 40;
export const STACKED_GUTTER_W = 112;
export const STACKED_ROW_HEADER_H = 22;
export const STACKED_LANE_H = 20;

export const COLORS = {
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
  lyricsBg: '#141726',
  lyricBand: 'rgba(197,140,255,0.10)',
  lyricChip: '#c58cff',
  lyricWave: '#6b5a94',
  phraseEdge: '#c58cff',
  // Phrase boundaries read as part of the lyrics row, so they share its
  // purple rather than introducing two unrelated hues. Start takes the lyric
  // text's own colour and end a deeper shade of it, which keeps the two
  // distinguishable without leaving the row's palette.
  phraseStart: '#c58cff',
  phraseEnd: '#8f6bd0',
  loopFlag: '#4f9dff',
  loopShade: 'rgba(79,157,255,0.16)',
} as const;

export const OVERLAY_COLORS = {
  hoverHalo: 'rgba(255,255,255,0.32)',
  marqueeFill: 'rgba(122,184,255,0.14)',
  marqueeStroke: 'rgba(122,184,255,0.7)',
} as const;

// ---------------------------------------------------------------------------
// Live gesture state (previewed by the draw layer)
// ---------------------------------------------------------------------------

/** Live note-drag state (piano-roll side; deltas anchored on the grabbed note). */
export interface PanelNoteDrag {
  trackKey: TrackKey;
  anchorTick: number;
  anchorLane: number;
  tickDelta: number;
  laneDelta: number;
  active: boolean;
}

/** Live guitar/bass sustain endpoint drag. A delta lets multi-selection
 * resizing preserve each note's original length. */
export interface PanelNoteResize {
  trackKey: TrackKey;
  noteId: string;
  originalLength: number;
  currentLength: number;
  active: boolean;
}

/** Live click-drag placement. The lane and head stay fixed; dragging right
 * creates the sustain that the user can later fine-tune with its endpoint. */
export interface PanelPlaceNote {
  trackKey: TrackKey;
  lane: number;
  startTick: number;
  currentTick: number;
  active: boolean;
}

/** Live tempo-marker drag state. Deltas anchored on the grabbed marker. */
export interface TempoMarkerDrag {
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

/** Live time-signature-chip drag state. Grid-snapped and absolute, the same
 *  shape (and the same commit-on-pointer-up contract) as a section drag; the
 *  drop goes through the shared bar-line placement plan. */
export interface TimeSignatureDrag {
  originalTick: number;
  currentTick: number;
  moved: boolean;
}

/** Live section-flag drag state. Grid-snapped and absolute, not
 *  delta-snapped the way a note drag is. */
export interface SectionDrag {
  originalTick: number;
  currentTick: number;
  moved: boolean;
}

/** Live A/B loop-flag drag state. Continuous ms (the loop is a playback
 *  range, not a chart entity — nothing about it is tick-quantized), clamped
 *  by `moveLoopEdge` so the two edges keep their order. `region` is the live
 *  preview the ruler draws; it is dispatched on pointer-up. */
export interface LoopDrag {
  kind: LoopFlagKind;
  region: LoopRegion;
  moved: boolean;
}

/** Live lyric-chip drag state. Unlike a section drag, the tick is NOT
 *  grid-snapped — it tracks the pointer continuously, clamped to the owning
 *  phrase's bounds (mirrors `moveLyric`'s clamp). */
export interface LyricDrag {
  /** Entity id of the chip as it existed at drag start. */
  chipId: string;
  originalTick: number;
  currentTick: number;
  phraseMinTick: number;
  phraseMaxTick: number;
  moved: boolean;
}

/** Live phrase-edge (band start/end) drag state. Grid-unsnapped like a lyric
 *  drag, clamped to {@link phraseEdgeDragBounds} so the ghost never
 *  overshoots what `movePhraseStart`/`movePhraseEnd` will clamp to. */
export interface PhraseEdgeDrag {
  kind: 'phrase-start' | 'phrase-end';
  originalTick: number;
  currentTick: number;
  minTick: number;
  maxTick: number;
  moved: boolean;
}

// ---------------------------------------------------------------------------
// Scene (derived, cached per chartDoc / audio)
// ---------------------------------------------------------------------------

export interface TempoMarker {
  tick: number;
  ms: number;
  bpm: number;
}

export interface TsChip {
  tick: number;
  ms: number;
  label: string;
}

export interface SectionFlag {
  tick: number;
  ms: number;
  name: string;
}

export interface ChartScene {
  resolution: number;
  timedTempos: TimedTempo[];
  beats: GridBeat[];
  tempos: TempoMarker[];
  timeSignatures: TsChip[];
  sections: SectionFlag[];
  notes: PianoRollNote[];
  rows: TrackRowScene[];
  /** Every chartable track's key, regardless of Chart Matrix visibility —
   *  `rows` only lists the visible subset (see {@link visiblePianoRollRows}),
   *  but the gutter's "manage tracks" menu needs the full set so a hidden
   *  track can still be checked back on from the piano roll. */
  allTrackKeys: TrackKey[];
  activeTrackKey: TrackKey | null;
  /** Active scope's schema lanes, top→bottom — `PianoRollNote.lane` indexes
   *  into this array. Empty when `showPianoRollNotes` is off or there's no
   *  active track. */
  lanes: PianoRollLane[];
  /** Active scope's instrument schema — drives lane semantics for note
   *  mutation (add/drag/marquee). Null when there's no active track. */
  schema: InstrumentSchema | null;
  totalMs: number;
  durationMs: number;
  /** Audio-extended beat-grid span (shared with the downbeat commands). */
  endTick: number;
  /** Lyrics row content — the 'vocals' part's syllable chips + phrase bands.
   *  Empty when the part has no phrases. */
  lyricChips: LyricChip[];
  lyricBands: LyricBand[];
  /** True when the lyrics row should render (the vocals part has phrases). */
  lyricsVisible: boolean;
}

export interface TrackRowScene {
  key: TrackKey;
  schema: InstrumentSchema;
  lanes: PianoRollLane[];
  notes: PianoRollNote[];
}

export interface TrackRowGeometry {
  row: TrackRowScene;
  top: number;
  laneTop: number;
  bottom: number;
  laneH: number;
}

/** Lyrics-row height for the current scene — 0 (row hidden) when the
 *  'vocals' part has no phrases yet. Shared by `panelGeometry` and `draw` so
 *  hit-testing and rendering can never disagree about the row's presence. */
export function lyricsRowHeight(scene: ChartScene | null): number {
  return scene?.lyricsVisible ? LYRICS_ROW_H : 0;
}

/**
 * The stacked-layout row list: only tracks the user has made visible in the
 * Chart Matrix (`state.visibleTrackKeys`) get a row. A hidden track gets no
 * row at all, so the row-height/hit-test/draw layers can treat every row they
 * see as fully visible.
 */
export function visiblePianoRollRows(
  rows: readonly TrackRowScene[],
  visibleTrackKeys: ReadonlySet<string>,
): TrackRowScene[] {
  return rows.filter(row => visibleTrackKeys.has(trackKeyId(row.key)));
}

export function rowLabel(value: string): string {
  return value.length > 0
    ? value[0].toUpperCase() + value.slice(1).toLowerCase()
    : value;
}
