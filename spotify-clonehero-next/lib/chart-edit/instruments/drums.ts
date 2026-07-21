/**
 * Drum InstrumentSchema — covers 4-lane (default) and 5-lane variants.
 *
 * Kick is always the *last* lane (index 4 in the 4-lane schema, 5 in the
 * 5-lane schema); the strip lanes fill the lanes before it, lowest-first
 * (red, yellow, blue, green, ...). `typeToLane`/`laneToType`
 * (`components/chart-editor/commands.ts`) and every hit-test/drag/marquee
 * that speaks in "editor lane" numbers derive from this array's order —
 * reordering it is the one and only way to change lane numbering.
 *
 * `defaultKey` on each lane is the place-mode hotkey (`1` kick,
 * `2`-`5` strip lanes) — independent of lane *number*, kept stable across
 * the reorder above so muscle memory doesn't shift; `useEditorKeyboard.ts`
 * reads these.
 *
 * Flag bindings cover the drum-specific `cymbal` / `accent` / `ghost` /
 * `flam` / `doubleKick` flags. Only flags with a `defaultKey` get a
 * keyboard shortcut and a button in `NoteInspector`.
 */

import type {DrumType, NoteType} from '@eliwhite/scan-chart';
import {drumTypes, noteFlags, noteTypes} from '@eliwhite/scan-chart';
import type {InstrumentSchema, LaneDefinition, SchemaTrack} from './types';

// World-space X coordinates for the drum highway. Mirrors the formula in
// `lib/preview/highway/types.ts:calculateNoteXOffset('drums', i)`. Kept as
// data on the schema so InteractionManager + place-mode logic can resolve
// "lane → world X" without recomputing geometry. Update both when the
// renderer's lane spacing changes.
//   leftOffset = 0.135, NOTE_SPAN_WIDTH = 0.95, SCALE = 0.105
//   stripX(i)  = 0.135 + -(0.95 / 2) + 0.105 + ((0.95 - 0.105) / 5) * i
//              = -0.235 + 0.169 * i
const STRIP_X = (i: number): number => -0.235 + 0.169 * i;
const KICK_X = 0; // kick centers on the highway

// `index` mirrors each lane's position in `drums4LaneSchema.lanes` (the
// schema `typeToLane`/`laneToType` and the editor's numeric lane logic
// actually use). KICK is shared with `drums5LaneSchema` below, where its
// true array position is one higher (5, not 4) — that schema isn't wired
// into the editor's numeric lane logic today, so this is a display-only
// approximation there, same as it was before this lane reordered.
const KICK: LaneDefinition = {
  index: 4,
  noteType: noteTypes.kick,
  label: 'Kick',
  color: '#f8b272',
  pianoRollColor: '#f2994a',
  defaultKey: '1',
  worldXOffset: KICK_X,
  fullWidth: true,
};

const RED: LaneDefinition = {
  index: 0,
  noteType: noteTypes.redDrum,
  label: 'Red',
  color: '#dd2214',
  pianoRollColor: '#e5484d',
  defaultKey: '2',
  worldXOffset: STRIP_X(0),
};

const YELLOW: LaneDefinition = {
  index: 1,
  noteType: noteTypes.yellowDrum,
  label: 'Yellow',
  color: '#deeb52',
  pianoRollColor: '#f5c742',
  defaultKey: '3',
  worldXOffset: STRIP_X(1),
};

const BLUE: LaneDefinition = {
  index: 2,
  noteType: noteTypes.blueDrum,
  label: 'Blue',
  color: '#006caf',
  pianoRollColor: '#4a9ef2',
  defaultKey: '4',
  worldXOffset: STRIP_X(2),
};

const GREEN_4LANE: LaneDefinition = {
  index: 3,
  noteType: noteTypes.greenDrum,
  label: 'Green',
  color: '#01b11a',
  pianoRollColor: '#5cc262',
  defaultKey: '5',
  worldXOffset: STRIP_X(3),
};

const GREEN_5LANE: LaneDefinition = {
  index: 4,
  noteType: noteTypes.greenDrum,
  label: 'Green',
  color: '#01b11a',
  pianoRollColor: '#5cc262',
  defaultKey: '6',
  variant: '5-lane',
  worldXOffset: STRIP_X(4),
};

/**
 * Disco-flip chart-adjust, ported from chart-preview's `adjustParsedChart`
 * (`~/projects/chart-preview/src/ChartPreview.ts:1626-1647`). scan-chart
 * resolves the .chart file's "disco flip" event ranges into a per-note
 * `disco`/`discoNoflip` flag at parse time, so this only needs to look at
 * flags on each note, not the event ranges themselves.
 *
 * Within a disco-flip range: red <-> yellow swap type, and their tom/cymbal
 * flags swap with them (red becomes a cymbal-hit yellow, yellow becomes a
 * tom-hit red) so the rendered gem and its texture match what would sound
 * on a real kit. `discoNoflip` (marks a note as exempt from an enclosing
 * disco-flip range) is stripped either way since it has no render effect
 * once the flip decision is made. Notes are copied, never mutated in
 * place — `normalizeForRender` must return a derived track.
 */
function applyDiscoFlip(track: SchemaTrack): SchemaTrack {
  const hasDisco = track.noteEventGroups.some(group =>
    group.some(note => note.flags & (noteFlags.disco | noteFlags.discoNoflip)),
  );
  if (!hasDisco) return track;

  return {
    ...track,
    noteEventGroups: track.noteEventGroups.map(group =>
      group.map(note => {
        if (!(note.flags & (noteFlags.disco | noteFlags.discoNoflip))) {
          return note;
        }

        let flags = note.flags & ~noteFlags.discoNoflip;
        let type = note.type;

        if (flags & noteFlags.disco) {
          flags &= ~noteFlags.disco;
          if (type === noteTypes.redDrum) {
            type = noteTypes.yellowDrum;
            flags = (flags & ~noteFlags.tom) | noteFlags.cymbal;
          } else if (type === noteTypes.yellowDrum) {
            type = noteTypes.redDrum;
            flags = (flags & ~noteFlags.cymbal) | noteFlags.tom;
          }
        }

        return {...note, type, flags};
      }),
    ),
  };
}

/**
 * Schema for 4-lane drums (red/yellow/blue/green + kick last).
 */
const DRUM_FLAG_BINDINGS: InstrumentSchema['flagBindings'] = [
  {
    flag: 'cymbal',
    label: 'Cymbal',
    defaultKey: 'q',
    appliesTo: [noteTypes.yellowDrum, noteTypes.blueDrum, noteTypes.greenDrum],
    defaultOn: true,
    complementFlag: 'tom',
  },
  {flag: 'accent', label: 'Accent', defaultKey: 'a'},
  {flag: 'ghost', label: 'Ghost', defaultKey: 's'},
  {flag: 'flam', label: 'Flam', groupShared: true},
  {flag: 'doubleKick', label: 'Double Kick', appliesTo: [noteTypes.kick]},
];

export const drums4LaneSchema: InstrumentSchema = {
  instrument: 'drums',
  lanes: [RED, YELLOW, BLUE, GREEN_4LANE, KICK],
  flagBindings: DRUM_FLAG_BINDINGS,
  // Kick spans the full highway rather than sitting in a pad lane, so it
  // never participates in lane-shift moves (arrow keys, note drag).
  laneShiftExcludes: [noteTypes.kick],
  highwayWidth: 0.9,
  hitboxTexturePath: '/assets/preview/assets/isolated-drums.png',
  normalizeForRender: applyDiscoFlip,
};

/**
 * Schema for 5-lane drums (red/yellow/blue/green-as-orange + extra green +
 * kick last).
 *
 * scan-chart's 5-lane mapping uses `greenDrum` for the rightmost lane;
 * the 4-lane "green" lane on the same NoteType is distinguished by
 * `variant`.
 */
export const drums5LaneSchema: InstrumentSchema = {
  instrument: 'drums',
  lanes: [
    RED,
    YELLOW,
    BLUE,
    {...GREEN_4LANE, label: 'Orange'},
    GREEN_5LANE,
    KICK,
  ],
  flagBindings: drums4LaneSchema.flagBindings,
  laneShiftExcludes: [noteTypes.kick],
  highwayWidth: 0.9,
  hitboxTexturePath: '/assets/preview/assets/isolated-drums.png',
  normalizeForRender: applyDiscoFlip,
};

/**
 * Drum `NoteType`s that may legally carry a cymbal flag. Kick and Red never
 * can (§6 lane legality) — this is the single source of truth for that
 * rule, taken directly from the schema's `cymbal` flag binding so
 * adding/renaming a cymbal-legal lane is a schema-only change. Enforced
 * below the views in the `lib/chart-edit` mutators (see
 * `helpers/drum-notes.ts`) so no view can construct a red/kick cymbal, and
 * consumed read-only by the piano-roll / highway glyph pickers.
 */
export const CYMBAL_LEGAL_NOTE_TYPES: ReadonlySet<NoteType> = new Set(
  drums4LaneSchema.flagBindings.find(b => b.flag === 'cymbal')?.appliesTo ?? [],
);

/** True when a drum `NoteType` may carry the cymbal flag. */
export function isCymbalLegalNoteType(type: NoteType): boolean {
  return CYMBAL_LEGAL_NOTE_TYPES.has(type);
}

/**
 * Pick the right drum schema for a track's `drumType`. Falls back to
 * 4-lane when the track has no drumType set.
 */
export function drumSchemaFor(
  drumType: DrumType | null | undefined,
): InstrumentSchema {
  if (drumType === drumTypes.fiveLane) return drums5LaneSchema;
  return drums4LaneSchema;
}
