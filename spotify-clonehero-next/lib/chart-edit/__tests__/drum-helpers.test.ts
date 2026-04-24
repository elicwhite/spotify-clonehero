import type {ChartDocument, ParsedTrackData} from '../types';
import {
  addDrumNote,
  removeDrumNote,
  getDrumNotes,
  setDrumNoteFlags,
  addStarPower,
  removeStarPower,
  addActivationLane,
  removeActivationLane,
  addSoloSection,
  removeSoloSection,
  addFlexLane,
  removeFlexLane,
  addTempo,
  removeTempo,
  addTimeSignature,
  removeTimeSignature,
  addSection,
  removeSection,
  createEmptyChart,
} from '../index';
import {noteFlags} from '@eliwhite/scan-chart';
import {emptyTrackData} from './test-utils';

/** Wrap `createEmptyChart` into a full `ChartDocument` for the doc-level helpers. */
function createChart(opts?: {bpm?: number}): ChartDocument {
  return {
    parsedChart: createEmptyChart({bpm: opts?.bpm ?? 120, resolution: 480}),
    assets: [],
  };
}

function makeTrack(): ParsedTrackData {
  return emptyTrackData('drums', 'expert');
}

/** Total note count across all noteEventGroups. */
function noteCount(track: ParsedTrackData): number {
  return track.noteEventGroups.reduce((sum, g) => sum + g.length, 0);
}

// ==========================================================================
// Drum Notes
// ==========================================================================

describe('drum notes', () => {
  it('addDrumNote basic — pushes to noteEventGroups, no flags', () => {
    const track = makeTrack();
    addDrumNote(track, {tick: 0, type: 'kick'});

    expect(noteCount(track)).toBe(1);
    const note = track.noteEventGroups[0][0];
    expect(note.tick).toBe(0);
    expect(note.flags).toBe(0);
  });

  it('addDrumNote with cymbal sets cymbal flag', () => {
    const track = makeTrack();
    addDrumNote(track, {tick: 0, type: 'yellowDrum', flags: {cymbal: true}});

    expect(noteCount(track)).toBe(1);
    const note = track.noteEventGroups[0][0];
    expect(note.flags & noteFlags.cymbal).toBeTruthy();
  });

  it('addDrumNote with doubleKick sets doubleKick flag on kick note', () => {
    const track = makeTrack();
    addDrumNote(track, {tick: 0, type: 'kick', flags: {doubleKick: true}});

    expect(noteCount(track)).toBe(1);
    const note = track.noteEventGroups[0][0];
    expect(note.flags & noteFlags.doubleKick).toBeTruthy();
  });

  it('addDrumNote with accent sets accent flag', () => {
    const track = makeTrack();
    addDrumNote(track, {tick: 0, type: 'redDrum', flags: {accent: true}});

    expect(noteCount(track)).toBe(1);
    expect(track.noteEventGroups[0][0].flags & noteFlags.accent).toBeTruthy();
  });

  it('addDrumNote with ghost sets ghost flag', () => {
    const track = makeTrack();
    addDrumNote(track, {tick: 0, type: 'blueDrum', flags: {ghost: true}});

    expect(noteCount(track)).toBe(1);
    expect(track.noteEventGroups[0][0].flags & noteFlags.ghost).toBeTruthy();
  });

  it('addDrumNote with flam sets flam flag', () => {
    const track = makeTrack();
    addDrumNote(track, {tick: 0, type: 'redDrum', flags: {flam: true}});

    expect(noteCount(track)).toBe(1);
    expect(track.noteEventGroups[0][0].flags & noteFlags.flam).toBeTruthy();
  });

  it('addDrumNote with all flags (cymbal + accent + flam) ORs them onto one note', () => {
    const track = makeTrack();
    addDrumNote(track, {
      tick: 0,
      type: 'yellowDrum',
      flags: {cymbal: true, accent: true, flam: true},
    });

    expect(noteCount(track)).toBe(1);
    const f = track.noteEventGroups[0][0].flags;
    expect(f & noteFlags.cymbal).toBeTruthy();
    expect(f & noteFlags.accent).toBeTruthy();
    expect(f & noteFlags.flam).toBeTruthy();
  });

  it('removeDrumNote removes the note entirely', () => {
    const track = makeTrack();
    addDrumNote(track, {tick: 0, type: 'kick'});
    removeDrumNote(track, 0, 'kick');
    expect(noteCount(track)).toBe(0);
  });

  it('removeDrumNote does not affect other notes at same tick', () => {
    const track = makeTrack();
    addDrumNote(track, {tick: 0, type: 'kick'});
    addDrumNote(track, {tick: 0, type: 'redDrum'});
    removeDrumNote(track, 0, 'kick');

    expect(noteCount(track)).toBe(1);
    expect(getDrumNotes(track)[0].type).toBe('redDrum');
  });

  it('getDrumNotes empty', () => {
    expect(getDrumNotes(makeTrack())).toEqual([]);
  });

  it('getDrumNotes basic — sorted by tick', () => {
    const track = makeTrack();
    addDrumNote(track, {tick: 480, type: 'redDrum'});
    addDrumNote(track, {tick: 0, type: 'kick'});

    const notes = getDrumNotes(track);
    expect(notes).toHaveLength(2);
    expect(notes[0].tick).toBe(0);
    expect(notes[0].type).toBe('kick');
    expect(notes[1].tick).toBe(480);
    expect(notes[1].type).toBe('redDrum');
  });

  it('setDrumNoteFlags updates flags on the note', () => {
    const track = makeTrack();
    addDrumNote(track, {tick: 0, type: 'yellowDrum'});
    setDrumNoteFlags(track, 0, 'yellowDrum', {cymbal: true});

    expect(getDrumNotes(track)[0].flags.cymbal).toBe(true);
  });

  it('setDrumNoteFlags removes old flags', () => {
    const track = makeTrack();
    addDrumNote(track, {tick: 0, type: 'yellowDrum', flags: {cymbal: true}});
    setDrumNoteFlags(track, 0, 'yellowDrum', {});

    const note = getDrumNotes(track)[0];
    expect(note.flags.cymbal).toBeFalsy();
  });

  it('setDrumNoteFlags throws on missing note', () => {
    const track = makeTrack();
    expect(() => {
      setDrumNoteFlags(track, 0, 'kick', {doubleKick: true});
    }).toThrow('No kick note found at tick 0');
  });

  it('setDrumNoteFlags cymbal toggle round-trips through getDrumNotes', () => {
    const track = makeTrack();
    addDrumNote(track, {tick: 0, type: 'yellowDrum', flags: {cymbal: true}});

    setDrumNoteFlags(track, 0, 'yellowDrum', {cymbal: false});
    expect(
      getDrumNotes(track).find(n => n.type === 'yellowDrum')!.flags.cymbal,
    ).toBe(false);

    setDrumNoteFlags(track, 0, 'yellowDrum', {cymbal: true});
    expect(
      getDrumNotes(track).find(n => n.type === 'yellowDrum')!.flags.cymbal,
    ).toBe(true);
  });

  // A3: Duplicate flam prevention is now intrinsic — flam is per-note flag.
  it('addDrumNote with flam on multiple notes at same tick: each note keeps its own flam flag', () => {
    const track = makeTrack();
    addDrumNote(track, {tick: 0, type: 'kick', flags: {flam: true}});
    addDrumNote(track, {tick: 0, type: 'redDrum', flags: {flam: true}});

    const notes = getDrumNotes(track);
    expect(notes.find(n => n.type === 'kick')!.flags.flam).toBe(true);
    expect(notes.find(n => n.type === 'redDrum')!.flags.flam).toBe(true);
  });

  // A1: Shared flam corruption check (now: removing one note must not clear flam on the other)
  it('removeDrumNote preserves flam for remaining notes at same tick', () => {
    const track = makeTrack();
    addDrumNote(track, {tick: 0, type: 'kick', flags: {flam: true}});
    addDrumNote(track, {tick: 0, type: 'redDrum', flags: {flam: true}});
    removeDrumNote(track, 0, 'kick');

    const notes = getDrumNotes(track);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe('redDrum');
    expect(notes[0].flags.flam).toBe(true);
  });

  // A2: setDrumNoteFlags flam:false on one note must not clear the other note's flam.
  it('setDrumNoteFlags flam:false preserves flam when other notes remain', () => {
    const track = makeTrack();
    addDrumNote(track, {tick: 0, type: 'kick', flags: {flam: true}});
    addDrumNote(track, {tick: 0, type: 'redDrum', flags: {flam: true}});
    setDrumNoteFlags(track, 0, 'kick', {flam: false});

    const red = getDrumNotes(track).find(n => n.type === 'redDrum')!;
    expect(red.flags.flam).toBe(true);
  });

  it('addDrumNote -> getDrumNotes round-trip', () => {
    const track = makeTrack();

    addDrumNote(track, {tick: 0, type: 'kick', flags: {doubleKick: true}});
    addDrumNote(track, {
      tick: 0,
      type: 'yellowDrum',
      flags: {cymbal: true, accent: true},
    });
    addDrumNote(track, {
      tick: 480,
      type: 'redDrum',
      flags: {ghost: true, flam: true},
    });
    addDrumNote(track, {tick: 960, type: 'blueDrum', length: 120});

    const notes = getDrumNotes(track);
    expect(notes).toHaveLength(4);

    const kick = notes.find(n => n.type === 'kick')!;
    expect(kick.tick).toBe(0);
    expect(kick.flags.doubleKick).toBe(true);

    const yellow = notes.find(n => n.type === 'yellowDrum')!;
    expect(yellow.tick).toBe(0);
    expect(yellow.flags.cymbal).toBe(true);
    expect(yellow.flags.accent).toBe(true);

    const red = notes.find(n => n.type === 'redDrum')!;
    expect(red.tick).toBe(480);
    expect(red.flags.ghost).toBe(true);
    expect(red.flags.flam).toBe(true);

    const blue = notes.find(n => n.type === 'blueDrum')!;
    expect(blue.tick).toBe(960);
    expect(blue.length).toBe(120);
  });
});

// ==========================================================================
// Section Helpers
// ==========================================================================

describe('section helpers', () => {
  it('addStarPower', () => {
    const track = makeTrack();
    addStarPower(track, 0, 480);

    expect(track.starPowerSections).toHaveLength(1);
    expect(track.starPowerSections[0]).toMatchObject({tick: 0, length: 480});
  });

  it('addStarPower replaces at same tick', () => {
    const track = makeTrack();
    addStarPower(track, 0, 480);
    addStarPower(track, 0, 960);

    expect(track.starPowerSections).toHaveLength(1);
    expect(track.starPowerSections[0].length).toBe(960);
  });

  it('removeStarPower', () => {
    const track = makeTrack();
    addStarPower(track, 0, 480);
    removeStarPower(track, 0);

    expect(track.starPowerSections).toHaveLength(0);
  });

  it('addActivationLane', () => {
    const track = makeTrack();
    addActivationLane(track, 0, 480);

    expect(track.drumFreestyleSections).toHaveLength(1);
    expect(track.drumFreestyleSections[0]).toMatchObject({
      tick: 0,
      length: 480,
      isCoda: false,
    });
  });

  it('removeActivationLane', () => {
    const track = makeTrack();
    addActivationLane(track, 0, 480);
    removeActivationLane(track, 0);

    expect(track.drumFreestyleSections).toHaveLength(0);
  });

  it('addSoloSection', () => {
    const track = makeTrack();
    addSoloSection(track, 0, 480);

    expect(track.soloSections).toHaveLength(1);
    expect(track.soloSections[0]).toMatchObject({tick: 0, length: 480});
  });

  it('removeSoloSection', () => {
    const track = makeTrack();
    addSoloSection(track, 0, 480);
    removeSoloSection(track, 0);

    expect(track.soloSections).toHaveLength(0);
  });

  it('addFlexLane', () => {
    const track = makeTrack();
    addFlexLane(track, 0, 480, true);

    expect(track.flexLanes).toHaveLength(1);
    expect(track.flexLanes[0]).toMatchObject({
      tick: 0,
      length: 480,
      isDouble: true,
    });
  });

  it('removeFlexLane', () => {
    const track = makeTrack();
    addFlexLane(track, 0, 480, false);
    removeFlexLane(track, 0);

    expect(track.flexLanes).toHaveLength(0);
  });
});

// ==========================================================================
// Tempo Helpers
// ==========================================================================

describe('tempo helpers', () => {
  it('addTempo', () => {
    const doc = createChart({bpm: 120});
    addTempo(doc, 480, 140);

    expect(doc.parsedChart.tempos).toHaveLength(2);
    expect(doc.parsedChart.tempos[0]).toMatchObject({
      tick: 0,
      beatsPerMinute: 120,
    });
    expect(doc.parsedChart.tempos[1]).toMatchObject({
      tick: 480,
      beatsPerMinute: 140,
    });
  });

  it('addTempo replaces at same tick', () => {
    const doc = createChart({bpm: 120});
    addTempo(doc, 0, 140);

    expect(doc.parsedChart.tempos).toHaveLength(1);
    expect(doc.parsedChart.tempos[0].beatsPerMinute).toBe(140);
  });

  it('removeTempo', () => {
    const doc = createChart({bpm: 120});
    addTempo(doc, 480, 140);
    removeTempo(doc, 480);

    expect(doc.parsedChart.tempos).toHaveLength(1);
    expect(doc.parsedChart.tempos[0].tick).toBe(0);
  });

  it('removeTempo throws at tick 0', () => {
    const doc = createChart({bpm: 120});

    expect(() => {
      removeTempo(doc, 0);
    }).toThrow('Cannot remove the tempo at tick 0');
  });

  it('addTimeSignature', () => {
    const doc = createChart();
    addTimeSignature(doc, 480, 3, 4);

    expect(doc.parsedChart.timeSignatures).toHaveLength(2);
    expect(doc.parsedChart.timeSignatures[1]).toMatchObject({
      tick: 480,
      numerator: 3,
      denominator: 4,
    });
  });

  it('removeTimeSignature throws at tick 0', () => {
    const doc = createChart();

    expect(() => {
      removeTimeSignature(doc, 0);
    }).toThrow('Cannot remove the time signature at tick 0');
  });
});

// ==========================================================================
// Section Markers
// ==========================================================================

describe('section markers', () => {
  it('addSection', () => {
    const doc = createChart();
    addSection(doc, 0, 'Intro');

    expect(doc.parsedChart.sections).toHaveLength(1);
    expect(doc.parsedChart.sections[0]).toMatchObject({tick: 0, name: 'Intro'});
  });

  it('addSection replaces at same tick', () => {
    const doc = createChart();
    addSection(doc, 0, 'Intro');
    addSection(doc, 0, 'Verse 1');

    expect(doc.parsedChart.sections).toHaveLength(1);
    expect(doc.parsedChart.sections[0].name).toBe('Verse 1');
  });

  it('removeSection', () => {
    const doc = createChart();
    addSection(doc, 0, 'Intro');
    removeSection(doc, 0);

    expect(doc.parsedChart.sections).toHaveLength(0);
  });
});
