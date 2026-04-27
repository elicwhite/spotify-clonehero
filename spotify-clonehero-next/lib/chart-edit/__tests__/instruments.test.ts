import {drumTypes, noteTypes} from '@eliwhite/scan-chart';
import {
  drums4LaneSchema,
  drums5LaneSchema,
  drumSchemaFor,
  guitarSchema,
  laneAt,
  laneForNoteType,
  schemaForInstrument,
  schemaForTrack,
} from '../instruments';
import type {ParsedTrackData} from '../types';
import {emptyTrackData} from './test-utils';

describe('drum schemas', () => {
  it('4-lane drums has kick + 4 strip lanes', () => {
    expect(drums4LaneSchema.instrument).toBe('drums');
    expect(drums4LaneSchema.lanes.map(l => l.label)).toEqual([
      'Kick',
      'Red',
      'Yellow',
      'Blue',
      'Green',
    ]);
  });

  it('4-lane lane noteTypes match scan-chart drum NoteTypes', () => {
    const map = Object.fromEntries(
      drums4LaneSchema.lanes.map(l => [l.label, l.noteType]),
    );
    expect(map.Kick).toBe(noteTypes.kick);
    expect(map.Red).toBe(noteTypes.redDrum);
    expect(map.Yellow).toBe(noteTypes.yellowDrum);
    expect(map.Blue).toBe(noteTypes.blueDrum);
    expect(map.Green).toBe(noteTypes.greenDrum);
  });

  it('5-lane drums has kick + 5 strip lanes', () => {
    expect(drums5LaneSchema.lanes).toHaveLength(6);
    const variants = drums5LaneSchema.lanes.map(l => l.variant ?? null);
    expect(variants.filter(v => v === '5-lane')).toHaveLength(1);
  });

  it('5-lane drums disambiguates the two greenDrum-NoteType lanes by variant', () => {
    const greens = drums5LaneSchema.lanes.filter(
      l => l.noteType === noteTypes.greenDrum,
    );
    expect(greens).toHaveLength(2);
    expect(greens.map(l => l.variant ?? null)).toEqual(
      expect.arrayContaining([null, '5-lane']),
    );
  });

  it('drumSchemaFor honors drumType', () => {
    expect(drumSchemaFor(drumTypes.fourLane)).toBe(drums4LaneSchema);
    expect(drumSchemaFor(drumTypes.fourLanePro)).toBe(drums4LaneSchema);
    expect(drumSchemaFor(drumTypes.fiveLane)).toBe(drums5LaneSchema);
    expect(drumSchemaFor(null)).toBe(drums4LaneSchema);
    expect(drumSchemaFor(undefined)).toBe(drums4LaneSchema);
  });
});

describe('guitar schema', () => {
  it('has open + 5 frets', () => {
    expect(guitarSchema.instrument).toBe('guitar');
    expect(guitarSchema.lanes.map(l => l.label)).toEqual([
      'Open',
      'Green',
      'Red',
      'Yellow',
      'Blue',
      'Orange',
    ]);
  });

  it('frets map to scan-chart five-fret NoteTypes', () => {
    expect(laneForNoteType(guitarSchema, noteTypes.green)?.label).toBe('Green');
    expect(laneForNoteType(guitarSchema, noteTypes.red)?.label).toBe('Red');
    expect(laneForNoteType(guitarSchema, noteTypes.yellow)?.label).toBe(
      'Yellow',
    );
    expect(laneForNoteType(guitarSchema, noteTypes.blue)?.label).toBe('Blue');
    expect(laneForNoteType(guitarSchema, noteTypes.orange)?.label).toBe(
      'Orange',
    );
    expect(laneForNoteType(guitarSchema, noteTypes.open)?.label).toBe('Open');
  });
});

describe('schemaForTrack', () => {
  it('returns the right drum variant given an explicit drumType', () => {
    const track = emptyTrackData('drums', 'expert');
    expect(schemaForTrack(track, drumTypes.fourLane)).toBe(drums4LaneSchema);
    expect(schemaForTrack(track, drumTypes.fourLanePro)).toBe(drums4LaneSchema);
    expect(schemaForTrack(track, drumTypes.fiveLane)).toBe(drums5LaneSchema);
  });

  it('defaults to 4-lane drums when drumType omitted', () => {
    const track = emptyTrackData('drums', 'expert');
    expect(schemaForTrack(track)).toBe(drums4LaneSchema);
  });

  it('returns null for vocals (no lane schema)', () => {
    const track = emptyTrackData('drums', 'expert');
    track.instrument = 'vocals' as ParsedTrackData['instrument'];
    expect(schemaForTrack(track)).toBeNull();
  });
});

describe('laneAt / laneForNoteType', () => {
  it('laneAt returns the right lane by index', () => {
    expect(laneAt(drums4LaneSchema, 0)?.label).toBe('Kick');
    expect(laneAt(drums4LaneSchema, 4)?.label).toBe('Green');
    expect(laneAt(drums4LaneSchema, 99)).toBeNull();
  });

  it('laneForNoteType returns the first lane matching, no variant filter', () => {
    expect(
      laneForNoteType(drums5LaneSchema, noteTypes.greenDrum)?.variant,
    ).toBeUndefined();
  });

  it('laneForNoteType respects variant filter', () => {
    expect(
      laneForNoteType(drums5LaneSchema, noteTypes.greenDrum, '5-lane')?.variant,
    ).toBe('5-lane');
  });

  it('schemaForInstrument returns null for vocals/dance/etc', () => {
    expect(schemaForInstrument('vocals' as never)).toBeNull();
  });
});
