/**
 * Types for the app modules the kit imports through the `@product` alias
 * (withProductApp maps it to the app's source root). This is the one copy:
 * a film that needs more of one of these modules adds it here, because a
 * second `declare module` for the same name would clash with this one.
 *
 * Webpack bundles the app's real sources; these declarations describe only
 * the slice of their API the kit calls, so the kit type-checks without
 * compiling the app's files under its stricter settings. Each block names the
 * file it mirrors. kit/test/highway-product-modules.test.ts checks every
 * block against the app's own types.
 */

// APP/lib/preview/highway/stage.ts
declare module '@product/lib/preview/highway/stage' {
  import type {RefObject} from 'react';
  import type {parseChartFile} from '@eliwhite/scan-chart';
  import type {LoadingManager} from 'three';
  import type {StageLayout} from '@product/lib/preview/highway/layout';
  import type {SceneReconciler} from '@product/lib/preview/highway/SceneReconciler';
  import type {OverlayState} from '@product/lib/preview/highway/SceneOverlays';
  import type {HighwayMode} from '@product/lib/preview/highway/HighwayScene';

  /** APP/lib/preview/chorus-chart-processing.ts `ParsedChart`. */
  type StageChart = ReturnType<typeof parseChartFile>;

  export interface StageConfig {
    pixelRatio?: number;
    loadingManager?: LoadingManager;
  }

  /** The members of the app's `AudioManager` the stage reads each frame (the kit passes its own clock). */
  export interface StageClock {
    readonly chartTime: number;
    readonly delay: number;
    readonly chartDelay: number;
    readonly isPlaying: boolean;
    readonly isInitialized: boolean;
  }

  export interface GridData {
    tempos: {tick: number; beatsPerMinute: number}[];
    timeSignatures: {tick: number; numerator: number; denominator: number}[];
    resolution: number;
    durationMs: number;
  }

  export interface AddHighwayOptions {
    track: StageChart['trackData'][number] | null;
    showDrumLanes: boolean;
  }

  export interface StageHighwayHandle {
    setOverlayState(state: OverlayState): void;
    getReconciler(): Promise<SceneReconciler>;
    setGridData(config: GridData): Promise<void>;
    setHighwayMode(mode: HighwayMode): void;
  }

  export interface HighwayStage {
    addHighway(
      id: string,
      opts: AddHighwayOptions,
    ): Promise<StageHighwayHandle | null>;
    removeHighway(id: string): void;
    setLayout(layout: StageLayout, order: readonly string[]): void;
    /** Chart-wide karaoke lyrics, drawn once across the whole strip. */
    setLyricsData(
      lyrics: {msTime: number; text: string; msLength?: number}[],
      vocalPhrases: {msTime: number; msLength: number}[],
    ): void;
    setTimingData(
      timedTempos: {tick: number; msTime: number; beatsPerMinute: number}[],
      resolution: number,
    ): void;
    /**
     * Draw one frame at chart time `elapsedMs` synchronously, with every
     * looping texture on the frame it shows at that time. Throws when the
     * draw fails, and when the stage is destroyed or its context is lost.
     */
    renderFrame(elapsedMs: number): void;
    onContextLost(listener: () => void): () => void;
    destroy(): void;
  }

  export function setupStage(
    chart: StageChart,
    sizingRef: RefObject<HTMLDivElement | null>,
    canvasHostRef: RefObject<HTMLDivElement | null>,
    getAudioManager: () => StageClock | null,
    config?: StageConfig,
  ): HighwayStage;
}

// APP/lib/preview/highway/HighwayScene.ts
declare module '@product/lib/preview/highway/HighwayScene' {
  export type HighwayMode = 'classic' | 'waveform';
}

// APP/lib/preview/highway/SceneOverlays.ts
declare module '@product/lib/preview/highway/SceneOverlays' {
  export interface OverlayState {
    cursorTick: number;
    isPlaying: boolean;
    activeTool: string;
    hoverLane: number | null;
    hoverTick: number | null;
    loopRegion: {startMs: number; endMs: number} | null;
  }
}

// APP/lib/preview/highway/layout.ts
declare module '@product/lib/preview/highway/layout' {
  export interface HighwayRect {
    x: number;
    y: number;
    width: number;
    height: number;
  }
  export interface StageLayout {
    canvas: {width: number; height: number};
    highways: HighwayRect[];
    maxHighways: number;
    measured: boolean;
  }
  export function computeStageLayout(input: {
    canvasWidth: number;
    canvasHeight: number;
    highwayCount: number;
  }): StageLayout;
}

// APP/lib/preview/highway/cameraFit.ts
declare module '@product/lib/preview/highway/cameraFit' {
  export const STRIKELINE_WORLD_Y: number;
}

// APP/lib/preview/highway/highwayCamera.ts
declare module '@product/lib/preview/highway/highwayCamera' {
  import type {PerspectiveCamera} from 'three';
  export function createHighwayCamera(worldX?: number): PerspectiveCamera;
  export function fitHighwayCamera(
    camera: PerspectiveCamera,
    viewport: {width: number; height: number},
    halfWidth: number,
  ): void;
}

// APP/lib/preview/highway/NoteRenderer.ts
declare module '@product/lib/preview/highway/NoteRenderer' {
  /** How far up a gem sprite's height its anchor (the note's point) sits: 0 is its bottom edge. */
  export const GEM_ANCHOR_Y: number;
}

// APP/lib/preview/highway/types.ts
declare module '@product/lib/preview/highway/types' {
  /** A gem sprite's height, in world units. */
  export const SCALE: number;
}

// APP/lib/preview/highway/LyricsOverlay.ts
declare module '@product/lib/preview/highway/LyricsOverlay' {
  /** The height of the karaoke band across the top of the stage's canvas, CSS px. */
  export const CANVAS_CSS_HEIGHT: number;
}

// APP/lib/preview/highway/SceneReconciler.ts
declare module '@product/lib/preview/highway/SceneReconciler' {
  /** What `computeChartElements` gives and `setElements` takes; the kit passes it through. */
  export interface ChartElement {
    key: string;
    kind: string;
  }
  /** The app's reconciler class; the kit only gets one from a highway. */
  export interface SceneReconciler {
    setElements(elements: ChartElement[]): void;
    setSelectedKeys(keys: Set<string>): void;
    setHoveredKey(key: string | null): void;
  }
}

// APP/lib/preview/highway/reconcilerKey.ts
declare module '@product/lib/preview/highway/reconcilerKey' {
  export function reconcilerKeyFor(kind: 'note', id: string): string;
}

// APP/lib/chart-edit/index.ts
declare module '@product/lib/chart-edit' {
  import type {
    ChartDocument,
    Difficulty,
    File,
    Instrument,
    NoteEvent,
    NoteType,
    ParsedChart,
  } from '@eliwhite/scan-chart';
  import type {InstrumentSchema} from '@product/lib/chart-edit/instruments';

  export interface TrackKey {
    instrument: Instrument;
    difficulty: Difficulty;
  }
  export type ParsedTrackData = ParsedChart['trackData'][number];

  /** Parse a chart folder the way the chart editor opens it for editing. */
  export function readChartForEditing(files: File[]): ChartDocument;
  export function findTrack(
    doc: ChartDocument,
    key: TrackKey,
  ): {track: ParsedTrackData; index: number} | null;
  export function listNotes(
    track: ParsedTrackData,
    schema: InstrumentSchema,
  ): NoteEvent[];
  export function schemaForTrack(
    track: ParsedTrackData,
    drumType?: ParsedChart['drumType'],
  ): InstrumentSchema | null;
  /** `${tick}:${noteTypeName}`, the editor's id for a note within its track. */
  export function schemaNoteId(tick: number, type: NoteType): string;
  /** The vocal part the editor's highway draws its karaoke line from. */
  export const DEFAULT_VOCALS_PART: string;
}

// APP/lib/chart-edit/instruments/index.ts
declare module '@product/lib/chart-edit/instruments' {
  import type {NoteType} from '@eliwhite/scan-chart';
  export interface LaneDefinition {
    index: number;
    noteType: NoteType;
    worldXOffset: number;
    fullWidth?: boolean;
  }
  export interface InstrumentSchema {
    lanes: LaneDefinition[];
    highwayWidth: number;
  }
  export const drums4LaneSchema: InstrumentSchema;
  export const guitarSchema: InstrumentSchema;
}

// APP/lib/drum-transcription/chart-types.ts
declare module '@product/lib/drum-transcription/chart-types' {
  export interface TimedTempo {
    tick: number;
    msTime: number;
    beatsPerMinute: number;
  }
}

// APP/lib/drum-transcription/timing.ts
declare module '@product/lib/drum-transcription/timing' {
  import type {TimedTempo} from '@product/lib/drum-transcription/chart-types';
  export function buildTimedTempos(
    tempos: {tick: number; beatsPerMinute: number}[],
    resolution: number,
  ): TimedTempo[];
}

// APP/components/chart-editor/capabilities.ts
declare module '@product/components/chart-editor/capabilities' {
  export interface EditorCapabilities {
    showDrumLanes: boolean;
  }
  /** The chart editor's default capability set. */
  export const DRUM_EDIT_CAPABILITIES: EditorCapabilities;
}

// APP/components/chart-editor/trackLabels.ts
declare module '@product/components/chart-editor/trackLabels' {
  import type {Difficulty} from '@eliwhite/scan-chart';
  /** The highway pane chip's text, e.g. instrument and difficulty joined by a middle dot. */
  export function trackLabel(track: {
    instrument: string;
    difficulty: Difficulty;
  }): string;
}

// APP/components/chart-editor/scope.ts
declare module '@product/components/chart-editor/scope' {
  import type {TrackKey} from '@product/lib/chart-edit';
  export type EditorScope =
    | {kind: 'global'}
    | {kind: 'track'; track: TrackKey}
    | {kind: 'vocals'; part: string};
  export const trackKeyId: (track: TrackKey) => string;
  export function trackQualifiedNoteId(
    track: TrackKey,
    localId: string,
  ): string;
}

// APP/components/chart-editor/highway/useChartElements.ts
declare module '@product/components/chart-editor/highway/useChartElements' {
  import type {ParsedChart} from '@eliwhite/scan-chart';
  import type {ChartElement} from '@product/lib/preview/highway/SceneReconciler';
  import type {EditorCapabilities} from '@product/components/chart-editor/capabilities';
  import type {EditorScope} from '@product/components/chart-editor/scope';
  import type {TimedTempo} from '@product/lib/drum-transcription/chart-types';

  /** A live note drag: selected notes follow the cursor before the move commits. */
  export interface NoteDragHint {
    tickDelta: number;
    laneDelta: number;
    /** Track-qualified note ids (`trackQualifiedNoteId`). */
    ids: ReadonlySet<string>;
  }

  /** The element set the chart editor pushes to a highway's reconciler. */
  export function computeChartElements(inputs: {
    chart: ParsedChart;
    activeScope: EditorScope;
    capabilities: EditorCapabilities;
    noteDrag: NoteDragHint | null;
    timedTempos: TimedTempo[];
    resolution: number;
  }): ChartElement[];
}

// APP/components/chart-editor/commands.ts
declare module '@product/components/chart-editor/commands' {
  import type {ChartDocument, NoteType} from '@eliwhite/scan-chart';
  import type {TrackKey} from '@product/lib/chart-edit';
  import type {InstrumentSchema} from '@product/lib/chart-edit/instruments';

  export interface SchemaNote {
    tick: number;
    type: NoteType;
    length?: number;
    flags?: number;
  }
  export class AddNoteCommand {
    constructor(
      note: SchemaNote,
      trackKey: TrackKey,
      schema?: InstrumentSchema,
    );
    execute(doc: ChartDocument): ChartDocument;
  }
  export class DeleteNotesCommand {
    constructor(
      noteIds: Set<string>,
      trackKey: TrackKey,
      schema?: InstrumentSchema,
    );
    execute(doc: ChartDocument): ChartDocument;
  }
  export class MoveEntitiesCommand {
    constructor(
      kind: 'note',
      ids: readonly string[],
      tickDelta: number,
      laneDelta: number,
      ctx?: {trackKey?: TrackKey},
    );
    execute(doc: ChartDocument): ChartDocument;
  }
  export class SetNoteLengthCommand {
    constructor(
      noteIds: string[],
      length: number,
      trackKey: TrackKey,
      schema: InstrumentSchema,
    );
    execute(doc: ChartDocument): ChartDocument;
  }
}
