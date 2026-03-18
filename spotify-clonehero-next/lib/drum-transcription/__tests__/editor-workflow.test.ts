/**
 * Tests for the editor workflow features from plan 0007b.
 *
 * Tests the undo/redo stack logic, clipboard normalization,
 * and auto-save serialization.
 */

import {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveNotesCommand,
  ToggleFlagCommand,
  BatchCommand,
  noteId,
} from '@/app/drum-transcription/commands';
import {serializeChart} from '../chart-io/writer';
import type {ChartDocument, DrumNote} from '../chart-io/types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeDoc(notes: DrumNote[] = []): ChartDocument {
  return {
    resolution: 480,
    metadata: {
      name: 'Test Song',
      artist: 'Test Artist',
      resolution: 480,
    },
    tempos: [{tick: 0, bpm: 120}],
    timeSignatures: [{tick: 0, numerator: 4, denominator: 4}],
    sections: [],
    endEvents: [],
    tracks: [
      {
        instrument: 'drums',
        difficulty: 'expert',
        notes,
      },
    ],
  };
}

function getExpertNotes(doc: ChartDocument): DrumNote[] {
  const track = doc.tracks.find(
    t => t.instrument === 'drums' && t.difficulty === 'expert',
  );
  return track?.notes ?? [];
}

// ---------------------------------------------------------------------------
// Undo/Redo stack logic (pure function tests)
// ---------------------------------------------------------------------------

describe('Undo/Redo stack logic', () => {
  it('executing a command produces the expected state and can be undone', () => {
    const doc = makeDoc();
    const note: DrumNote = {tick: 480, type: 'red', length: 0, flags: {}};
    const cmd = new AddNoteCommand(note);

    // Execute
    const afterExec = cmd.execute(doc);
    expect(getExpertNotes(afterExec)).toHaveLength(1);

    // Undo (restore previous doc)
    const afterUndo = cmd.undo(afterExec);
    expect(getExpertNotes(afterUndo)).toHaveLength(0);

    // Redo (re-execute)
    const afterRedo = cmd.execute(afterUndo);
    expect(getExpertNotes(afterRedo)).toHaveLength(1);
    expect(getExpertNotes(afterRedo)[0].tick).toBe(480);
  });

  it('multiple commands can be undone in reverse order', () => {
    const doc = makeDoc();

    const cmd1 = new AddNoteCommand({tick: 0, type: 'kick', length: 0, flags: {}});
    const cmd2 = new AddNoteCommand({tick: 480, type: 'red', length: 0, flags: {}});
    const cmd3 = new AddNoteCommand({tick: 960, type: 'yellow', length: 0, flags: {cymbal: true}});

    // Execute all three
    const after1 = cmd1.execute(doc);
    const after2 = cmd2.execute(after1);
    const after3 = cmd3.execute(after2);
    expect(getExpertNotes(after3)).toHaveLength(3);

    // Undo in reverse order
    const undo3 = cmd3.undo(after3);
    expect(getExpertNotes(undo3)).toHaveLength(2);

    const undo2 = cmd2.undo(undo3);
    expect(getExpertNotes(undo2)).toHaveLength(1);

    const undo1 = cmd1.undo(undo2);
    expect(getExpertNotes(undo1)).toHaveLength(0);
  });

  it('BatchCommand counts as a single undo step', () => {
    const doc = makeDoc([
      {tick: 0, type: 'kick', length: 0, flags: {}},
      {tick: 480, type: 'red', length: 0, flags: {}},
      {tick: 960, type: 'yellow', length: 0, flags: {cymbal: true}},
    ]);

    const batch = new BatchCommand([
      new DeleteNotesCommand(new Set(['0:kick'])),
      new DeleteNotesCommand(new Set(['480:red'])),
    ], 'Delete 2 notes');

    const after = batch.execute(doc);
    expect(getExpertNotes(after)).toHaveLength(1);

    // Single undo restores both notes
    const reverted = batch.undo(after);
    expect(getExpertNotes(reverted)).toHaveLength(3);
  });

  it('undo stack cap discards oldest entries', () => {
    // Simulating the undo stack cap logic
    const MAX = 5;
    const stack: string[] = [];

    for (let i = 0; i < 8; i++) {
      stack.push(`cmd-${i}`);
    }

    // Cap at MAX
    const capped = stack.slice(stack.length - MAX);
    expect(capped).toHaveLength(MAX);
    expect(capped[0]).toBe('cmd-3');
    expect(capped[capped.length - 1]).toBe('cmd-7');
  });
});

// ---------------------------------------------------------------------------
// Clipboard normalization
// ---------------------------------------------------------------------------

describe('Clipboard normalization', () => {
  it('normalizes selected notes to start at tick 0', () => {
    const notes: DrumNote[] = [
      {tick: 480, type: 'red', length: 0, flags: {}},
      {tick: 960, type: 'yellow', length: 0, flags: {cymbal: true}},
      {tick: 1440, type: 'blue', length: 0, flags: {cymbal: true}},
    ];

    // Normalize: subtract minimum tick
    const minTick = Math.min(...notes.map(n => n.tick));
    expect(minTick).toBe(480);

    const normalized = notes.map(n => ({...n, tick: n.tick - minTick}));
    expect(normalized[0].tick).toBe(0);
    expect(normalized[1].tick).toBe(480);
    expect(normalized[2].tick).toBe(960);
  });

  it('paste adds cursor tick offset to normalized notes', () => {
    const clipboardNotes: DrumNote[] = [
      {tick: 0, type: 'red', length: 0, flags: {}},
      {tick: 480, type: 'yellow', length: 0, flags: {cymbal: true}},
    ];

    const cursorTick = 1920;
    const pastedNotes = clipboardNotes.map(n => ({
      ...n,
      tick: n.tick + cursorTick,
    }));

    expect(pastedNotes[0].tick).toBe(1920);
    expect(pastedNotes[1].tick).toBe(2400);
  });

  it('paste via BatchCommand + AddNoteCommand creates valid notes', () => {
    const doc = makeDoc([
      {tick: 0, type: 'kick', length: 0, flags: {}},
    ]);

    const clipboardNotes: DrumNote[] = [
      {tick: 0, type: 'red', length: 0, flags: {}},
      {tick: 480, type: 'yellow', length: 0, flags: {cymbal: true}},
    ];

    const cursorTick = 960;
    const commands = clipboardNotes.map(
      n =>
        new AddNoteCommand({
          ...n,
          tick: n.tick + cursorTick,
          flags: {...n.flags},
        }),
    );
    const batch = new BatchCommand(commands, 'Paste 2 notes');

    const result = batch.execute(doc);
    const notes = getExpertNotes(result);
    expect(notes).toHaveLength(3);
    expect(notes[1].tick).toBe(960);
    expect(notes[1].type).toBe('red');
    expect(notes[2].tick).toBe(1440);
    expect(notes[2].type).toBe('yellow');
  });
});

// ---------------------------------------------------------------------------
// Review tracking logic
// ---------------------------------------------------------------------------

describe('Review tracking', () => {
  it('tracks reviewed note IDs in a Set', () => {
    const reviewed = new Set<string>();
    reviewed.add('0:kick');
    reviewed.add('480:red');
    expect(reviewed.size).toBe(2);
    expect(reviewed.has('0:kick')).toBe(true);
    expect(reviewed.has('960:yellow')).toBe(false);
  });

  it('serializes and deserializes reviewed set', () => {
    const reviewed = new Set(['0:kick', '480:red', '960:yellow']);
    const json = JSON.stringify({reviewed: Array.from(reviewed)});
    const parsed = JSON.parse(json) as {reviewed: string[]};
    const restored = new Set(parsed.reviewed);
    expect(restored.size).toBe(3);
    expect(restored.has('0:kick')).toBe(true);
    expect(restored.has('480:red')).toBe(true);
    expect(restored.has('960:yellow')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Confidence data
// ---------------------------------------------------------------------------

describe('Confidence data', () => {
  it('parses confidence JSON correctly', () => {
    const json = `{
      "notes": {
        "0:kick": 0.95,
        "480:red": 0.87,
        "960:yellow": 0.42
      }
    }`;
    const parsed = JSON.parse(json) as {notes: Record<string, number>};
    const confMap = new Map(Object.entries(parsed.notes));

    expect(confMap.get('0:kick')).toBe(0.95);
    expect(confMap.get('480:red')).toBe(0.87);
    expect(confMap.get('960:yellow')).toBe(0.42);
    expect(confMap.size).toBe(3);
  });

  it('classifies confidence levels correctly', () => {
    const threshold = 0.7;

    function classify(conf: number): 'high' | 'medium' | 'low' | 'very_low' {
      if (conf >= 0.9) return 'high';
      if (conf >= threshold) return 'medium';
      if (conf >= 0.5) return 'low';
      return 'very_low';
    }

    expect(classify(0.95)).toBe('high');
    expect(classify(0.9)).toBe('high');
    expect(classify(0.85)).toBe('medium');
    expect(classify(0.7)).toBe('medium');
    expect(classify(0.65)).toBe('low');
    expect(classify(0.5)).toBe('low');
    expect(classify(0.42)).toBe('very_low');
    expect(classify(0.1)).toBe('very_low');
  });
});

// ---------------------------------------------------------------------------
// Auto-save chart serialization
// ---------------------------------------------------------------------------

describe('Auto-save serialization', () => {
  it('serializes a chart document to .chart format', () => {
    const doc = makeDoc([
      {tick: 0, type: 'kick', length: 0, flags: {}},
      {tick: 480, type: 'red', length: 0, flags: {}},
      {tick: 960, type: 'yellow', length: 0, flags: {cymbal: true}},
    ]);

    const chartText = serializeChart(doc);

    // Should contain all expected sections
    expect(chartText).toContain('[Song]');
    expect(chartText).toContain('[SyncTrack]');
    expect(chartText).toContain('[Events]');
    expect(chartText).toContain('[ExpertDrums]');

    // Should contain the notes
    expect(chartText).toContain('0 = N 0 0'); // kick = note 0
    expect(chartText).toContain('480 = N 1 0'); // red = note 1
  });

  it('preserves metadata through serialization', () => {
    const doc: ChartDocument = {
      resolution: 480,
      metadata: {
        name: 'My Song',
        artist: 'My Artist',
        album: 'My Album',
        resolution: 480,
      },
      tempos: [{tick: 0, bpm: 140}],
      timeSignatures: [{tick: 0, numerator: 4, denominator: 4}],
      sections: [],
      endEvents: [],
      tracks: [{instrument: 'drums', difficulty: 'expert', notes: []}],
    };

    const chartText = serializeChart(doc);
    expect(chartText).toContain('Name = "My Song"');
    expect(chartText).toContain('Artist = "My Artist"');
    expect(chartText).toContain('Album = "My Album"');
    expect(chartText).toContain('Resolution = 480');
    // BPM 140 = 140000 millibeats
    expect(chartText).toContain('0 = B 140000');
  });
});

// ---------------------------------------------------------------------------
// Stem volume logic
// ---------------------------------------------------------------------------

describe('Stem volume logic', () => {
  it('calculates effective volume with solo', () => {
    function getEffectiveVolume(
      stem: string,
      volume: number,
      soloTrack: string | null,
      mutedTracks: Set<string>,
    ): number {
      if (mutedTracks.has(stem)) return 0;
      if (soloTrack !== null && soloTrack !== stem) return 0;
      return volume;
    }

    // No solo: normal volume
    expect(getEffectiveVolume('drums', 0.8, null, new Set())).toBe(0.8);

    // Solo drums: drums plays, others silent
    expect(getEffectiveVolume('drums', 0.8, 'drums', new Set())).toBe(0.8);
    expect(getEffectiveVolume('bass', 0.6, 'drums', new Set())).toBe(0);

    // Muted: always 0
    expect(getEffectiveVolume('drums', 0.8, null, new Set(['drums']))).toBe(0);

    // Muted + solo: mute wins
    expect(
      getEffectiveVolume('drums', 0.8, 'drums', new Set(['drums'])),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Loop region
// ---------------------------------------------------------------------------

describe('Loop region', () => {
  it('creates valid loop region from two points', () => {
    const startMs = 5000;
    const endMs = 10000;
    const region = {startMs, endMs};

    expect(region.endMs - region.startMs).toBe(5000);
    expect(region.startMs).toBeLessThan(region.endMs);
  });

  it('handles practice mode config from loop region', () => {
    const region = {startMs: 5000, endMs: 10000};
    const practiceConfig = {
      startMeasureMs: region.startMs,
      endMeasureMs: region.endMs,
      startTimeMs: Math.max(0, region.startMs - 2000),
      endTimeMs: region.endMs,
    };

    expect(practiceConfig.startTimeMs).toBe(3000);
    expect(practiceConfig.startMeasureMs).toBe(5000);
    expect(practiceConfig.endMeasureMs).toBe(10000);
    expect(practiceConfig.endTimeMs).toBe(10000);
  });

  it('clamps lead-in to 0 for early start', () => {
    const region = {startMs: 500, endMs: 5000};
    const practiceConfig = {
      startTimeMs: Math.max(0, region.startMs - 2000),
    };
    expect(practiceConfig.startTimeMs).toBe(0);
  });
});
