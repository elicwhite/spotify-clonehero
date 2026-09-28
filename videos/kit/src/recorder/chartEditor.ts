/**
 * What a chart editor take adds to the core manifest (written by
 * scripts/recorder/apps/chart-editor): the piano roll's geometry and view on
 * every frame, the highway panes, the editing state and an edit log, and the
 * roll's high-DPI stills. See README.md.
 */
import {loadJson, useLoaded} from '../load';
import type {Rect} from '../motion';
import {
  recordedFrameData,
  useRecordedFrame,
  type RecordedFrameData,
} from './frameData';
import {
  recordingPath,
  type RecordedFrame,
  type RecordingManifest,
  type RecordingRef,
} from './manifest';

export interface Band {
  top: number;
  bottom: number;
}

export interface RollLane {
  name: string;
  top: number;
  bottom: number;
}

export interface RollRow {
  /** "guitar:expert" */
  track: string | null;
  /** Stacked layout only: top of the row's header strip. */
  headerTop: number | null;
  laneTop: number;
  laneH: number;
  lanes: RollLane[];
}

export interface RollLayout {
  stacked: boolean;
  panel: Rect;
  /** x of song time `leftMs` (left edge of the lane area). */
  originX: number;
  laneWidth: number;
  gutter: {left: number; right: number} | null;
  bands: {
    ruler: Band;
    lyrics: Band | null;
    tempo: Band;
    lanes: Band;
    waveform: Band;
  };
  rows: RollRow[];
}

export interface Pane extends Rect {
  /** "guitar:expert" */
  track: string;
}

/** What only changes with the editor's layout, shared by the frames that use it. */
export interface Layout {
  /** First recorded frame with this layout. */
  fromFrame: number;
  roll: RollLayout | null;
  panes: Pane[];
}

/** The product's editing state on one frame (editing takes only). */
export interface RecordedEdit {
  tool: string;
  /** Track-qualified product note ids, e.g. "guitar:expert|768:yellow". */
  selectedNotes: string[];
  /** What the piano roll previews while a pointer gesture is live. */
  gesture: {
    mode: string | null;
    drag: {
      track: string | null;
      anchorTick: number;
      anchorLane: number;
      tickDelta: number;
      laneDelta: number;
      active: boolean;
    } | null;
    resize: {
      track: string | null;
      noteId: string;
      originalLength: number;
      currentLength: number;
      active: boolean;
    } | null;
    /** Roll-canvas coordinates: x from the lane origin, y from the panel canvas top. */
    marquee: {
      track: string | null;
      rowScoped: boolean;
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    } | null;
    place: {
      track: string | null;
      lane: number;
      startTick: number;
      currentTick: number;
      active: boolean;
    } | null;
  };
}

export interface EditorFrame extends RecordedFrame {
  /** Song seconds the editor shows. */
  songSec: number;
  /** Index into `layouts`. */
  layout: number;
  /** The piano roll's view this frame (with the layout's `originX`, a `RollView`). */
  roll: {
    leftMs: number;
    pxPerMs: number;
    follow: boolean;
    playheadX: number;
  } | null;
  edit?: RecordedEdit;
}

/** A track's notes as the chart document held them. */
export interface EditLogEntry {
  /** Film frame of the snapshot. */
  f: number;
  undoDepth: number;
  reason: 'initial' | 'edit';
  notes: {
    tick: number;
    msTime: number;
    type: number;
    length: number;
    flags: number;
  }[];
}

/** How the take set the editor up (the spec's values). */
export interface EditorSetup {
  /** Visible tracks in pane order, e.g. "guitar:expert". */
  tracks: string[];
  panelHeight: number;
  /** The roll's zoom (a span or px per ms) and, when held still, its left edge. */
  roll: {spanSec?: number; pxPerMs?: number; leftSec?: number} | null;
  /** Which chart the take opened (the spec's `chart` key). */
  chart: string;
  songSegment: number | null;
  notes: string | null;
}

export interface EditorRecording extends RecordingManifest<EditorFrame> {
  setup: EditorSetup;
  layouts: Layout[];
  /** Editing takes: note snapshots at the first frame and after every committed edit. */
  editLog?: {note: string; entries: EditLogEntry[]};
}

export interface EditorFrameData extends RecordedFrameData<EditorRecording> {
  /** Piano roll: layout (bands, rows, lanes) with this frame's view, or null. */
  roll: (RollLayout & NonNullable<EditorFrame['roll']>) | null;
  panes: Pane[];
  edit: RecordedEdit | null;
}

/** A frame's record with the layout it names resolved. */
const withLayout = (
  data: RecordedFrameData<EditorRecording>,
): EditorFrameData => {
  const {manifest, frame} = data;
  const layout = manifest.layouts[frame.layout];
  if (!layout)
    throw new Error(
      `${manifest.id}: frame ${frame.f} names layout ${frame.layout}, which the take lacks`,
    );
  return {
    ...data,
    roll: layout.roll && frame.roll ? {...layout.roll, ...frame.roll} : null,
    panes: layout.panes,
    edit: frame.edit ?? null,
  };
};

/** Everything an editor take knows about one film frame (`recordedFrameData` plus the roll, panes and edit state). */
export const editorFrameData = (
  manifest: EditorRecording,
  filmFrame: number,
): EditorFrameData => withLayout(recordedFrameData(manifest, filmFrame));

/** `editorFrameData` for a film frame (default: the current one); null while the take loads. */
export const useEditorFrame = (
  ref: RecordingRef,
  frame?: number,
): EditorFrameData | null => {
  const data = useRecordedFrame<EditorRecording>(ref, frame);
  return data ? withLayout(data) : null;
};

/** A lyric pill as the app draws it: its song time and extent (viewport CSS px). */
export interface LyricPill {
  ms: number;
  left: number;
  right: number;
}

/** Two neighbouring lyric pills that overlap, and by how much (CSS px). */
export interface PillOverlap {
  a: LyricPill;
  b: LyricPill;
  px: number;
}

/**
 * `<id>.json` of a stills folder (roll-stills.mjs): the stills' geometry, in
 * viewport CSS px. A still's file is `recordingPath(ref, files[variant])`.
 */
export interface RollStills {
  /** Device pixels per CSS px in the stills. */
  dpr: number;
  /** The box the band stills show: the roll's top bands across the lane width. */
  clip: Rect;
  /** The roll view: song ms `leftMs` is drawn at `originX`. */
  view: {leftMs: number; pxPerMs: number};
  originX: number;
  laneWidth: number;
  /** The whole piano-roll panel (the 'panel' still). */
  panel: Rect;
  /** The top bands; `lyrics` is null when the roll shows no lyrics row. */
  bands: {ruler: Band; lyrics: Band | null; tempo: Band};
  playheadMs: number;
  /** Lyric pill extents (geometry only). */
  pills: {note: string; items: LyricPill[]};
  /** Neighbouring pills that overlap on screen. */
  overlaps: PillOverlap[];
  /** Still files by variant ('wave', 'flat', 'panel'), relative to the folder. */
  files: Record<string, string>;
}

/** A stills folder's geometry; null (with the frame held) until it has loaded. */
export const useRollStills = (ref: RecordingRef): RollStills | null =>
  useLoaded(
    `roll-stills:${ref.root}/${ref.id}`,
    () =>
      loadJson<RollStills>(recordingPath(ref, `${ref.id}.json`), {
        writtenBy: ref.writtenBy,
      }),
    `Loading the ${ref.id} stills`,
  );
