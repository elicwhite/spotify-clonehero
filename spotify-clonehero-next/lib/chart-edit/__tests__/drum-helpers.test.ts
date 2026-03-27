import type { TrackData } from '../types';
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
  createChart,
  eventTypes,
} from '../index';

function makeTrack(): TrackData {
  return {
    instrument: 'drums' as const,
    difficulty: 'expert' as const,
    starPowerSections: [],
    rejectedStarPowerSections: [],
    soloSections: [],
    flexLanes: [],
    drumFreestyleSections: [],
    trackEvents: [],
  };
}

// ==========================================================================
// Drum Notes
// ==========================================================================

describe('drum notes', () => {
  it('addDrumNote basic', () => {
    const track = makeTrack();
    addDrumNote(track, { tick: 0, type: 'kick' });

    expect(track.trackEvents).toHaveLength(1);
    expect(track.trackEvents[0]).toEqual({
      tick: 0,
      length: 0,
      type: eventTypes.kick,
    });
  });

  it('addDrumNote with cymbal', () => {
    const track = makeTrack();
    addDrumNote(track, { tick: 0, type: 'yellowDrum', flags: { cymbal: true } });

    expect(track.trackEvents).toHaveLength(2);
    expect(track.trackEvents.map((e) => e.type)).toContain(eventTypes.yellowDrum);
    expect(track.trackEvents.map((e) => e.type)).toContain(eventTypes.yellowCymbalMarker);
  });

  it('addDrumNote with doubleKick', () => {
    const track = makeTrack();
    addDrumNote(track, { tick: 0, type: 'kick', flags: { doubleKick: true } });

    expect(track.trackEvents).toHaveLength(2);
    expect(track.trackEvents.map((e) => e.type)).toContain(eventTypes.kick);
    expect(track.trackEvents.map((e) => e.type)).toContain(eventTypes.kick2x);
  });

  it('addDrumNote with accent', () => {
    const track = makeTrack();
    addDrumNote(track, { tick: 0, type: 'redDrum', flags: { accent: true } });

    expect(track.trackEvents).toHaveLength(2);
    expect(track.trackEvents.map((e) => e.type)).toContain(eventTypes.redDrum);
    expect(track.trackEvents.map((e) => e.type)).toContain(eventTypes.redAccent);
  });

  it('addDrumNote with ghost', () => {
    const track = makeTrack();
    addDrumNote(track, { tick: 0, type: 'blueDrum', flags: { ghost: true } });

    expect(track.trackEvents).toHaveLength(2);
    expect(track.trackEvents.map((e) => e.type)).toContain(eventTypes.blueDrum);
    expect(track.trackEvents.map((e) => e.type)).toContain(eventTypes.blueGhost);
  });

  it('addDrumNote with flam', () => {
    const track = makeTrack();
    addDrumNote(track, { tick: 0, type: 'redDrum', flags: { flam: true } });

    expect(track.trackEvents).toHaveLength(2);
    expect(track.trackEvents.map((e) => e.type)).toContain(eventTypes.redDrum);
    expect(track.trackEvents.map((e) => e.type)).toContain(eventTypes.forceFlam);
  });

  it('addDrumNote with all flags (cymbal + accent + flam)', () => {
    const track = makeTrack();
    addDrumNote(track, {
      tick: 0,
      type: 'yellowDrum',
      flags: { cymbal: true, accent: true, flam: true },
    });

    // base note + cymbal marker + accent marker + flam = 4 events
    expect(track.trackEvents).toHaveLength(4);
    const types = track.trackEvents.map((e) => e.type);
    expect(types).toContain(eventTypes.yellowDrum);
    expect(types).toContain(eventTypes.yellowCymbalMarker);
    expect(types).toContain(eventTypes.yellowAccent);
    expect(types).toContain(eventTypes.forceFlam);
  });

  it('removeDrumNote', () => {
    const track = makeTrack();
    addDrumNote(track, { tick: 0, type: 'kick' });
    removeDrumNote(track, 0, 'kick');

    expect(track.trackEvents).toHaveLength(0);
  });

  it('removeDrumNote with modifiers', () => {
    const track = makeTrack();
    addDrumNote(track, {
      tick: 0,
      type: 'yellowDrum',
      flags: { cymbal: true },
    });
    removeDrumNote(track, 0, 'yellowDrum');

    expect(track.trackEvents).toHaveLength(0);
  });

  it('removeDrumNote does not affect other notes at same tick', () => {
    const track = makeTrack();
    addDrumNote(track, { tick: 0, type: 'kick' });
    addDrumNote(track, { tick: 0, type: 'redDrum' });
    removeDrumNote(track, 0, 'kick');

    expect(track.trackEvents).toHaveLength(1);
    expect(track.trackEvents[0].type).toBe(eventTypes.redDrum);
  });

  it('getDrumNotes empty', () => {
    const track = makeTrack();
    expect(getDrumNotes(track)).toEqual([]);
  });

  it('getDrumNotes basic', () => {
    const track = makeTrack();
    addDrumNote(track, { tick: 480, type: 'redDrum' });
    addDrumNote(track, { tick: 0, type: 'kick' });

    const notes = getDrumNotes(track);
    expect(notes).toHaveLength(2);
    // Sorted by tick
    expect(notes[0].tick).toBe(0);
    expect(notes[0].type).toBe('kick');
    expect(notes[1].tick).toBe(480);
    expect(notes[1].type).toBe('redDrum');
  });

  it('getDrumNotes resolves cymbal flag', () => {
    const track = makeTrack();
    // Manually push raw events (like a reader would)
    track.trackEvents.push(
      { tick: 0, length: 0, type: eventTypes.yellowDrum },
      { tick: 0, length: 0, type: eventTypes.yellowCymbalMarker },
    );

    const notes = getDrumNotes(track);
    expect(notes).toHaveLength(1);
    expect(notes[0].flags.cymbal).toBe(true);
  });

  it('getDrumNotes resolves doubleKick', () => {
    const track = makeTrack();
    track.trackEvents.push(
      { tick: 0, length: 0, type: eventTypes.kick },
      { tick: 0, length: 0, type: eventTypes.kick2x },
    );

    const notes = getDrumNotes(track);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe('kick');
    expect(notes[0].flags.doubleKick).toBe(true);
  });

  it('getDrumNotes resolves accent', () => {
    const track = makeTrack();
    track.trackEvents.push(
      { tick: 0, length: 0, type: eventTypes.redDrum },
      { tick: 0, length: 0, type: eventTypes.redAccent },
    );

    const notes = getDrumNotes(track);
    expect(notes).toHaveLength(1);
    expect(notes[0].flags.accent).toBe(true);
  });

  it('getDrumNotes resolves ghost', () => {
    const track = makeTrack();
    track.trackEvents.push(
      { tick: 0, length: 0, type: eventTypes.blueDrum },
      { tick: 0, length: 0, type: eventTypes.blueGhost },
    );

    const notes = getDrumNotes(track);
    expect(notes).toHaveLength(1);
    expect(notes[0].flags.ghost).toBe(true);
  });

  it('getDrumNotes resolves flam', () => {
    const track = makeTrack();
    track.trackEvents.push(
      { tick: 0, length: 0, type: eventTypes.redDrum },
      { tick: 0, length: 0, type: eventTypes.forceFlam },
    );

    const notes = getDrumNotes(track);
    expect(notes).toHaveLength(1);
    expect(notes[0].flags.flam).toBe(true);
  });

  it('setDrumNoteFlags updates modifiers', () => {
    const track = makeTrack();
    addDrumNote(track, { tick: 0, type: 'yellowDrum' });

    setDrumNoteFlags(track, 0, 'yellowDrum', { cymbal: true });

    const types = track.trackEvents.map((e) => e.type);
    expect(types).toContain(eventTypes.yellowCymbalMarker);
  });

  it('setDrumNoteFlags removes old modifiers', () => {
    const track = makeTrack();
    addDrumNote(track, {
      tick: 0,
      type: 'yellowDrum',
      flags: { cymbal: true },
    });

    setDrumNoteFlags(track, 0, 'yellowDrum', {});

    const types = track.trackEvents.map((e) => e.type);
    expect(types).not.toContain(eventTypes.yellowCymbalMarker);
    // Base note should still be there
    expect(types).toContain(eventTypes.yellowDrum);
  });

  it('setDrumNoteFlags throws on missing note', () => {
    const track = makeTrack();

    expect(() => {
      setDrumNoteFlags(track, 0, 'kick', { doubleKick: true });
    }).toThrow('No kick note found at tick 0');
  });

  // C4: greenDrum / fiveGreenDrum tests
  it('addDrumNote with greenDrum produces fiveOrangeFourGreenDrum event', () => {
    const track = makeTrack();
    addDrumNote(track, { tick: 0, type: 'greenDrum' });

    expect(track.trackEvents).toHaveLength(1);
    expect(track.trackEvents[0].type).toBe(eventTypes.fiveOrangeFourGreenDrum);
  });

  it('addDrumNote with fiveGreenDrum produces fiveGreenDrum event', () => {
    const track = makeTrack();
    addDrumNote(track, { tick: 0, type: 'fiveGreenDrum' });

    expect(track.trackEvents).toHaveLength(1);
    expect(track.trackEvents[0].type).toBe(eventTypes.fiveGreenDrum);
  });

  it('addDrumNote with greenDrum cymbal produces greenCymbalMarker event', () => {
    const track = makeTrack();
    addDrumNote(track, { tick: 0, type: 'greenDrum', flags: { cymbal: true } });

    expect(track.trackEvents).toHaveLength(2);
    const types = track.trackEvents.map((e) => e.type);
    expect(types).toContain(eventTypes.fiveOrangeFourGreenDrum);
    expect(types).toContain(eventTypes.greenCymbalMarker);
  });

  it('getDrumNotes returns correct DrumNoteType for greenDrum and fiveGreenDrum', () => {
    const track = makeTrack();
    track.trackEvents.push(
      { tick: 0, length: 0, type: eventTypes.fiveOrangeFourGreenDrum },
      { tick: 480, length: 0, type: eventTypes.fiveGreenDrum },
    );

    const notes = getDrumNotes(track);
    expect(notes).toHaveLength(2);
    expect(notes[0].type).toBe('greenDrum');
    expect(notes[0].tick).toBe(0);
    expect(notes[1].type).toBe('fiveGreenDrum');
    expect(notes[1].tick).toBe(480);
  });

  // A3: Duplicate forceFlam prevention
  it('addDrumNote with flam does not create duplicate forceFlam events', () => {
    const track = makeTrack();
    addDrumNote(track, { tick: 0, type: 'kick', flags: { flam: true } });
    addDrumNote(track, { tick: 0, type: 'redDrum', flags: { flam: true } });

    const flamEvents = track.trackEvents.filter(
      (e) => e.type === eventTypes.forceFlam,
    );
    expect(flamEvents).toHaveLength(1);

    const notes = getDrumNotes(track);
    const kick = notes.find((n) => n.type === 'kick');
    const red = notes.find((n) => n.type === 'redDrum');
    expect(kick!.flags.flam).toBe(true);
    expect(red!.flags.flam).toBe(true);
  });

  // A1: Shared forceFlam corruption in removeDrumNote
  it('removeDrumNote preserves forceFlam for remaining notes at same tick', () => {
    const track = makeTrack();
    addDrumNote(track, { tick: 0, type: 'kick', flags: { flam: true } });
    addDrumNote(track, { tick: 0, type: 'redDrum', flags: { flam: true } });

    removeDrumNote(track, 0, 'kick');

    const notes = getDrumNotes(track);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe('redDrum');
    expect(notes[0].flags.flam).toBe(true);
  });

  // A2: Shared forceFlam corruption in setDrumNoteFlags
  it('setDrumNoteFlags flam:false preserves forceFlam when other notes remain', () => {
    const track = makeTrack();
    addDrumNote(track, { tick: 0, type: 'kick', flags: { flam: true } });
    addDrumNote(track, { tick: 0, type: 'redDrum', flags: { flam: true } });

    setDrumNoteFlags(track, 0, 'kick', { flam: false });

    const notes = getDrumNotes(track);
    const red = notes.find((n) => n.type === 'redDrum');
    expect(red!.flags.flam).toBe(true);
  });

  it('addDrumNote -> getDrumNotes round-trip', () => {
    const track = makeTrack();

    addDrumNote(track, { tick: 0, type: 'kick', flags: { doubleKick: true } });
    addDrumNote(track, { tick: 0, type: 'yellowDrum', flags: { cymbal: true, accent: true } });
    addDrumNote(track, { tick: 480, type: 'redDrum', flags: { ghost: true, flam: true } });
    addDrumNote(track, { tick: 960, type: 'blueDrum', length: 120 });

    const notes = getDrumNotes(track);
    expect(notes).toHaveLength(4);

    // tick 0: kick with doubleKick
    const kick = notes.find((n) => n.type === 'kick');
    expect(kick).toBeDefined();
    expect(kick!.tick).toBe(0);
    expect(kick!.flags.doubleKick).toBe(true);

    // tick 0: yellow cymbal with accent
    const yellow = notes.find((n) => n.type === 'yellowDrum');
    expect(yellow).toBeDefined();
    expect(yellow!.tick).toBe(0);
    expect(yellow!.flags.cymbal).toBe(true);
    expect(yellow!.flags.accent).toBe(true);

    // tick 480: red with ghost + flam
    const red = notes.find((n) => n.type === 'redDrum');
    expect(red).toBeDefined();
    expect(red!.tick).toBe(480);
    expect(red!.flags.ghost).toBe(true);
    expect(red!.flags.flam).toBe(true);

    // tick 960: blue with length
    const blue = notes.find((n) => n.type === 'blueDrum');
    expect(blue).toBeDefined();
    expect(blue!.tick).toBe(960);
    expect(blue!.length).toBe(120);
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
    expect(track.starPowerSections[0]).toEqual({ tick: 0, length: 480 });
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
    expect(track.drumFreestyleSections[0]).toEqual({
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
    expect(track.soloSections[0]).toEqual({ tick: 0, length: 480 });
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
    expect(track.flexLanes[0]).toEqual({ tick: 0, length: 480, isDouble: true });
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
    const doc = createChart({ bpm: 120 });
    addTempo(doc, 480, 140);

    expect(doc.tempos).toHaveLength(2);
    expect(doc.tempos[0]).toEqual({ tick: 0, beatsPerMinute: 120 });
    expect(doc.tempos[1]).toEqual({ tick: 480, beatsPerMinute: 140 });
  });

  it('addTempo replaces at same tick', () => {
    const doc = createChart({ bpm: 120 });
    addTempo(doc, 0, 140);

    expect(doc.tempos).toHaveLength(1);
    expect(doc.tempos[0].beatsPerMinute).toBe(140);
  });

  it('removeTempo', () => {
    const doc = createChart({ bpm: 120 });
    addTempo(doc, 480, 140);
    removeTempo(doc, 480);

    expect(doc.tempos).toHaveLength(1);
    expect(doc.tempos[0].tick).toBe(0);
  });

  it('removeTempo throws at tick 0', () => {
    const doc = createChart({ bpm: 120 });

    expect(() => {
      removeTempo(doc, 0);
    }).toThrow('Cannot remove the tempo at tick 0');
  });

  it('addTimeSignature', () => {
    const doc = createChart();
    addTimeSignature(doc, 480, 3, 4);

    expect(doc.timeSignatures).toHaveLength(2);
    expect(doc.timeSignatures[1]).toEqual({
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

    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]).toEqual({ tick: 0, name: 'Intro' });
  });

  it('addSection replaces at same tick', () => {
    const doc = createChart();
    addSection(doc, 0, 'Intro');
    addSection(doc, 0, 'Verse 1');

    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].name).toBe('Verse 1');
  });

  it('removeSection', () => {
    const doc = createChart();
    addSection(doc, 0, 'Intro');
    removeSection(doc, 0);

    expect(doc.sections).toHaveLength(0);
  });
});
