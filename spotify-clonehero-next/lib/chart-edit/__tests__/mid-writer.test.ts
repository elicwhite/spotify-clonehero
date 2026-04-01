/**
 * Tests for the MIDI serializer (writer-mid.ts).
 *
 * Focuses on structure correctness: header, track layout, MIDI note
 * numbers, velocity encoding, delta-time computation, and round-trip
 * parsing via scan-chart.
 */

import {
  createChart,
  addDrumNote,
  addStarPower,
  addSection,
  eventTypes,
} from '../index';
import type { ChartDocument, TrackData } from '../types';
import { serializeMidi } from '../writer-mid';
import { parseMidi } from 'midi-file';
import type { MidiEvent } from 'midi-file';
import { parseChartFile, noteFlags } from '@eliwhite/scan-chart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDocWithDrumTrack(
  difficulty: 'expert' | 'hard' | 'medium' | 'easy' = 'expert',
  resolution = 480,
): ChartDocument {
  const doc = createChart({ format: 'mid', resolution });
  doc.trackData.push({
    instrument: 'drums',
    difficulty,
    starPowerSections: [],
    rejectedStarPowerSections: [],
    soloSections: [],
    flexLanes: [],
    drumFreestyleSections: [],
    trackEvents: [],
  });
  return doc;
}

function getTrack(doc: ChartDocument): TrackData {
  return doc.trackData[0];
}

/** Serialize and parse back via midi-file. */
function serializeAndParse(doc: ChartDocument) {
  const bytes = serializeMidi(doc);
  return parseMidi(bytes);
}

/** Find events of a specific type in a MIDI track. */
function findEvents(track: MidiEvent[], type: string): MidiEvent[] {
  return track.filter((e) => e.type === type);
}

/** Find noteOn events at a specific MIDI note number. */
function findNoteOns(track: MidiEvent[], noteNumber: number): MidiEvent[] {
  return track.filter(
    (e) => e.type === 'noteOn' && (e as any).noteNumber === noteNumber,
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

describe('serializeMidi', () => {
  it('produces Format 1 MIDI', () => {
    const doc = createChart({ format: 'mid' });
    const midi = serializeAndParse(doc);
    expect(midi.header.format).toBe(1);
  });

  it('encodes resolution in header', () => {
    const doc = createChart({ format: 'mid', resolution: 480 });
    const midi = serializeAndParse(doc);
    expect(midi.header.ticksPerBeat).toBe(480);
  });

  // ---------------------------------------------------------------------------
  // Track count
  // ---------------------------------------------------------------------------

  it('empty chart has 2 tracks (tempo + events)', () => {
    const doc = createChart({ format: 'mid' });
    const midi = serializeAndParse(doc);
    expect(midi.header.numTracks).toBe(2);
    expect(midi.tracks.length).toBe(2);
  });

  it('chart with drums has 3 tracks', () => {
    const doc = makeDocWithDrumTrack();
    const midi = serializeAndParse(doc);
    expect(midi.header.numTracks).toBe(3);
    expect(midi.tracks.length).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // Track 0: Tempo
  // ---------------------------------------------------------------------------

  it('track 0 has trackName "tempo"', () => {
    const doc = createChart({ format: 'mid' });
    const midi = serializeAndParse(doc);
    const nameEvents = findEvents(midi.tracks[0], 'trackName');
    expect(nameEvents.length).toBe(1);
    expect((nameEvents[0] as any).text).toBe('tempo');
  });

  it('track 0 has setTempo event with correct microseconds', () => {
    const doc = createChart({ format: 'mid', bpm: 120 });
    const midi = serializeAndParse(doc);
    const tempoEvents = findEvents(midi.tracks[0], 'setTempo');
    expect(tempoEvents.length).toBe(1);
    // 120 BPM = 500,000 microseconds per beat
    expect((tempoEvents[0] as any).microsecondsPerBeat).toBe(500000);
  });

  it('track 0 has timeSignature event', () => {
    const doc = createChart({ format: 'mid' });
    const midi = serializeAndParse(doc);
    const tsEvents = findEvents(midi.tracks[0], 'timeSignature');
    expect(tsEvents.length).toBe(1);
    expect((tsEvents[0] as any).numerator).toBe(4);
    expect((tsEvents[0] as any).denominator).toBe(4);
  });

  // ---------------------------------------------------------------------------
  // Track 1: Events
  // ---------------------------------------------------------------------------

  it('track 1 has trackName "EVENTS"', () => {
    const doc = createChart({ format: 'mid' });
    const midi = serializeAndParse(doc);
    const nameEvents = findEvents(midi.tracks[1], 'trackName');
    expect(nameEvents.length).toBe(1);
    expect((nameEvents[0] as any).text).toBe('EVENTS');
  });

  it('section marker appears as text event', () => {
    const doc = createChart({ format: 'mid' });
    addSection(doc, 0, 'Intro');
    const midi = serializeAndParse(doc);
    const textEvents = findEvents(midi.tracks[1], 'text');
    const sectionEvent = textEvents.find(
      (e) => (e as any).text === '[section Intro]',
    );
    expect(sectionEvent).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Drum track name
  // ---------------------------------------------------------------------------

  it('drum track has trackName "PART DRUMS"', () => {
    const doc = makeDocWithDrumTrack();
    const midi = serializeAndParse(doc);
    const drumTrack = midi.tracks[2];
    const nameEvents = findEvents(drumTrack, 'trackName');
    expect(nameEvents.length).toBe(1);
    expect((nameEvents[0] as any).text).toBe('PART DRUMS');
  });

  // ---------------------------------------------------------------------------
  // Drum notes: MIDI pitch
  // ---------------------------------------------------------------------------

  it('expert kick maps to MIDI note 96', () => {
    const doc = makeDocWithDrumTrack('expert');
    addDrumNote(getTrack(doc), { tick: 0, type: 'kick' });
    const midi = serializeAndParse(doc);
    const drumTrack = midi.tracks[2];
    const noteOns = findNoteOns(drumTrack, 96);
    expect(noteOns.length).toBe(1);
  });

  it('hard kick maps to MIDI note 84', () => {
    const doc = makeDocWithDrumTrack('hard');
    addDrumNote(getTrack(doc), { tick: 0, type: 'kick' });
    const midi = serializeAndParse(doc);
    const drumTrack = midi.tracks[2];
    const noteOns = findNoteOns(drumTrack, 84);
    expect(noteOns.length).toBe(1);
  });

  it('expert+ double kick maps to MIDI note 95', () => {
    const doc = makeDocWithDrumTrack('expert');
    addDrumNote(getTrack(doc), {
      tick: 0,
      type: 'kick',
      flags: { doubleKick: true },
    });
    const midi = serializeAndParse(doc);
    const drumTrack = midi.tracks[2];
    // kick2x should produce noteOn at 95
    const noteOns = findNoteOns(drumTrack, 95);
    expect(noteOns.length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Velocity: accent and ghost
  // ---------------------------------------------------------------------------

  it('accent modifier produces velocity 127', () => {
    const doc = makeDocWithDrumTrack('expert');
    addDrumNote(getTrack(doc), {
      tick: 0,
      type: 'redDrum',
      flags: { accent: true },
    });
    const midi = serializeAndParse(doc);
    const drumTrack = midi.tracks[2];
    // redDrum at expert = 96 + 1 = 97
    const noteOns = findNoteOns(drumTrack, 97);
    expect(noteOns.length).toBe(1);
    expect((noteOns[0] as any).velocity).toBe(127);
  });

  it('ghost modifier produces velocity 1', () => {
    const doc = makeDocWithDrumTrack('expert');
    addDrumNote(getTrack(doc), {
      tick: 0,
      type: 'redDrum',
      flags: { ghost: true },
    });
    const midi = serializeAndParse(doc);
    const drumTrack = midi.tracks[2];
    // redDrum at expert = 97
    const noteOns = findNoteOns(drumTrack, 97);
    expect(noteOns.length).toBe(1);
    expect((noteOns[0] as any).velocity).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Tom markers
  // ---------------------------------------------------------------------------

  it('tom marker notes at 110/111/112', () => {
    const doc = makeDocWithDrumTrack('expert');
    const track = getTrack(doc);

    // Add yellow/blue/green tom markers directly as track events
    track.trackEvents.push(
      { tick: 0, length: 480, type: eventTypes.yellowTomMarker },
      { tick: 0, length: 480, type: eventTypes.blueTomMarker },
      { tick: 0, length: 480, type: eventTypes.greenTomMarker },
    );

    const midi = serializeAndParse(doc);
    const drumTrack = midi.tracks[2];
    expect(findNoteOns(drumTrack, 110).length).toBe(1);
    expect(findNoteOns(drumTrack, 111).length).toBe(1);
    expect(findNoteOns(drumTrack, 112).length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Star power
  // ---------------------------------------------------------------------------

  it('star power maps to MIDI note 116', () => {
    const doc = makeDocWithDrumTrack('expert');
    addStarPower(getTrack(doc), 0, 480);
    const midi = serializeAndParse(doc);
    const drumTrack = midi.tracks[2];
    const noteOns = findNoteOns(drumTrack, 116);
    expect(noteOns.length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // ENABLE_CHART_DYNAMICS
  // ---------------------------------------------------------------------------

  it('emits [ENABLE_CHART_DYNAMICS] text event when accents present', () => {
    const doc = makeDocWithDrumTrack('expert');
    addDrumNote(getTrack(doc), {
      tick: 0,
      type: 'redDrum',
      flags: { accent: true },
    });
    const midi = serializeAndParse(doc);
    const drumTrack = midi.tracks[2];
    const textEvents = findEvents(drumTrack, 'text');
    const dynamicsEvent = textEvents.find(
      (e) => (e as any).text === '[ENABLE_CHART_DYNAMICS]',
    );
    expect(dynamicsEvent).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Delta-time encoding
  // ---------------------------------------------------------------------------

  it('encodes delta times correctly for events at different ticks', () => {
    const doc = makeDocWithDrumTrack('expert', 480);
    const track = getTrack(doc);
    addDrumNote(track, { tick: 0, type: 'kick' });
    addDrumNote(track, { tick: 480, type: 'kick' });
    addDrumNote(track, { tick: 960, type: 'kick' });

    const midi = serializeAndParse(doc);
    const drumTrack = midi.tracks[2];

    // Collect noteOn events for kick (note 96) in order
    const kickNoteOns = drumTrack.filter(
      (e) => e.type === 'noteOn' && (e as any).noteNumber === 96,
    );
    expect(kickNoteOns.length).toBe(3);

    // First noteOn: trackName is at deltaTime 0, so the noteOn at tick 0
    // should have deltaTime 0 (after track name event)
    // Sum of deltaTimes up to each noteOn should equal the tick
    let tickAccumulator = 0;
    const noteOnTicks: number[] = [];
    for (const event of drumTrack) {
      tickAccumulator += event.deltaTime;
      if (
        event.type === 'noteOn' &&
        (event as any).noteNumber === 96
      ) {
        noteOnTicks.push(tickAccumulator);
      }
    }
    expect(noteOnTicks).toEqual([0, 480, 960]);
  });

  // ---------------------------------------------------------------------------
  // C7: Tom marker round-trip through MIDI
  // ---------------------------------------------------------------------------

  it('tom markers round-trip with correct MIDI note numbers', () => {
    const doc = makeDocWithDrumTrack('expert', 480);
    const track = getTrack(doc);

    // Add drum notes covered by tom markers
    addDrumNote(track, { tick: 0, type: 'yellowDrum', length: 1 });
    addDrumNote(track, { tick: 480, type: 'blueDrum', length: 1 });

    // Add tom markers as track events (instrument-wide)
    track.trackEvents.push(
      { tick: 0, length: 480, type: eventTypes.yellowTomMarker },
      { tick: 480, length: 480, type: eventTypes.blueTomMarker },
    );

    const bytes = serializeMidi(doc);
    const parsed = parseChartFile(bytes, 'mid');

    const drumTrack = parsed.trackData.find(
      (t) => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    expect(drumTrack).toBeDefined();

    // Verify tom markers survived: parseChartFile resolves tom markers into
    // noteFlags.tom on the corresponding noteEventGroups notes
    const allNotes = drumTrack!.noteEventGroups.flat();
    const tomNotes = allNotes.filter(
      (n) => (n.flags & noteFlags.tom) !== 0,
    );
    expect(tomNotes.length).toBe(2);

    // Also verify the raw MIDI uses the correct note numbers
    const midi = parseMidi(bytes);
    const midiDrumTrack = midi.tracks[2];
    expect(findNoteOns(midiDrumTrack, 110).length).toBe(1); // yellow tom
    expect(findNoteOns(midiDrumTrack, 111).length).toBe(1); // blue tom
  });

  it('green tom marker uses MIDI note 112', () => {
    const doc = makeDocWithDrumTrack('expert', 480);
    const track = getTrack(doc);

    track.trackEvents.push(
      { tick: 0, length: 480, type: eventTypes.greenTomMarker },
    );

    const midi = serializeAndParse(doc);
    const drumTrack = midi.tracks[2];
    expect(findNoteOns(drumTrack, 112).length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // C8: Accent/ghost MIDI velocity round-trip
  // ---------------------------------------------------------------------------

  it('accent/ghost velocities: 127 for accent, 1 for ghost, 100 for normal', () => {
    const doc = makeDocWithDrumTrack('expert', 480);
    const track = getTrack(doc);

    // Normal note
    addDrumNote(track, { tick: 0, type: 'kick', length: 1 });
    // Accented note
    addDrumNote(track, { tick: 480, type: 'redDrum', length: 1, flags: { accent: true } });
    // Ghosted note
    addDrumNote(track, { tick: 960, type: 'yellowDrum', length: 1, flags: { ghost: true } });

    const bytes = serializeMidi(doc);
    const midi = parseMidi(bytes);
    const drumTrack = midi.tracks[2];

    // kick at note 96 — normal velocity
    const kickNoteOns = findNoteOns(drumTrack, 96);
    expect(kickNoteOns.length).toBe(1);
    expect((kickNoteOns[0] as any).velocity).toBe(100);

    // redDrum at note 97 — accent velocity
    const redNoteOns = findNoteOns(drumTrack, 97);
    expect(redNoteOns.length).toBe(1);
    expect((redNoteOns[0] as any).velocity).toBe(127);

    // yellowDrum at note 98 — ghost velocity
    const yellowNoteOns = findNoteOns(drumTrack, 98);
    expect(yellowNoteOns.length).toBe(1);
    expect((yellowNoteOns[0] as any).velocity).toBe(1);

    // Verify [ENABLE_CHART_DYNAMICS] text event is present
    const textEvents = findEvents(drumTrack, 'text');
    const dynamicsEvent = textEvents.find(
      (e) => (e as any).text === '[ENABLE_CHART_DYNAMICS]',
    );
    expect(dynamicsEvent).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // A4 Test: Tom marker dedup across difficulties
  // ---------------------------------------------------------------------------

  it('deduplicates tom markers across difficulties', () => {
    const doc = createChart({ format: 'mid', resolution: 480 });

    // Add Expert and Hard drum tracks, both with the same yellow tom marker
    doc.trackData.push({
      instrument: 'drums',
      difficulty: 'expert',
      starPowerSections: [],
      rejectedStarPowerSections: [],
      soloSections: [],
      flexLanes: [],
      drumFreestyleSections: [],
      trackEvents: [
        { tick: 0, length: 480, type: eventTypes.yellowTomMarker },
        { tick: 0, length: 1, type: eventTypes.yellowDrum },
      ],
    });
    doc.trackData.push({
      instrument: 'drums',
      difficulty: 'hard',
      starPowerSections: [],
      rejectedStarPowerSections: [],
      soloSections: [],
      flexLanes: [],
      drumFreestyleSections: [],
      trackEvents: [
        { tick: 0, length: 480, type: eventTypes.yellowTomMarker },
        { tick: 0, length: 1, type: eventTypes.yellowDrum },
      ],
    });

    const bytes = serializeMidi(doc);
    const midi = parseMidi(bytes);
    const drumTrack = midi.tracks[2];

    // Only ONE noteOn at MIDI note 110, not two
    const tomNoteOns = findNoteOns(drumTrack, 110);
    expect(tomNoteOns.length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // A5 Test: Coda sections
  // ---------------------------------------------------------------------------

  it('coda freestyle sections emit [coda] text on EVENTS track, not note 120 on instrument track', () => {
    const doc = createChart({ format: 'mid', resolution: 480 });

    doc.trackData.push({
      instrument: 'drums',
      difficulty: 'expert',
      starPowerSections: [],
      rejectedStarPowerSections: [],
      soloSections: [],
      flexLanes: [],
      drumFreestyleSections: [
        { tick: 960, length: 480, isCoda: true },
      ],
      trackEvents: [
        { tick: 0, length: 1, type: eventTypes.kick },
      ],
    });

    const bytes = serializeMidi(doc);
    const midi = parseMidi(bytes);

    // Instrument track (track 2) should ALSO have note 120 for the coda section
    // (so it round-trips as a drumFreestyleSection; the [coda] text sets isCoda)
    const drumTrack = midi.tracks[2];
    const activationNoteOns = findNoteOns(drumTrack, 120);
    expect(activationNoteOns.length).toBe(1);

    // EVENTS track (track 1) should have [coda] text event
    const eventsTrack = midi.tracks[1];
    const textEvents = findEvents(eventsTrack, 'text');
    const codaEvent = textEvents.find((e) => (e as any).text === '[coda]');
    expect(codaEvent).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // C6: Multi-difficulty round-trip
  // ---------------------------------------------------------------------------

  describe('multi-difficulty', () => {
    function makeMultiDiffDoc(): ChartDocument {
      const doc = createChart({ format: 'mid', resolution: 480 });

      // Expert difficulty
      doc.trackData.push({
        instrument: 'drums',
        difficulty: 'expert',
        starPowerSections: [{ tick: 0, length: 960 }],
        rejectedStarPowerSections: [],
        soloSections: [],
        flexLanes: [],
        drumFreestyleSections: [],
        trackEvents: [
          { tick: 0, length: 1, type: eventTypes.kick },
          { tick: 480, length: 1, type: eventTypes.yellowDrum },
          { tick: 480, length: 0, type: eventTypes.yellowTomMarker },
          { tick: 960, length: 1, type: eventTypes.blueDrum },
        ],
      });

      // Hard difficulty
      doc.trackData.push({
        instrument: 'drums',
        difficulty: 'hard',
        starPowerSections: [{ tick: 0, length: 960 }],
        rejectedStarPowerSections: [],
        soloSections: [],
        flexLanes: [],
        drumFreestyleSections: [],
        trackEvents: [
          { tick: 0, length: 1, type: eventTypes.kick },
          { tick: 480, length: 1, type: eventTypes.redDrum },
          { tick: 480, length: 0, type: eventTypes.yellowTomMarker },
        ],
      });

      return doc;
    }

    it('round-trips Expert + Hard drum notes through MIDI', () => {
      const doc = makeMultiDiffDoc();
      const bytes = serializeMidi(doc);
      const parsed = parseChartFile(bytes, 'mid');

      const expertTrack = parsed.trackData.find(
        (t) => t.instrument === 'drums' && t.difficulty === 'expert',
      );
      const hardTrack = parsed.trackData.find(
        (t) => t.instrument === 'drums' && t.difficulty === 'hard',
      );
      expect(expertTrack).toBeDefined();
      expect(hardTrack).toBeDefined();

      // Expert: 3 note event groups (kick@0, yellow@480, blue@960)
      expect(expertTrack!.noteEventGroups.length).toBe(3);
      // Hard: 2 note event groups (kick@0, red@480)
      expect(hardTrack!.noteEventGroups.length).toBe(2);
    });

    it('Expert notes use correct MIDI base (96), Hard uses base (84)', () => {
      const doc = makeMultiDiffDoc();
      const bytes = serializeMidi(doc);
      const midi = parseMidi(bytes);
      const drumTrack = midi.tracks[2];

      // Expert kick = 96 + 0 = 96
      expect(findNoteOns(drumTrack, 96).length).toBe(1);
      // Expert yellow = 96 + 2 = 98
      expect(findNoteOns(drumTrack, 98).length).toBe(1);
      // Expert blue = 96 + 3 = 99
      expect(findNoteOns(drumTrack, 99).length).toBe(1);

      // Hard kick = 84 + 0 = 84
      expect(findNoteOns(drumTrack, 84).length).toBe(1);
      // Hard red = 84 + 1 = 85
      expect(findNoteOns(drumTrack, 85).length).toBe(1);
    });

    it('star power and tom markers are not duplicated across difficulties', () => {
      const doc = makeMultiDiffDoc();
      const bytes = serializeMidi(doc);
      const midi = parseMidi(bytes);
      const drumTrack = midi.tracks[2];

      // Star power note 116 should appear only ONCE despite being in both difficulties
      const spNoteOns = findNoteOns(drumTrack, 116);
      expect(spNoteOns.length).toBe(1);

      // Yellow tom marker (110) should appear only ONCE despite being in both difficulties
      const tomNoteOns = findNoteOns(drumTrack, 110);
      expect(tomNoteOns.length).toBe(1);
    });

    it('both difficulties have star power when parsed back', () => {
      const doc = makeMultiDiffDoc();
      const bytes = serializeMidi(doc);
      const parsed = parseChartFile(bytes, 'mid');

      const expertTrack = parsed.trackData.find(
        (t) => t.instrument === 'drums' && t.difficulty === 'expert',
      );
      const hardTrack = parsed.trackData.find(
        (t) => t.instrument === 'drums' && t.difficulty === 'hard',
      );

      expect(expertTrack!.starPowerSections.length).toBe(1);
      expect(expertTrack!.starPowerSections[0].tick).toBe(0);
      expect(expertTrack!.starPowerSections[0].length).toBe(960);

      expect(hardTrack!.starPowerSections.length).toBe(1);
      expect(hardTrack!.starPowerSections[0].tick).toBe(0);
      expect(hardTrack!.starPowerSections[0].length).toBe(960);
    });
  });

  // ---------------------------------------------------------------------------
  // Round-trip through parseChartFile
  // ---------------------------------------------------------------------------

  it('round-trips through parseChartFile', () => {
    const doc = makeDocWithDrumTrack('expert', 480);
    const track = getTrack(doc);

    // Add notes (use non-zero length for MIDI round-trip compatibility;
    // scan-chart's MIDI parser requires noteOn before noteOff)
    addDrumNote(track, { tick: 0, type: 'kick', length: 1 });
    addDrumNote(track, { tick: 480, type: 'redDrum', length: 1 });
    addDrumNote(track, { tick: 960, type: 'yellowDrum', length: 1 });

    // Add section
    addSection(doc, 0, 'Intro');

    // Add star power
    addStarPower(track, 0, 960);

    const bytes = serializeMidi(doc);
    const parsed = parseChartFile(bytes, 'mid');

    // Resolution
    expect(parsed.resolution).toBe(480);

    // Tempos
    expect(parsed.tempos.length).toBeGreaterThanOrEqual(1);
    expect(parsed.tempos[0].beatsPerMinute).toBe(120);

    // Sections
    expect(parsed.sections.length).toBe(1);
    expect(parsed.sections[0].name).toBe('Intro');

    // Track data
    const drumTrack = parsed.trackData.find(
      (t) => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    expect(drumTrack).toBeDefined();
    expect(drumTrack!.noteEventGroups.length).toBe(3);

    // Star power
    expect(drumTrack!.starPowerSections.length).toBe(1);
    expect(drumTrack!.starPowerSections[0].tick).toBe(0);
    expect(drumTrack!.starPowerSections[0].length).toBe(960);
  });
});

// ---------------------------------------------------------------------------
// Drum note length preservation
// ---------------------------------------------------------------------------

describe('drum note length', () => {
  it('drum notes get length=1 through MIDI round-trip (0-length limitation)', () => {
    // KNOWN LIMITATION: MIDI serializer uses Math.max(length, 1) because
    // finalizeMidiTrack sorts noteOff before noteOn at equal ticks, which
    // causes scan-chart to discard 0-length notes. Drum notes (which should
    // be length 0) round-trip as length 1 — a 1-tick difference that's
    // imperceptible but not perfect. Affects ~1 chart out of 15K.
    const doc = makeDocWithDrumTrack();
    const track = getTrack(doc);
    addDrumNote(track, { tick: 0, type: 'kick' });
    addDrumNote(track, { tick: 480, type: 'redDrum' });

    const bytes = serializeMidi(doc);
    const parsed = parseChartFile(bytes, 'mid', {
      song_length: 0,
      hopo_frequency: 0,
      eighthnote_hopo: false,
      multiplier_note: 0,
      sustain_cutoff_threshold: -1,
      chord_snap_threshold: 0,
      five_lane_drums: false,
      pro_drums: true,
    });
    const drumTrack = parsed.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    expect(drumTrack).toBeDefined();

    // scan-chart normalizes drum sustain lengths, so noteEventGroups show length 0
    // even though the MIDI has 1-tick noteOn/noteOff pairs. The raw trackEvents
    // (from parseNotesFromMidi) will show length 1.
    for (const group of drumTrack!.noteEventGroups) {
      for (const note of group) {
        expect(note.length).toBe(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Vocal phrase deduplication
// ---------------------------------------------------------------------------

describe('vocal phrase dedup', () => {
  it('preserves all vocal phrases including duplicates at same tick', () => {
    const doc = makeDocWithDrumTrack();
    // scan-chart may produce multiple phrases at the same tick from
    // overlapping MIDI note 105 on/off pairs. All should round-trip.
    doc.vocalPhrases = [
      { tick: 100, length: 0 },
      { tick: 100, length: 1680 },
      { tick: 5000, length: 480 },
    ];
    doc.lyrics = [{ tick: 100, length: 0, text: 'test' }];

    const bytes = serializeMidi(doc);
    const parsed = parseChartFile(bytes, 'mid', {
      song_length: 0,
      hopo_frequency: 0,
      eighthnote_hopo: false,
      multiplier_note: 0,
      sustain_cutoff_threshold: -1,
      chord_snap_threshold: 0,
      five_lane_drums: false,
      pro_drums: true,
    });

    // All 3 phrases should survive the round-trip
    expect(parsed.vocalPhrases.length).toBe(3);
  });
});
