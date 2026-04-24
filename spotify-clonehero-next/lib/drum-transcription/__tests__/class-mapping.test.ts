/**
 * Tests for the CRNN class to chart note mapping.
 *
 * Verifies:
 * - 9-class -> note number mapping
 * - 9-class -> cymbal marker mapping
 * - 9-class -> DrumNoteType mapping
 * - RawDrumEvent[] -> DrumNote[] conversion (with tick quantization)
 * - RawDrumEvent[] -> EditorDrumEvent[] conversion
 */

import {
  getChartMapping,
  drumClassToNoteNumber,
  drumClassToCymbalMarker,
  drumClassToDrumNoteType,
  rawEventsToDrumNotes,
  rawEventsToEditorEvents,
} from '../ml/class-mapping';
import type {RawDrumEvent, DrumClassName} from '../ml/types';

// ---------------------------------------------------------------------------
// drumClassToNoteNumber
// ---------------------------------------------------------------------------

describe('drumClassToNoteNumber', () => {
  it('maps BD to note 0 (kick)', () => {
    expect(drumClassToNoteNumber('BD')).toBe(0);
  });

  it('maps SD to note 1 (red/snare)', () => {
    expect(drumClassToNoteNumber('SD')).toBe(1);
  });

  it('maps HT to note 2 (yellow/hi-tom)', () => {
    expect(drumClassToNoteNumber('HT')).toBe(2);
  });

  it('maps MT to note 3 (blue/mid-tom)', () => {
    expect(drumClassToNoteNumber('MT')).toBe(3);
  });

  it('maps FT to note 4 (green/floor-tom)', () => {
    expect(drumClassToNoteNumber('FT')).toBe(4);
  });

  it('maps HH to note 2 (yellow/hihat)', () => {
    expect(drumClassToNoteNumber('HH')).toBe(2);
  });

  it('maps CR to note 4 (green/crash)', () => {
    expect(drumClassToNoteNumber('CR')).toBe(4);
  });

  it('maps CR2 to note 3 (blue/crash-2)', () => {
    expect(drumClassToNoteNumber('CR2')).toBe(3);
  });

  it('maps RD to note 3 (blue/ride)', () => {
    expect(drumClassToNoteNumber('RD')).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// drumClassToCymbalMarker
// ---------------------------------------------------------------------------

describe('drumClassToCymbalMarker', () => {
  it('returns null for pads (BD, SD, HT, MT, FT)', () => {
    expect(drumClassToCymbalMarker('BD')).toBeNull();
    expect(drumClassToCymbalMarker('SD')).toBeNull();
    expect(drumClassToCymbalMarker('HT')).toBeNull();
    expect(drumClassToCymbalMarker('MT')).toBeNull();
    expect(drumClassToCymbalMarker('FT')).toBeNull();
  });

  it('returns 66 for HH (yellow cymbal)', () => {
    expect(drumClassToCymbalMarker('HH')).toBe(66);
  });

  it('returns 68 for CR (green cymbal)', () => {
    expect(drumClassToCymbalMarker('CR')).toBe(68);
  });

  it('returns 67 for CR2 (blue cymbal)', () => {
    expect(drumClassToCymbalMarker('CR2')).toBe(67);
  });

  it('returns 67 for RD (blue cymbal)', () => {
    expect(drumClassToCymbalMarker('RD')).toBe(67);
  });
});

// ---------------------------------------------------------------------------
// drumClassToDrumNoteType
// ---------------------------------------------------------------------------

describe('drumClassToDrumNoteType', () => {
  const expected: Record<DrumClassName, string> = {
    BD: 'kick',
    SD: 'redDrum',
    HT: 'yellowDrum',
    MT: 'blueDrum',
    FT: 'greenDrum',
    HH: 'yellowDrum',
    CR: 'greenDrum',
    CR2: 'blueDrum',
    RD: 'blueDrum',
  };

  for (const [cls, type] of Object.entries(expected)) {
    it(`maps ${cls} to ${type}`, () => {
      expect(drumClassToDrumNoteType(cls as DrumClassName)).toBe(type);
    });
  }
});

// ---------------------------------------------------------------------------
// getChartMapping
// ---------------------------------------------------------------------------

describe('getChartMapping', () => {
  it('returns complete mapping for each class', () => {
    const classes: DrumClassName[] = [
      'BD',
      'SD',
      'HT',
      'MT',
      'FT',
      'HH',
      'CR',
      'CR2',
      'RD',
    ];

    for (const cls of classes) {
      const mapping = getChartMapping(cls);
      expect(mapping).toBeDefined();
      expect(typeof mapping.noteType).toBe('string');
      expect(typeof mapping.noteNumber).toBe('number');
      expect(typeof mapping.isCymbal).toBe('boolean');
    }
  });

  it('cymbal classes have cymbal markers, pad classes do not', () => {
    // Cymbals
    expect(getChartMapping('HH').isCymbal).toBe(true);
    expect(getChartMapping('HH').cymbalMarker).toBe(66);

    expect(getChartMapping('CR').isCymbal).toBe(true);
    expect(getChartMapping('CR').cymbalMarker).toBe(68);

    expect(getChartMapping('CR2').isCymbal).toBe(true);
    expect(getChartMapping('CR2').cymbalMarker).toBe(67);

    expect(getChartMapping('RD').isCymbal).toBe(true);
    expect(getChartMapping('RD').cymbalMarker).toBe(67);

    // Pads
    expect(getChartMapping('BD').isCymbal).toBe(false);
    expect(getChartMapping('BD').cymbalMarker).toBeNull();

    expect(getChartMapping('SD').isCymbal).toBe(false);
    expect(getChartMapping('SD').cymbalMarker).toBeNull();

    expect(getChartMapping('HT').isCymbal).toBe(false);
    expect(getChartMapping('HT').cymbalMarker).toBeNull();

    expect(getChartMapping('MT').isCymbal).toBe(false);
    expect(getChartMapping('MT').cymbalMarker).toBeNull();

    expect(getChartMapping('FT').isCymbal).toBe(false);
    expect(getChartMapping('FT').cymbalMarker).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rawEventsToDrumNotes
// ---------------------------------------------------------------------------

describe('rawEventsToDrumNotes', () => {
  const tempos = [{tick: 0, beatsPerMinute: 120}];
  const resolution = 480;

  it('converts events to drum notes with correct types', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'BD', midiPitch: 36, confidence: 0.9},
      {timeSeconds: 0.5, drumClass: 'SD', midiPitch: 38, confidence: 0.85},
      {timeSeconds: 1.0, drumClass: 'HH', midiPitch: 42, confidence: 0.7},
    ];

    const notes = rawEventsToDrumNotes(events, tempos, resolution);

    expect(notes.length).toBe(3);
    expect(notes[0].type).toBe('kick');
    expect(notes[1].type).toBe('redDrum');
    expect(notes[2].type).toBe('yellowDrum');
  });

  it('computes correct tick positions at 120 BPM', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'BD', midiPitch: 36, confidence: 0.9},
      {timeSeconds: 0.5, drumClass: 'SD', midiPitch: 38, confidence: 0.85},
      {timeSeconds: 1.0, drumClass: 'BD', midiPitch: 36, confidence: 0.8},
    ];

    const notes = rawEventsToDrumNotes(events, tempos, resolution);

    expect(notes[0].tick).toBe(0);
    expect(notes[1].tick).toBe(480);
    expect(notes[2].tick).toBe(960);
  });

  it('sets cymbal flag for HH, CR, CR2, RD', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'HH', midiPitch: 42, confidence: 0.8},
      {timeSeconds: 0.5, drumClass: 'CR', midiPitch: 49, confidence: 0.7},
      {timeSeconds: 1.0, drumClass: 'HT', midiPitch: 50, confidence: 0.6},
      {timeSeconds: 1.5, drumClass: 'RD', midiPitch: 51, confidence: 0.7},
      {timeSeconds: 2.0, drumClass: 'CR2', midiPitch: 57, confidence: 0.6},
    ];

    const notes = rawEventsToDrumNotes(events, tempos, resolution);

    expect(notes[0].flags.cymbal).toBe(true); // HH
    expect(notes[1].flags.cymbal).toBe(true); // CR
    expect(notes[2].flags.cymbal).toBeUndefined(); // HT (tom pad)
    expect(notes[3].flags.cymbal).toBe(true); // RD
    expect(notes[4].flags.cymbal).toBe(true); // CR2
  });

  it('all notes have length 0 (non-sustained drums)', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'BD', midiPitch: 36, confidence: 0.9},
      {timeSeconds: 0.5, drumClass: 'SD', midiPitch: 38, confidence: 0.85},
    ];

    const notes = rawEventsToDrumNotes(events, tempos, resolution);

    for (const note of notes) {
      expect(note.length).toBe(0);
    }
  });

  it('sorts notes by tick', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 1.0, drumClass: 'BD', midiPitch: 36, confidence: 0.9},
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
    const temposWithChange = [
      {tick: 0, beatsPerMinute: 120},
      {tick: 480, beatsPerMinute: 60},
    ];

    const events: RawDrumEvent[] = [
      {timeSeconds: 0.0, drumClass: 'BD', midiPitch: 36, confidence: 0.9},
      {timeSeconds: 0.5, drumClass: 'SD', midiPitch: 38, confidence: 0.8},
      {timeSeconds: 1.5, drumClass: 'BD', midiPitch: 36, confidence: 0.7},
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
  const tempos = [{tick: 0, beatsPerMinute: 120}];
  const resolution = 480;

  it('creates editor events with unique IDs', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'BD', midiPitch: 36, confidence: 0.9},
      {timeSeconds: 0.5, drumClass: 'SD', midiPitch: 38, confidence: 0.85},
    ];

    const editorEvents = rawEventsToEditorEvents(events, tempos, resolution);

    expect(editorEvents.length).toBe(2);
    expect(editorEvents[0].id).not.toBe(editorEvents[1].id);
  });

  it('preserves confidence scores', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'BD', midiPitch: 36, confidence: 0.9},
      {timeSeconds: 0.5, drumClass: 'SD', midiPitch: 38, confidence: 0.42},
    ];

    const editorEvents = rawEventsToEditorEvents(events, tempos, resolution);

    expect(editorEvents[0].confidence).toBe(0.9);
    expect(editorEvents[1].confidence).toBe(0.42);
  });

  it('sets correct note numbers and cymbal markers for all 9 classes', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'BD', midiPitch: 36, confidence: 0.9},
      {timeSeconds: 0.1, drumClass: 'HH', midiPitch: 42, confidence: 0.8},
      {timeSeconds: 0.2, drumClass: 'CR', midiPitch: 49, confidence: 0.7},
      {timeSeconds: 0.3, drumClass: 'RD', midiPitch: 51, confidence: 0.7},
      {timeSeconds: 0.4, drumClass: 'CR2', midiPitch: 57, confidence: 0.6},
    ];

    const editorEvents = rawEventsToEditorEvents(events, tempos, resolution);

    // BD: note 0, no cymbal marker
    expect(editorEvents[0].noteNumber).toBe(0);
    expect(editorEvents[0].cymbalMarker).toBeNull();

    // HH: note 2, cymbal marker 66
    expect(editorEvents[1].noteNumber).toBe(2);
    expect(editorEvents[1].cymbalMarker).toBe(66);

    // CR: note 4, cymbal marker 68
    expect(editorEvents[2].noteNumber).toBe(4);
    expect(editorEvents[2].cymbalMarker).toBe(68);

    // RD: note 3, cymbal marker 67
    expect(editorEvents[3].noteNumber).toBe(3);
    expect(editorEvents[3].cymbalMarker).toBe(67);

    // CR2: note 3, cymbal marker 67
    expect(editorEvents[4].noteNumber).toBe(3);
    expect(editorEvents[4].cymbalMarker).toBe(67);
  });

  it('marks all events as model-sourced and unreviewed', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'BD', midiPitch: 36, confidence: 0.9},
    ];

    const editorEvents = rawEventsToEditorEvents(events, tempos, resolution);

    expect(editorEvents[0].source).toBe('model');
    expect(editorEvents[0].reviewed).toBe(false);
  });

  it('computes correct msTime', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 1.5, drumClass: 'BD', midiPitch: 36, confidence: 0.9},
    ];

    const editorEvents = rawEventsToEditorEvents(events, tempos, resolution);

    expect(editorEvents[0].msTime).toBe(1500);
  });

  it('preserves modelClass name', () => {
    const events: RawDrumEvent[] = [
      {timeSeconds: 0, drumClass: 'CR', midiPitch: 49, confidence: 0.7},
    ];

    const editorEvents = rawEventsToEditorEvents(events, tempos, resolution);

    expect(editorEvents[0].modelClass).toBe('CR');
  });
});
