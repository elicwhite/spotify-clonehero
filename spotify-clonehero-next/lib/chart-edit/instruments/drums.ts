/**
 * Drum InstrumentSchema — covers 4-lane (default) and 5-lane variants.
 *
 * Lane 0 is always kick. Lanes 1..N are the strip lanes. The 5-lane
 * variant adds an extra `greenDrum` lane disambiguated by `variant: '5-lane'`.
 *
 * Lane key bindings match the existing place-mode hotkey assignments in
 * `useEditorKeyboard.ts` (`1` kick, `2`-`5` strip lanes). Keep these in
 * sync with the schema until phase-7 lifts hotkeys into a registry that
 * reads `LaneDefinition.defaultKey` directly.
 *
 * Flag bindings cover the drum-specific `cymbal` / `accent` / `ghost` /
 * `flam` / `doubleKick` flags that the inspector exposes today.
 */

import type {DrumType} from '@eliwhite/scan-chart';
import {drumTypes, noteTypes} from '@eliwhite/scan-chart';
import type {InstrumentSchema, LaneDefinition} from './types';

const KICK: LaneDefinition = {
  index: 0,
  noteType: noteTypes.kick,
  label: 'Kick',
  color: '#f8b272',
  defaultKey: '1',
};

const RED: LaneDefinition = {
  index: 1,
  noteType: noteTypes.redDrum,
  label: 'Red',
  color: '#dd2214',
  defaultKey: '2',
};

const YELLOW: LaneDefinition = {
  index: 2,
  noteType: noteTypes.yellowDrum,
  label: 'Yellow',
  color: '#deeb52',
  defaultKey: '3',
};

const BLUE: LaneDefinition = {
  index: 3,
  noteType: noteTypes.blueDrum,
  label: 'Blue',
  color: '#006caf',
  defaultKey: '4',
};

const GREEN_4LANE: LaneDefinition = {
  index: 4,
  noteType: noteTypes.greenDrum,
  label: 'Green',
  color: '#01b11a',
  defaultKey: '5',
};

const GREEN_5LANE: LaneDefinition = {
  index: 5,
  noteType: noteTypes.greenDrum,
  label: 'Green',
  color: '#01b11a',
  defaultKey: '6',
  variant: '5-lane',
};

/**
 * Schema for 4-lane drums (kick + red/yellow/blue/green).
 */
export const drums4LaneSchema: InstrumentSchema = {
  instrument: 'drums',
  lanes: [KICK, RED, YELLOW, BLUE, GREEN_4LANE],
  flagBindings: [
    {
      flag: 'cymbal',
      label: 'Cymbal',
      defaultKey: 'q',
      appliesTo: [
        noteTypes.yellowDrum,
        noteTypes.blueDrum,
        noteTypes.greenDrum,
      ],
    },
    {flag: 'accent', label: 'Accent', defaultKey: 'a'},
    {flag: 'ghost', label: 'Ghost', defaultKey: 's'},
    {flag: 'flam', label: 'Flam'},
    {flag: 'doubleKick', label: 'Double Kick', appliesTo: [noteTypes.kick]},
  ],
};

/**
 * Schema for 5-lane drums (kick + red/yellow/blue/green-as-orange + extra green).
 *
 * scan-chart's 5-lane mapping uses `greenDrum` for the rightmost lane;
 * the 4-lane "green" lane on the same NoteType is distinguished by
 * `variant`.
 */
export const drums5LaneSchema: InstrumentSchema = {
  instrument: 'drums',
  lanes: [
    KICK,
    RED,
    YELLOW,
    BLUE,
    {...GREEN_4LANE, label: 'Orange'},
    GREEN_5LANE,
  ],
  flagBindings: drums4LaneSchema.flagBindings,
};

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
