/**
 * Tests for cross-format cymbal/tom marker conversion (B4).
 *
 * .chart uses cymbal markers (presence = cymbal, absence = tom).
 * MIDI uses tom markers (presence = tom, absence = cymbal).
 * When writing to the OTHER format, the conversion must be applied:
 *   .chart → MIDI: generate tom markers for non-cymbal notes
 *   MIDI → .chart: generate cymbal markers for non-tom notes
 */

import {
  createChart,
  addDrumNote,
  addStarPower,
  eventTypes,
} from '../index';
import type { ChartDocument, TrackData } from '../types';
import { serializeMidi } from '../writer-mid';
import { serializeChart } from '../writer-chart';
import { parseMidi } from 'midi-file';
import type { MidiEvent } from 'midi-file';
import { parseChartFile, noteFlags, noteTypes } from '@eliwhite/scan-chart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDocWithDrumTrack(
  format: 'chart' | 'mid',
  difficulty: 'expert' | 'hard' | 'medium' | 'easy' = 'expert',
  resolution = 480,
): ChartDocument {
  const doc = createChart({ format, resolution });
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

/** Find noteOn events at a specific MIDI note number. */
function findNoteOns(track: MidiEvent[], noteNumber: number): MidiEvent[] {
  return track.filter(
    (e) => e.type === 'noteOn' && (e as any).noteNumber === noteNumber,
  );
}

// ---------------------------------------------------------------------------
// C1: Cross-format round-trip tests
// ---------------------------------------------------------------------------

describe('cross-format cymbal/tom conversion', () => {
  // -------------------------------------------------------------------------
  // .chart → MIDI: cymbal markers must produce tom markers for non-cymbal notes
  // -------------------------------------------------------------------------

  describe('.chart → MIDI', () => {
    it('cymbal note stays cymbal, non-cymbal note gets tom marker', () => {
      // Build a .chart-sourced doc: yellowDrum at tick 0 WITH cymbalMarker (= cymbal),
      // blueDrum at tick 0 WITHOUT cymbalMarker (= tom in .chart convention)
      const doc = makeDocWithDrumTrack('chart');
      const track = getTrack(doc);

      // Yellow drum as cymbal (has cymbal marker)
      addDrumNote(track, { tick: 0, type: 'yellowDrum', length: 1, flags: { cymbal: true } });
      // Blue drum as tom (no cymbal marker)
      addDrumNote(track, { tick: 0, type: 'blueDrum', length: 1 });

      // Write to MIDI (cross-format: .chart → .mid)
      const bytes = serializeMidi(doc);

      // Parse back via scan-chart
      const parsed = parseChartFile(bytes, 'mid');
      const drumTrack = parsed.trackData.find(
        (t) => t.instrument === 'drums' && t.difficulty === 'expert',
      );
      expect(drumTrack).toBeDefined();

      const allNotes = drumTrack!.noteEventGroups.flat();

      // Yellow drum should be cymbal (no tom marker emitted → default is cymbal in MIDI)
      const yellowNotes = allNotes.filter((n) => n.type === noteTypes.yellowDrum);
      expect(yellowNotes.length).toBe(1);
      expect(yellowNotes[0].flags & noteFlags.cymbal).not.toBe(0);

      // Blue drum should be tom (tom marker emitted → tom in MIDI)
      const blueNotes = allNotes.filter((n) => n.type === noteTypes.blueDrum);
      expect(blueNotes.length).toBe(1);
      expect(blueNotes[0].flags & noteFlags.tom).not.toBe(0);
    });

    it('emits tom marker MIDI notes for non-cymbal notes', () => {
      const doc = makeDocWithDrumTrack('chart');
      const track = getTrack(doc);

      // Yellow cymbal, blue tom, green tom
      addDrumNote(track, { tick: 0, type: 'yellowDrum', length: 1, flags: { cymbal: true } });
      addDrumNote(track, { tick: 0, type: 'blueDrum', length: 1 });
      addDrumNote(track, { tick: 0, type: 'greenDrum', length: 1 });

      const bytes = serializeMidi(doc);
      const midi = parseMidi(bytes);
      const drumTrack = midi.tracks[2];

      // No yellow tom marker (110) — yellow is cymbal
      expect(findNoteOns(drumTrack, 110).length).toBe(0);
      // Blue tom marker (111) — blue is tom
      expect(findNoteOns(drumTrack, 111).length).toBe(1);
      // Green tom marker (112) — green is tom
      expect(findNoteOns(drumTrack, 112).length).toBe(1);
    });

    it('preserves note count in .chart → MIDI round-trip', () => {
      const doc = makeDocWithDrumTrack('chart');
      const track = getTrack(doc);

      // Mix of cymbal and tom notes at various ticks
      addDrumNote(track, { tick: 0, type: 'kick', length: 1 });
      addDrumNote(track, { tick: 0, type: 'yellowDrum', length: 1, flags: { cymbal: true } });
      addDrumNote(track, { tick: 480, type: 'blueDrum', length: 1 });
      addDrumNote(track, { tick: 480, type: 'greenDrum', length: 1, flags: { cymbal: true } });
      addDrumNote(track, { tick: 960, type: 'redDrum', length: 1 });

      const bytes = serializeMidi(doc);
      const parsed = parseChartFile(bytes, 'mid');
      const drumTrack = parsed.trackData.find(
        (t) => t.instrument === 'drums' && t.difficulty === 'expert',
      );
      expect(drumTrack).toBeDefined();

      // 3 note event groups (3 distinct ticks)
      expect(drumTrack!.noteEventGroups.length).toBe(3);

      // Total notes: kick + yellow + blue + green + red = 5
      const allNotes = drumTrack!.noteEventGroups.flat();
      expect(allNotes.length).toBe(5);
    });

    it('does not emit tom markers when data already has tom markers (MIDI-sourced)', () => {
      // If data already has MIDI-style tom markers, no conversion should happen
      const doc = makeDocWithDrumTrack('mid');
      const track = getTrack(doc);

      addDrumNote(track, { tick: 0, type: 'yellowDrum', length: 1 });
      // Add a tom marker directly (MIDI-style)
      track.trackEvents.push({ tick: 0, length: 0, type: eventTypes.yellowTomMarker });

      const bytes = serializeMidi(doc);
      const midi = parseMidi(bytes);
      const drumTrack = midi.tracks[2];

      // Only ONE yellow tom marker note at 110
      expect(findNoteOns(drumTrack, 110).length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // MIDI → .chart: tom markers must produce cymbal markers for non-tom notes
  // -------------------------------------------------------------------------

  describe('MIDI → .chart', () => {
    it('tom note stays tom, non-tom note gets cymbal marker', () => {
      // Build a MIDI-sourced doc: yellowDrum at tick 0 WITH tomMarker (= tom),
      // blueDrum at tick 0 WITHOUT tomMarker (= cymbal in MIDI convention)
      const doc = makeDocWithDrumTrack('mid');
      const track = getTrack(doc);

      // Yellow drum as tom (has tom marker)
      addDrumNote(track, { tick: 0, type: 'yellowDrum', length: 1 });
      track.trackEvents.push({ tick: 0, length: 0, type: eventTypes.yellowTomMarker });

      // Blue drum as cymbal (no tom marker)
      addDrumNote(track, { tick: 0, type: 'blueDrum', length: 1 });

      // Write to .chart (cross-format: MIDI → .chart)
      const text = serializeChart(doc);
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const parsed = parseChartFile(data, 'chart');

      const drumTrack = parsed.trackData.find(
        (t) => t.instrument === 'drums' && t.difficulty === 'expert',
      );
      expect(drumTrack).toBeDefined();

      const allNotes = drumTrack!.noteEventGroups.flat();

      // Yellow drum should NOT have cymbal flag (it's a tom)
      const yellowNotes = allNotes.filter((n) => n.type === noteTypes.yellowDrum);
      expect(yellowNotes.length).toBe(1);
      expect(yellowNotes[0].flags & noteFlags.cymbal).toBe(0);

      // Blue drum should have cymbal flag (cymbal marker generated)
      const blueNotes = allNotes.filter((n) => n.type === noteTypes.blueDrum);
      expect(blueNotes.length).toBe(1);
      expect(blueNotes[0].flags & noteFlags.cymbal).not.toBe(0);
    });

    it('emits cymbal marker chart notes for non-tom notes', () => {
      const doc = makeDocWithDrumTrack('mid');
      const track = getTrack(doc);

      // Yellow tom (has tom marker), blue cymbal (no tom marker), green cymbal
      addDrumNote(track, { tick: 0, type: 'yellowDrum', length: 1 });
      track.trackEvents.push({ tick: 0, length: 0, type: eventTypes.yellowTomMarker });
      addDrumNote(track, { tick: 0, type: 'blueDrum', length: 1 });
      addDrumNote(track, { tick: 0, type: 'greenDrum', length: 1 });

      const text = serializeChart(doc);

      // Should NOT have N 66 (yellow cymbal marker) — yellow is tom
      // Should have N 67 (blue cymbal marker) — blue is cymbal
      // Should have N 68 (green cymbal marker) — green is cymbal
      const lines = text.split('\r\n');
      const noteLines = lines.filter((l) => l.includes('= N'));

      const hasCymbal66 = noteLines.some((l) => l.includes('N 66'));
      const hasCymbal67 = noteLines.some((l) => l.includes('N 67'));
      const hasCymbal68 = noteLines.some((l) => l.includes('N 68'));

      expect(hasCymbal66).toBe(false); // yellow is tom, no cymbal marker
      expect(hasCymbal67).toBe(true);  // blue is cymbal
      expect(hasCymbal68).toBe(true);  // green is cymbal
    });

    it('does not emit cymbal markers when data already has cymbal markers (.chart-sourced)', () => {
      // If data already has .chart-style cymbal markers, no conversion should happen
      const doc = makeDocWithDrumTrack('chart');
      const track = getTrack(doc);

      addDrumNote(track, { tick: 0, type: 'yellowDrum', length: 1, flags: { cymbal: true } });

      const text = serializeChart(doc);
      const lines = text.split('\r\n');
      const cymbalLines = lines.filter((l) => l.includes('N 66'));

      // Exactly one cymbal marker (from the original data, not duplicated by conversion)
      expect(cymbalLines.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Full round-trip preservation
  // -------------------------------------------------------------------------

  describe('full round-trip preservation', () => {
    it('.chart → MIDI → parse preserves cymbal/tom distinction for all lanes', () => {
      const doc = makeDocWithDrumTrack('chart');
      const track = getTrack(doc);

      // Tick 0: yellow cymbal, blue tom
      addDrumNote(track, { tick: 0, type: 'yellowDrum', length: 1, flags: { cymbal: true } });
      addDrumNote(track, { tick: 0, type: 'blueDrum', length: 1 });

      // Tick 480: yellow tom, green cymbal
      addDrumNote(track, { tick: 480, type: 'yellowDrum', length: 1 });
      addDrumNote(track, { tick: 480, type: 'greenDrum', length: 1, flags: { cymbal: true } });

      const bytes = serializeMidi(doc);
      const parsed = parseChartFile(bytes, 'mid');
      const drumTrack = parsed.trackData.find(
        (t) => t.instrument === 'drums' && t.difficulty === 'expert',
      );
      expect(drumTrack).toBeDefined();

      const allNotes = drumTrack!.noteEventGroups.flat();

      // Tick 0: yellow should be cymbal
      const yellowAt0 = allNotes.find(
        (n) => n.type === noteTypes.yellowDrum && n.tick === 0,
      );
      expect(yellowAt0).toBeDefined();
      expect(yellowAt0!.flags & noteFlags.cymbal).not.toBe(0);

      // Tick 0: blue should be tom
      const blueAt0 = allNotes.find(
        (n) => n.type === noteTypes.blueDrum && n.tick === 0,
      );
      expect(blueAt0).toBeDefined();
      expect(blueAt0!.flags & noteFlags.tom).not.toBe(0);

      // Tick 480: yellow should be tom
      const yellowAt480 = allNotes.find(
        (n) => n.type === noteTypes.yellowDrum && n.tick === 480,
      );
      expect(yellowAt480).toBeDefined();
      expect(yellowAt480!.flags & noteFlags.tom).not.toBe(0);

      // Tick 480: green should be cymbal
      const greenAt480 = allNotes.find(
        (n) => n.type === noteTypes.greenDrum && n.tick === 480,
      );
      expect(greenAt480).toBeDefined();
      expect(greenAt480!.flags & noteFlags.cymbal).not.toBe(0);
    });

    it('MIDI → .chart → parse preserves cymbal/tom distinction', () => {
      const doc = makeDocWithDrumTrack('mid');
      const track = getTrack(doc);

      // Yellow tom (has tom marker), blue cymbal (no tom marker)
      addDrumNote(track, { tick: 0, type: 'yellowDrum', length: 1 });
      track.trackEvents.push({ tick: 0, length: 0, type: eventTypes.yellowTomMarker });
      addDrumNote(track, { tick: 0, type: 'blueDrum', length: 1 });

      const text = serializeChart(doc);
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const parsed = parseChartFile(data, 'chart');

      const drumTrack = parsed.trackData.find(
        (t) => t.instrument === 'drums' && t.difficulty === 'expert',
      );
      expect(drumTrack).toBeDefined();

      const allNotes = drumTrack!.noteEventGroups.flat();

      // Yellow should NOT have cymbal (it's a tom)
      const yellowNotes = allNotes.filter((n) => n.type === noteTypes.yellowDrum);
      expect(yellowNotes.length).toBe(1);
      expect(yellowNotes[0].flags & noteFlags.cymbal).toBe(0);

      // Blue should have cymbal
      const blueNotes = allNotes.filter((n) => n.type === noteTypes.blueDrum);
      expect(blueNotes.length).toBe(1);
      expect(blueNotes[0].flags & noteFlags.cymbal).not.toBe(0);
    });
  });
});
