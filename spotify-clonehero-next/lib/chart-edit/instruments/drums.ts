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

// World-space X coordinates for the drum highway, and the only place they are
// spelled: everything that places drum geometry (renderer notes, strikeline
// frets, hit targets) reads `worldXOffset` off these lanes, resolved through
// `schemaForTrack`/`drumSchemaFor`.
//
// The pad centers are spaced against the fret button's *visible* outer ring,
// not its sprite box. The box is 0.197 wide (96/975 units tall at a 192x96
// aspect) but the authored `cover` ring only fills 95.31% of it, so a ring
// measures 0.1877 across. The reference highway sets its pad centers about
// 1.09 ring-widths apart, which is where 0.204 comes from -- close enough to
// read as one connected strikeline, far enough that the rings stay distinct.
// `PAD_X_START` is fixed at -1.5 steps: that is the only value centering the
// strip on the highway for both the four- and five-pad layouts.
const PAD_X_STEP = 0.204;
const PAD_X_START = -1.5 * PAD_X_STEP;
const STRIP_X = (i: number): number => PAD_X_START + PAD_X_STEP * i;
// Five-lane drums fit one more pad into the same span, so the pads are closer
// together and their sprites do touch. Five pads spread symmetrically means
// the middle one sits dead center, on the same X as the kick -- see
// `KICK_X` below for what that costs and who absorbs it.
const STRIP_X_5LANE = (i: number): number =>
  PAD_X_START + ((PAD_X_STEP * 3) / 4) * i;
// The kick centers on the highway: it renders as a full-width bar, so this X
// is only where its hover ghost sits and where a pointer has to be to mean
// "kick" rather than a pad. With four pads that is the free gap between
// yellow and blue; with five it is the blue pad's own center, so 5-lane
// pointer placement resolves to blue and the kick is placed with its
// `defaultKey` instead (`worldXToLane` in `InteractionManager.ts` spells the
// tie-break, and `drums.schema.test.ts` pins it).
const KICK_X = 0;

// `index` is each lane's position in its schema's `lanes` array, which is the
// numbering `typeToLane`/`laneToType` and every hit-test/drag/marquee speak
// in. The kick is last in both schemas, so it needs a per-schema definition:
// index 4 with four pads, index 5 with five.
const KICK_4LANE: LaneDefinition = {
  index: 4,
  noteType: noteTypes.kick,
  label: 'Kick',
  color: '#f8b272',
  pianoRollColor: '#f2994a',
  defaultKey: '1',
  worldXOffset: KICK_X,
  fullWidth: true,
};

const KICK_5LANE: LaneDefinition = {...KICK_4LANE, index: 5};

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
  worldXOffset: STRIP_X_5LANE(4),
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
  lanes: [RED, YELLOW, BLUE, GREEN_4LANE, KICK_4LANE],
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
  // The four shared pad lanes sit at their own X here: five pads divide the
  // same span the 4-lane schema gives four.
  lanes: [
    {...RED, worldXOffset: STRIP_X_5LANE(0)},
    {...YELLOW, worldXOffset: STRIP_X_5LANE(1)},
    {...BLUE, worldXOffset: STRIP_X_5LANE(2)},
    {...GREEN_4LANE, label: 'Orange', worldXOffset: STRIP_X_5LANE(3)},
    GREEN_5LANE,
    KICK_5LANE,
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
