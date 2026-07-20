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
  /**
   * Hex color string for the piano-roll timeline's lane header/note fill.
   * The piano roll uses a softer, distinct palette from the highway's
   * `color`; falls back to `color` when unset.
   */
  pianoRollColor?: string;
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
  /**
   * True for a lane that renders as a single full-width sprite centered on
   * the highway rather than a pad lane (drums' kick, five-fret's open
   * note). Renderer geometry (`lib/preview/highway/notePlacement.ts`) uses
   * this instead of an `instrument === 'drums'` check to decide between
   * "kick/open" full-width placement and pad-lane placement.
   */
  fullWidth?: boolean;
}

export interface FlagBinding {
  /** Name of the flag in scan-chart's `noteFlags` map (e.g. 'cymbal'). */
  flag: NoteFlagName;
  /** Human-readable label ("Cymbal", "Accent"). */
  label: string;
  /** Toggle hotkey while a note is selected (e.g. "Q"). Optional. */
  defaultKey?: string;
  /** Restrict this flag to specific NoteTypes. Omit for "all lanes". Also
   *  the legality gate the schema-driven note adapter enforces: toggling
   *  or defaulting this flag on a NoteType outside `appliesTo` is a no-op. */
  appliesTo?: NoteType[];
  /** When true, a freshly-added note of an `appliesTo` NoteType carries
   *  this flag set by default (e.g. drums' cymbal-by-default lanes). */
  defaultOn?: boolean;
  /** The complementary flag name this one toggles against, for tri-state
   *  flags (unset / this-flag / complement-flag) rather than a plain
   *  on/off bit — e.g. drums' `cymbal` toggles against `tom` so "not a
   *  cymbal" is stored distinctly from "cymbal-ness unset". */
  complementFlag?: NoteFlagName;
  /** When true, this flag is shared across every note in the same tick's
   *  group rather than per-note (e.g. drums' `flam`, which marks a whole
   *  chord). The note adapter syncs the bit across the group on add/
   *  remove/set. */
  groupShared?: boolean;
}

export interface InstrumentSchema {
  /** scan-chart Instrument id this schema applies to. */
  instrument: Instrument;
  /** All lanes the editor should render + accept input for. */
  lanes: LaneDefinition[];
  /** All flags the editor exposes for this instrument. */
  flagBindings: FlagBinding[];
  /**
   * NoteTypes excluded from the lane-shift axis (e.g. drums' kick, which
   * spans the full highway rather than occupying a pad lane). Notes of
   * these types never change type when shifted by a lane delta; other
   * lanes clamp at the boundaries of the remaining (non-excluded) lanes
   * instead of sliding into an excluded lane. Omit when every lane
   * participates in the shift axis (e.g. five-fret).
   */
  laneShiftExcludes?: NoteType[];
  /**
   * True when notes on this track carry a sustain length rendered as a
   * highway tail (five-fret). Drum hits have no sustain, so drum schemas
   * omit this.
   */
  supportsSustain?: boolean;
  /** World-space width of the highway floor plane for this instrument. */
  highwayWidth: number;
  /** Strikeline hitbox sprite texture path for this instrument. */
  hitboxTexturePath: string;
}
