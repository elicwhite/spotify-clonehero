/**
 * EditorCapabilities — switches that decide what the chart editor surfaces
 * for interaction at the current page.
 *
 * Two presets ship today:
 *
 *  - {@link DRUM_EDIT_CAPABILITIES}: full drum editing (notes + sections
 *    selectable + draggable, drum lanes + placement tools rendered).
 *  - {@link ADD_LYRICS_CAPABILITIES}: lyrics + phrase markers selectable
 *    + draggable; notes and sections render but are inert; drum lanes and
 *    placement tools are hidden.
 *  - {@link PREVIEW_CAPABILITIES}: read-only playback — nothing is
 *    interactive on the highway and all editing chrome is hidden; only
 *    playback-related sidebar controls (loop, speed) remain.
 *  - {@link TEMPO_CAPABILITIES}: `/tempo`'s tempo-mapping editor — tempo,
 *    time-signature, and section markers are editable; notes and lyrics are
 *    neither editable nor rendered in the piano roll.
 *
 * Pages mount `<ChartEditor capabilities={...}>` to pick a profile. Pages
 * that omit the prop fall back to `DRUM_EDIT_CAPABILITIES` for backward
 * compatibility.
 */

import type {
  CommandEntityKind,
  CommandOperation,
  EntityKind,
  SelectableKind,
} from '@/lib/chart-edit';

export interface EditorCapabilities {
  /**
   * Entity kinds `EditorSession.dispatch` allows an `EditCommand` to declare
   * as its edit intent (plan 0037 Task 3) — the dispatch-path gate, checked
   * against `command.entityKinds`. A superset of `EntityKind`: also covers
   * `'tempo'`/`'timesig'`, which are edited only by their own dedicated
   * commands (tempo markers, time signatures) rather than through the
   * generic per-kind handler surface. This is the enforcement layer;
   * `hoverable`/`selectable`/`draggable` below remain the UI-affordance
   * layer.
   */
  editableEntities: ReadonlySet<CommandEntityKind>;
  /**
   * Operation classes `EditorSession.dispatch` allows, checked against
   * `command.operations`. A command is rejected unless every kind in
   * `entityKinds` is in `editableEntities` AND every op in `operations` is
   * in `allowedOperations`.
   */
  allowedOperations: ReadonlySet<CommandOperation>;
  /** Entity kinds that respond to hover (cursor change, hit feedback). */
  hoverable: ReadonlySet<EntityKind>;
  /**
   * Kinds that can be added to the selection. Keyed by `SelectableKind`,
   * so it can include `'tempo'`/`'timesig'`: the piano roll's marquee
   * rubber-bands over the tempo lane like any other lane, and a selected
   * marker gets a highlight and a place in a batched Delete. That is the
   * whole of what selectable buys them — they stay out of `hoverable` and
   * `draggable`, which govern the generic hover/drag machinery
   * (`entityHandlers`, `MoveEntitiesCommand`) that has no marker
   * implementation: a marker move is an ms-space BPM rewrite of its two
   * neighbouring segments, not a tick translation.
   */
  selectable: ReadonlySet<SelectableKind>;
  /**
   * Entity kinds that can be drag-moved on the highway. Should be a subset
   * of `selectable` — hover/select must precede drag.
   */
  draggable: ReadonlySet<EntityKind>;
  /** Show the drum-note placement / erase / flag tools in the toolbar. */
  showNotePlacementTools: boolean;
  /**
   * Render the drum highway: 5 lanes, hit box, drum-note geometry. When
   * false, the highway draws a neutral floor with no lanes — section markers
   * still render normally.
   */
  showDrumLanes: boolean;
  /**
   * Show the utility cluster's tool row (cursor / add-note / section).
   * Add-lyrics suppresses this since the only valid tool is the cursor —
   * no choice to surface. (Renamed from the old "Tools section" doc: plan
   * 0074 Phase 7 moved this row into `UtilityCluster`, which offers cursor
   * and add-note only — see that file's header for why.)
   */
  showToolPalette: boolean;
  /**
   * Show the sidebar's Vocal Part picker on multi-part vocal charts.
   * Add-lyrics suppresses this — the aligner only writes lyrics to the
   * primary vocals track, so exposing other parts would mislead.
   */
  showVocalPartPicker: boolean;
  /**
   * Show sidebar controls that only matter when the chart can be edited
   * (grid snapping, undo/redo history). Read-only pages hide them.
   */
  showEditingControls: boolean;
  /**
   * Show the piano roll's note lanes and lyrics row. `/tempo` sets this
   * false — it only edits tempo/time-signature/section entities, which the
   * piano roll's tempo lane and ruler render and drag regardless of this
   * flag (they aren't gated through the `EntityKind` sets above).
   */
  showPianoRollNotes: boolean;
  /**
   * Which cards the sidebar's Chart Assist section offers (plan 0074 Phase
   * 2, Design C):
   *  - `false` — no section at all.
   *  - `'all'` — every card this phase ships (Tempo map, Add leading
   *    silence, Drum transcription, Lyrics).
   *  - `'tempo-and-silence'` — only the Tempo map and Add leading silence
   *    cards. `/tempo` edits the sync track alone; a Drum transcription or
   *    Lyrics card there would offer edits `editableEntities` doesn't grant.
   *  - `'lyrics-only'` — only the Lyrics card. Add-lyrics pages only
   *    ever write to the vocals track.
   *
   * A card also needs its host wiring to render, so this is the ceiling on
   * what the section can show, not a promise that anything shows.
   */
  chartAssist: false | 'all' | 'tempo-and-silence' | 'lyrics-only';
  /**
   * Show the sidebar's Chart Matrix section (plan 0074 Phase 3, Design C):
   * rows = instruments present in the chart (guitar/bass/drums, no vocals
   * row), columns = X/H/M/E, one interaction — click toggles that track's
   * visibility.
   *  - `false` — no section at all (`PREVIEW`/`TEMPO`/`ADD_LYRICS`: none of
   *    these pages edit notes, so a note-visibility matrix has nothing to
   *    do).
   *  - `true` — every present instrument is a row; `+ Add instrument` offers
   *    every absent supported instrument. The single-instrument pinned
   *    variant retired with the single-instrument edit routes it served
   *    (plan 0074 route-consolidation pass) — every surface that ships the
   *    matrix now shows every instrument the chart has.
   */
  showChartMatrix: boolean;
  /**
   * Show the sidebar's Stems mixer (plan 0074 Phase 5): one row per track
   * the live `AudioManager` carries, plus the metronome click. It is the
   * one place any of these pages offers a click-volume control, so it stays
   * on for any surface that plays a synthesized click
   * track at all — including `TEMPO_CAPABILITIES`: `/tempo` builds its
   * AudioManager through the same `usePaddedAudio` click-track machinery as
   * DRUM_EDIT, and today has NO UI for that click stem or for its
   * highway-waveform drum stem, so the mixer is a net-new control there,
   * not a redundant one.
   *  - `false` — no section (`PREVIEW`: pure playback, no chart-editing
   *    context to mix for; `ADD_LYRICS`: pins the highway to Waveform mode
   *    around lyric alignment and has no stem story of its own to expose).
   *  - `true` — full editor/tempo pages.
   */
  showStemsMixer: boolean;
}

/** Every operation class — the common case for presets with no dispatch
 *  restriction beyond which entity kinds are editable. */
const ALL_OPERATIONS = new Set<CommandOperation>([
  'add',
  'delete',
  'update',
  'move',
]);

export const DRUM_EDIT_CAPABILITIES: EditorCapabilities = {
  // Full editing: notes, sections, lyrics/phrases, and the tempo/timesig
  // markers, which are reached from the piano roll's tempo-lane context menu.
  editableEntities: new Set<CommandEntityKind>([
    'note',
    'section',
    'lyric',
    'phrase-start',
    'phrase-end',
    'tempo',
    'timesig',
  ]),
  allowedOperations: ALL_OPERATIONS,
  // 'lyric', 'phrase-start', and 'phrase-end' are here for the piano roll's
  // lyrics row: the editor's Add Lyrics flow writes into the same
  // `vocalTracks` that row reads, so its chips are hoverable/selectable/
  // draggable outside the dedicated /add-lyrics page too, and resizing a
  // phrase band by dragging its edges moves the phrase markers via
  // `MoveEntitiesCommand`. The highway honours none of these kinds: it draws
  // notes, grid lines, and section markers only.
  hoverable: new Set([
    'note',
    'section',
    'lyric',
    'phrase-start',
    'phrase-end',
  ]),
  selectable: new Set<SelectableKind>([
    'note',
    'section',
    'lyric',
    'phrase-start',
    'phrase-end',
    'tempo',
    'timesig',
  ]),
  draggable: new Set([
    'note',
    'section',
    'lyric',
    'phrase-start',
    'phrase-end',
  ]),
  showNotePlacementTools: true,
  showDrumLanes: true,
  showToolPalette: true,
  showVocalPartPicker: true,
  showEditingControls: true,
  showPianoRollNotes: true,
  chartAssist: 'all',
  showChartMatrix: true,
  showStemsMixer: true,
};

export const ADD_LYRICS_CAPABILITIES: EditorCapabilities = {
  editableEntities: new Set<CommandEntityKind>([
    'lyric',
    'phrase-start',
    'phrase-end',
  ]),
  allowedOperations: ALL_OPERATIONS,
  hoverable: new Set(['lyric', 'phrase-start', 'phrase-end']),
  selectable: new Set(['lyric', 'phrase-start', 'phrase-end']),
  draggable: new Set(['lyric', 'phrase-start', 'phrase-end']),
  showNotePlacementTools: false,
  showDrumLanes: false,
  showToolPalette: false,
  showVocalPartPicker: false,
  showEditingControls: true,
  showPianoRollNotes: true,
  chartAssist: 'lyrics-only',
  showChartMatrix: false,
  showStemsMixer: false,
};

export const PREVIEW_CAPABILITIES: EditorCapabilities = {
  editableEntities: new Set(),
  allowedOperations: new Set(),
  hoverable: new Set(),
  selectable: new Set(),
  draggable: new Set(),
  showNotePlacementTools: false,
  showDrumLanes: true,
  showToolPalette: false,
  showVocalPartPicker: true,
  showEditingControls: false,
  showPianoRollNotes: true,
  chartAssist: false,
  showChartMatrix: false,
  showStemsMixer: false,
};

/**
 * {@link TEMPO_CAPABILITIES}: `/tempo`'s tempo-mapping editor. Tempo, time-
 * signature, and section markers are editable via the piano roll's tempo
 * lane and ruler; nothing else is. Tempo/timesig marquee selection is
 * granted through `selectable`; the direct marker drags and the ruler's
 * section drag run off their own hit tests, not off `hoverable`/`draggable`
 * (which govern the generic `entityHandlers` machinery notes and lyrics
 * use).
 * The piano roll hides its note lanes and lyrics row entirely
 * (`showPianoRollNotes: false`) since the page is about the tempo grid, not
 * the drum chart. `editableEntities` deliberately omits `'note'`: a tempo
 * marker move's KEEP-MS note re-tick is gated by the moving command's
 * `'tempo'` intent kind, not by a `'note'` grant (see `MoveTempoMarkerCommand`).
 */
export const TEMPO_CAPABILITIES: EditorCapabilities = {
  editableEntities: new Set<CommandEntityKind>(['tempo', 'timesig', 'section']),
  allowedOperations: ALL_OPERATIONS,
  hoverable: new Set(),
  selectable: new Set<SelectableKind>(['tempo', 'timesig']),
  draggable: new Set(),
  showNotePlacementTools: false,
  showDrumLanes: true,
  showToolPalette: false,
  // The sheet-music pane requires at least one charted note; /tempo's
  // audio-only mode has an empty placeholder drums track, so the toggle
  // stays hidden rather than risk it on a chart with nothing to notate.
  showVocalPartPicker: false,
  showEditingControls: true,
  showPianoRollNotes: false,
  chartAssist: 'tempo-and-silence',
  showChartMatrix: false,
  showStemsMixer: true,
};
