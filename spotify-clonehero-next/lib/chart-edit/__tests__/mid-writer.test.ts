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
import { parseChartFile } from '@eliwhite/scan-chart';

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

  it('emits ENABLE_CHART_DYNAMICS text event when accents present', () => {
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
      (e) => (e as any).text === 'ENABLE_CHART_DYNAMICS',
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
