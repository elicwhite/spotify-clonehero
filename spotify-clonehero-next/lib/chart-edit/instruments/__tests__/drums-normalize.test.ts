/**
 * Disco-flip `normalizeForRender` semantics, ported from chart-preview's
 * `adjustParsedChart` (`~/projects/chart-preview/src/ChartPreview.ts:1626-1647`).
 */

import {noteFlags, noteTypes} from '@eliwhite/scan-chart';
import type {NoteEvent} from '@eliwhite/scan-chart';
import {drums4LaneSchema} from '../drums';
import {emptyTrackData} from '../../__tests__/test-utils';
import type {SchemaTrack} from '../types';

function note(
  overrides: Partial<NoteEvent> & Pick<NoteEvent, 'type'>,
): NoteEvent {
  return {
    tick: 0,
    msTime: 0,
    length: 0,
    msLength: 0,
    flags: 0,
    ...overrides,
  } as NoteEvent;
}

function trackWithGroups(groups: NoteEvent[][]): SchemaTrack {
  return {
    ...emptyTrackData('drums', 'expert'),
    noteEventGroups: groups,
  } as unknown as SchemaTrack;
}

const normalize = drums4LaneSchema.normalizeForRender!;

describe('drums normalizeForRender (disco flip)', () => {
  it('leaves a track with no disco flags unchanged (same reference)', () => {
    const track = trackWithGroups([[note({tick: 0, type: noteTypes.redDrum})]]);
    const result = normalize(track, undefined as never);
    expect(result).toBe(track);
  });

  it('flips red -> yellow+cymbal within a disco-flip range', () => {
    const track = trackWithGroups([
      [
        note({
          tick: 0,
          type: noteTypes.redDrum,
          flags: noteFlags.disco,
        }),
      ],
    ]);
    const result = normalize(track, undefined as never);
    const flipped = result.noteEventGroups[0][0];
    expect(flipped.type).toBe(noteTypes.yellowDrum);
    expect(flipped.flags & noteFlags.cymbal).toBeTruthy();
    expect(flipped.flags & noteFlags.tom).toBeFalsy();
    expect(flipped.flags & noteFlags.disco).toBeFalsy();
  });

  it('flips yellow+cymbal -> red+tom within a disco-flip range', () => {
    const track = trackWithGroups([
      [
        note({
          tick: 0,
          type: noteTypes.yellowDrum,
          flags: noteFlags.disco | noteFlags.cymbal,
        }),
      ],
    ]);
    const result = normalize(track, undefined as never);
    const flipped = result.noteEventGroups[0][0];
    expect(flipped.type).toBe(noteTypes.redDrum);
    expect(flipped.flags & noteFlags.tom).toBeTruthy();
    expect(flipped.flags & noteFlags.cymbal).toBeFalsy();
    expect(flipped.flags & noteFlags.disco).toBeFalsy();
  });

  it('leaves non-red/yellow notes in a disco range untouched aside from stripping disco flags', () => {
    const track = trackWithGroups([
      [
        note({
          tick: 0,
          type: noteTypes.blueDrum,
          flags: noteFlags.disco,
        }),
      ],
    ]);
    const result = normalize(track, undefined as never);
    const untouched = result.noteEventGroups[0][0];
    expect(untouched.type).toBe(noteTypes.blueDrum);
    expect(untouched.flags & noteFlags.disco).toBeFalsy();
  });

  it('strips discoNoflip without swapping type/tom-cymbal', () => {
    const track = trackWithGroups([
      [
        note({
          tick: 0,
          type: noteTypes.redDrum,
          flags: noteFlags.discoNoflip | noteFlags.tom,
        }),
      ],
    ]);
    const result = normalize(track, undefined as never);
    const exempted = result.noteEventGroups[0][0];
    expect(exempted.type).toBe(noteTypes.redDrum);
    expect(exempted.flags & noteFlags.discoNoflip).toBeFalsy();
    expect(exempted.flags & noteFlags.tom).toBeTruthy();
  });

  it('does not mutate the original track or note objects', () => {
    const original = note({
      tick: 0,
      type: noteTypes.redDrum,
      flags: noteFlags.disco,
    });
    const track = trackWithGroups([[original]]);
    normalize(track, undefined as never);

    expect(original.type).toBe(noteTypes.redDrum);
    expect(original.flags & noteFlags.disco).toBeTruthy();
  });

  it('leaves notes outside a disco range in other groups unchanged', () => {
    const track = trackWithGroups([
      [note({tick: 0, type: noteTypes.redDrum})],
      [
        note({
          tick: 480,
          type: noteTypes.redDrum,
          flags: noteFlags.disco,
        }),
      ],
    ]);
    const result = normalize(track, undefined as never);
    expect(result.noteEventGroups[0][0].type).toBe(noteTypes.redDrum);
    expect(result.noteEventGroups[1][0].type).toBe(noteTypes.yellowDrum);
  });
});
