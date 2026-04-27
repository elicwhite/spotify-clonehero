/**
 * InstrumentSchema — editor-presentation data layered over scan-chart's
 * note-type / flag primitives.
 *
 * The schema does NOT redeclare scan-chart's `NoteType` or flag identifiers.
 * It carries:
 *   - per-lane display data (label, color, default keyboard binding) plus
 *     the scan-chart `NoteType` that lives at that lane,
 *   - per-flag display data (label, default key, applicability) keyed by
 *     `noteFlags` names.
 *
 * Schemas live in `lib/chart-edit/instruments/` so chart-edit's entity
 * dispatch can ask "which scan-chart NoteType is at lane N?". The editor
 * (`components/chart-editor/`) and renderer (`lib/preview/highway/`)
 * consume the same schemas.
 *
 * Highway world-space X positions for each lane live on
 * `LaneDefinition.worldXOffset`; InteractionManager + place-mode logic
 * read them so the schema is the single source of truth for geometry.
 */

import type {Instrument, NoteType} from '@eliwhite/scan-chart';
import {noteFlags} from '@eliwhite/scan-chart';

export type NoteFlagName = keyof typeof noteFlags;

export interface LaneDefinition {
  /** 0-based display order on the highway (lane 0 = leftmost or kick). */
  index: number;
  /** scan-chart NoteType (e.g. `noteTypes.redDrum`) that this lane represents. */
  noteType: NoteType;
  /** Human-readable label (e.g. "Snare", "Green"). */
  label: string;
  /** Hex color string used by the renderer + UI badges. */
  color: string;
  /** Place-mode hotkey ("1", "2", ...). Optional — schemas without
   *  place-mode bindings (e.g. some rhythm games) leave this undefined. */
  defaultKey?: string;
  /** Disambiguator for two lanes that share a `noteType`. The 5-lane
   *  drum kit's "green" reuses scan-chart's greenDrum NoteType but lives
   *  in a different display slot than 4-lane green; `variant: '5-lane'`
   *  separates them. */
  variant?: string;
  /**
   * Highway world-space X position (Three.js units) where this lane sits.
   * Hit-testing and note-placement code consume this so the schema is the
   * single source of truth for lane geometry. Must stay in sync with
   * `calculateNoteXOffset` in `lib/preview/highway/types.ts`. Optional
   * because some lanes (vocals, dance) have no highway position.
   */
  worldXOffset?: number;
}

export interface FlagBinding {
  /** Name of the flag in scan-chart's `noteFlags` map (e.g. 'cymbal'). */
  flag: NoteFlagName;
  /** Human-readable label ("Cymbal", "Accent"). */
  label: string;
  /** Toggle hotkey while a note is selected (e.g. "Q"). Optional. */
  defaultKey?: string;
  /** Restrict this flag to specific NoteTypes. Omit for "all lanes". */
  appliesTo?: NoteType[];
}

export interface InstrumentSchema {
  /** scan-chart Instrument id this schema applies to. */
  instrument: Instrument;
  /** All lanes the editor should render + accept input for. */
  lanes: LaneDefinition[];
  /** All flags the editor exposes for this instrument. */
  flagBindings: FlagBinding[];
}
