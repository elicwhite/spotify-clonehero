/**
 * Tests for the ADTOF class to chart note mapping.
 *
 * Verifies:
 * - ADTOF class -> note number mapping
 * - ADTOF class -> cymbal marker mapping
 * - ADTOF class -> DrumNoteType mapping
 * - RawDrumEvent[] -> DrumNote[] conversion (with tick quantization)
 * - RawDrumEvent[] -> EditorDrumEvent[] conversion
 */

import {
  getChartMapping,
  adtofClassToNoteNumber,
  adtofClassToCymbalMarker,
  adtofClassToDrumNoteType,
  rawEventsToDrumNotes,
  rawEventsToEditorEvents,
} from '../ml/class-mapping';
import type {RawDrumEvent, AdtofClassName} from '../ml/types';
import type {TempoEvent} from '../chart-io/types';

// ---------------------------------------------------------------------------
// adtofClassToNoteNumber
// ---------------------------------------------------------------------------

describe('adtofClassToNoteNumber', () => {
  it('maps BD to note 0 (kick)', () => {
    expect(adtofClassToNoteNumber('BD')).toBe(0);
  });

  it('maps SD to note 1 (red/snare)', () => {
    expect(adtofClassToNoteNumber('SD')).toBe(1);
  });

  it('maps HH to note 2 (yellow)', () => {
    expect(adtofClassToNoteNumber('HH')).toBe(2);
  });

  it('maps TT to note 3 (blue)', () => {
    expect(adtofClassToNoteNumber('TT')).toBe(3);
  });

  it('maps CY+RD to note 4 (green)', () => {
    expect(adtofClassToNoteNumber('CY+RD')).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// adtofClassToCymbalMarker
// ---------------------------------------------------------------------------

describe('adtofClassToCymbalMarker', () => {
  it('returns null for BD (no cymbal)', () => {
    expect(adtofClassToCymbalMarker('BD')).toBeNull();
  });

  it('returns null for SD (no cymbal)', () => {
    expect(adtofClassToCymbalMarker('SD')).toBeNull();
  });

  it('returns 66 for HH (yellow cymbal)', () => {
    expect(adtofClassToCymbalMarker('HH')).toBe(66);
  });

  it('returns null for TT (no cymbal)', () => {
    expect(adtofClassToCymbalMarker('TT')).toBeNull();
  });

  it('returns 68 for CY+RD (green cymbal)', () => {
    expect(adtofClassToCymbalMarker('CY+RD')).toBe(68);
  });
});

// ---------------------------------------------------------------------------
// adtofClassToDrumNoteType
// ---------------------------------------------------------------------------

describe('adtofClassToDrumNoteType', () => {
  const expected: Record<AdtofClassName, string> = {
    BD: 'kick',
    SD: 'red',
    HH: 'yellow',
    TT: 'blue',
    'CY+RD': 'green',
  };

  for (const [cls, type] of Object.entries(expected)) {
    it(`maps ${cls} to ${type}`, () => {
      expect(adtofClassToDrumNoteType(cls as AdtofClassName)).toBe(type);
    });
  }
});

// ---------------------------------------------------------------------------
// getChartMapping
// ---------------------------------------------------------------------------

describe('getChartMapping', () => {
  it('returns complete mapping for each class', () => {
    const classes: AdtofClassName[] = ['BD', 'SD', 'HH', 'TT', 'CY+RD'];

    for (const cls of classes) {
      const mapping = getChartMapping(cls);
      expect(mapping).toBeDefined();
      expect(typeof mapping.noteType).toBe('string');
      expect(typeof mapping.noteNumber).toBe('number');
      expect(typeof mapping.isCymbal).toBe('boolean');
    }
  });

  it('cymbal classes have cymbal markers, non-cymbal classes do not', () => {
    expect(getChartMapping('HH').isCymbal).toBe(true);
    expect(getChartMapping('HH').cymbalMarker).toBe(66);

    expect(getChartMapping('CY+RD').isCymbal).toBe(true);
    expect(getChartMapping('CY+RD').cymbalMarker).toBe(68);

    expect(getChartMapping('BD').isCymbal).toBe(false);
    expect(getChartMapping('BD').cymbalMarker).toBeNull();

    expect(getChartMapping('SD').isCymbal).toBe(false);
    expect(getChartMapping('SD').cymbalMarker).toBeNull();

    expect(getChartMapping('TT').isCymbal).toBe(false);
    expect(getChartMapping('TT').cymbalMarker).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rawEventsToDrumNotes
// ---------------------------------------------------------------------------

describe('rawEventsToDrumNotes', () => {
  const tempos: TempoEvent[] = [{tick: 0, bpm: 120}];
  const resolution = 480;

  it('converts events to drum notes with correct types', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'BD', midiPitch: 35, confidence: 0.9},
      {timeSeconds: 0.5, drumClass: 'SD', midiPitch: 38, confidence: 0.85},
      {timeSeconds: 1.0, drumClass: 'HH', midiPitch: 42, confidence: 0.7},
    ];

    const notes = rawEventsToDrumNotes(events, tempos, resolution);

    expect(notes.length).toBe(3);
    expect(notes[0].type).toBe('kick');
    expect(notes[1].type).toBe('red');
    expect(notes[2].type).toBe('yellow');
  });

  it('computes correct tick positions at 120 BPM', () => {
    // At 120 BPM, 1 beat = 0.5 seconds
    // At resolution 480, 1 beat = 480 ticks
    // So 1 second = 960 ticks
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'BD', midiPitch: 35, confidence: 0.9},
      {timeSeconds: 0.5, drumClass: 'SD', midiPitch: 38, confidence: 0.85},
      {timeSeconds: 1.0, drumClass: 'BD', midiPitch: 35, confidence: 0.8},
    ];

    const notes = rawEventsToDrumNotes(events, tempos, resolution);

    expect(notes[0].tick).toBe(0);
    expect(notes[1].tick).toBe(480); // 0.5s at 120 BPM = 1 beat = 480 ticks
    expect(notes[2].tick).toBe(960); // 1.0s at 120 BPM = 2 beats = 960 ticks
  });

  it('sets cymbal flag for HH and CY+RD', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'HH', midiPitch: 42, confidence: 0.8},
      {timeSeconds: 0.5, drumClass: 'CY+RD', midiPitch: 49, confidence: 0.7},
      {timeSeconds: 1.0, drumClass: 'TT', midiPitch: 47, confidence: 0.6},
    ];

    const notes = rawEventsToDrumNotes(events, tempos, resolution);

    expect(notes[0].flags.cymbal).toBe(true); // HH
    expect(notes[1].flags.cymbal).toBe(true); // CY+RD
    expect(notes[2].flags.cymbal).toBeUndefined(); // TT
  });

  it('all notes have length 0 (non-sustained drums)', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'BD', midiPitch: 35, confidence: 0.9},
      {timeSeconds: 0.5, drumClass: 'SD', midiPitch: 38, confidence: 0.85},
    ];

    const notes = rawEventsToDrumNotes(events, tempos, resolution);

    for (const note of notes) {
      expect(note.length).toBe(0);
    }
  });

  it('sorts notes by tick', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 1.0, drumClass: 'BD', midiPitch: 35, confidence: 0.9},
      {timeSeconds: 0, drumClass: 'SD', midiPitch: 38, confidence: 0.85},
      {timeSeconds: 0.5, drumClass: 'HH', midiPitch: 42, confidence: 0.7},
    ];

    const notes = rawEventsToDrumNotes(events, tempos, resolution);

    for (let i = 1; i < notes.length; i++) {
      expect(notes[i].tick).toBeGreaterThanOrEqual(notes[i - 1].tick);
    }
  });

  it('handles empty events array', () => {
    const notes = rawEventsToDrumNotes([], tempos, resolution);
    expect(notes.length).toBe(0);
  });

  it('handles tempo changes', () => {
    // Starts at 120 BPM, changes to 60 BPM at tick 480
    const temposWithChange: TempoEvent[] = [
      {tick: 0, bpm: 120},
      {tick: 480, bpm: 60},
    ];

    // At 120 BPM: 1 beat = 0.5s
    // 480 ticks (1 beat) takes 0.5s
    // tempo change happens at 0.5s
    // At 60 BPM after that: 1 beat = 1.0s
    // So 1.5s into the song = 0.5s in the first tempo + 1.0s at 60 BPM = 1 beat at 60 = 480 ticks
    // Total tick = 480 + 480 = 960
    const events: RawDrumEvent[] = [
      {timeSeconds: 0.0, drumClass: 'BD', midiPitch: 35, confidence: 0.9},
      {timeSeconds: 0.5, drumClass: 'SD', midiPitch: 38, confidence: 0.8},
      {timeSeconds: 1.5, drumClass: 'BD', midiPitch: 35, confidence: 0.7},
    ];

    const notes = rawEventsToDrumNotes(events, temposWithChange, resolution);

    expect(notes[0].tick).toBe(0);
    expect(notes[1].tick).toBe(480);
    expect(notes[2].tick).toBe(960);
  });
});

// ---------------------------------------------------------------------------
// rawEventsToEditorEvents
// ---------------------------------------------------------------------------

describe('rawEventsToEditorEvents', () => {
  const tempos: TempoEvent[] = [{tick: 0, bpm: 120}];
  const resolution = 480;

  it('creates editor events with unique IDs', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'BD', midiPitch: 35, confidence: 0.9},
      {timeSeconds: 0.5, drumClass: 'SD', midiPitch: 38, confidence: 0.85},
    ];

    const editorEvents = rawEventsToEditorEvents(events, tempos, resolution);

    expect(editorEvents.length).toBe(2);
    expect(editorEvents[0].id).not.toBe(editorEvents[1].id);
  });

  it('preserves confidence scores', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'BD', midiPitch: 35, confidence: 0.9},
      {timeSeconds: 0.5, drumClass: 'SD', midiPitch: 38, confidence: 0.42},
    ];

    const editorEvents = rawEventsToEditorEvents(events, tempos, resolution);

    expect(editorEvents[0].confidence).toBe(0.9);
    expect(editorEvents[1].confidence).toBe(0.42);
  });

  it('sets correct note numbers and cymbal markers', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'BD', midiPitch: 35, confidence: 0.9},
      {timeSeconds: 0.1, drumClass: 'HH', midiPitch: 42, confidence: 0.8},
      {timeSeconds: 0.2, drumClass: 'CY+RD', midiPitch: 49, confidence: 0.7},
    ];

    const editorEvents = rawEventsToEditorEvents(events, tempos, resolution);

    // BD: note 0, no cymbal marker
    expect(editorEvents[0].noteNumber).toBe(0);
    expect(editorEvents[0].cymbalMarker).toBeNull();

    // HH: note 2, cymbal marker 66
    expect(editorEvents[1].noteNumber).toBe(2);
    expect(editorEvents[1].cymbalMarker).toBe(66);

    // CY+RD: note 4, cymbal marker 68
    expect(editorEvents[2].noteNumber).toBe(4);
    expect(editorEvents[2].cymbalMarker).toBe(68);
  });

  it('marks all events as model-sourced and unreviewed', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'BD', midiPitch: 35, confidence: 0.9},
    ];

    const editorEvents = rawEventsToEditorEvents(events, tempos, resolution);

    expect(editorEvents[0].source).toBe('model');
    expect(editorEvents[0].reviewed).toBe(false);
  });

  it('computes correct msTime', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 1.5, drumClass: 'BD', midiPitch: 35, confidence: 0.9},
    ];

    const editorEvents = rawEventsToEditorEvents(events, tempos, resolution);

    expect(editorEvents[0].msTime).toBe(1500);
  });

  it('preserves modelClass name', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'CY+RD', midiPitch: 49, confidence: 0.7},
    ];

    const editorEvents = rawEventsToEditorEvents(events, tempos, resolution);

    expect(editorEvents[0].modelClass).toBe('CY+RD');
  });
});
