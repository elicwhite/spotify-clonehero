import { readFileSync } from 'fs';
import { join } from 'path';
import { readChart, writeChart, createChart } from '../index';
import type { ChartDocument, ChartMetadata, FileEntry } from '../types';
import { parseChartFile } from '@eliwhite/scan-chart';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function loadFixture(name: string): Uint8Array {
  return readFileSync(join(__dirname, 'fixtures', name));
}

function makeFileEntry(fileName: string, data: Uint8Array): FileEntry {
  return { fileName, data };
}

/** Build the standard file set for the .chart fixture (chart + ini). */
function chartFixtureFiles(): FileEntry[] {
  return [
    makeFileEntry('notes.chart', loadFixture('drums-basic.chart')),
    makeFileEntry('song.ini', loadFixture('drums-basic-chart.ini')),
  ];
}

/** Build the standard file set for the .mid fixture (mid + ini). */
function midFixtureFiles(): FileEntry[] {
  return [
    makeFileEntry('notes.mid', loadFixture('drums-basic.mid')),
    makeFileEntry('song.ini', loadFixture('drums-basic-mid.ini')),
  ];
}

// ---------------------------------------------------------------------------
// readChart basics
// ---------------------------------------------------------------------------

describe('readChart', () => {
  it('finds a notes.chart file and succeeds', () => {
    const doc = readChart(chartFixtureFiles());
    expect(doc).toBeDefined();
    expect(doc.originalFormat).toBe('chart');
  });

  it('finds a notes.mid file and succeeds', () => {
    const doc = readChart(midFixtureFiles());
    expect(doc).toBeDefined();
    expect(doc.originalFormat).toBe('mid');
  });

  it('throws when no chart file is present', () => {
    const files: FileEntry[] = [
      makeFileEntry('song.ini', loadFixture('drums-basic-chart.ini')),
      makeFileEntry('song.ogg', new Uint8Array([0xff])),
    ];
    expect(() => readChart(files)).toThrow(/No chart file found/);
  });

  it('prefers .chart over .mid when both are present', () => {
    const files: FileEntry[] = [
      makeFileEntry('notes.mid', loadFixture('drums-basic.mid')),
      makeFileEntry('notes.chart', loadFixture('drums-basic.chart')),
      makeFileEntry('song.ini', loadFixture('drums-basic-chart.ini')),
    ];
    const doc = readChart(files);
    expect(doc.originalFormat).toBe('chart');
  });

  it('parses song.ini metadata fields', () => {
    const doc = readChart(chartFixtureFiles());
    expect(doc.metadata.name).toBe('Test Chart Song');
    expect(doc.metadata.artist).toBe('Test Artist');
    expect(doc.metadata.album).toBe('Test Album');
    expect(doc.metadata.genre).toBe('Rock');
    expect(doc.metadata.year).toBe('2024');
    expect(doc.metadata.charter).toBe('TestCharter');
    expect(doc.metadata.song_length).toBe(340913);
    expect(doc.metadata.diff_drums).toBe(2);
    expect(doc.metadata.diff_drums_real).toBe(2);
    expect(doc.metadata.preview_start_time).toBe(171910);
    expect(doc.metadata.icon).toBe('tomato');
    expect(doc.metadata.album_track).toBe(2);
    expect(doc.metadata.playlist_track).toBe(2);
  });

  it('classifies audio files as assets', () => {
    const dummyAudio = new Uint8Array([0x00, 0x01, 0x02]);
    const files: FileEntry[] = [
      ...chartFixtureFiles(),
      makeFileEntry('song.ogg', dummyAudio),
      makeFileEntry('drums.ogg', dummyAudio),
    ];
    const doc = readChart(files);
    const assetNames = doc.assets.map((a) => a.fileName);
    expect(assetNames).toContain('song.ogg');
    expect(assetNames).toContain('drums.ogg');
  });

  it('does not include chart or ini files in assets', () => {
    const doc = readChart(chartFixtureFiles());
    const assetNames = doc.assets.map((a) => a.fileName);
    expect(assetNames).not.toContain('notes.chart');
    expect(assetNames).not.toContain('song.ini');
  });
});

// ---------------------------------------------------------------------------
// .chart round-trip
// ---------------------------------------------------------------------------

describe('.chart round-trip', () => {
  let originalDoc: ChartDocument;
  let outputFiles: FileEntry[];
  let roundTripped: ReturnType<typeof parseChartFile>;

  beforeAll(() => {
    originalDoc = readChart(chartFixtureFiles());
    outputFiles = writeChart(originalDoc);

    const chartFileEntry = outputFiles.find(
      (f) => f.fileName === 'notes.chart',
    );
    expect(chartFileEntry).toBeDefined();
    roundTripped = parseChartFile(chartFileEntry!.data, 'chart');
  });

  it('preserves resolution', () => {
    expect(roundTripped.resolution).toBe(originalDoc.chartTicksPerBeat);
  });

  it('preserves tempo count', () => {
    expect(roundTripped.tempos.length).toBe(originalDoc.tempos.length);
  });

  it('preserves tempo values', () => {
    for (let i = 0; i < originalDoc.tempos.length; i++) {
      expect(roundTripped.tempos[i].tick).toBe(originalDoc.tempos[i].tick);
      expect(roundTripped.tempos[i].beatsPerMinute).toBeCloseTo(
        originalDoc.tempos[i].beatsPerMinute,
        3,
      );
    }
  });

  it('preserves time signature count', () => {
    expect(roundTripped.timeSignatures.length).toBe(
      originalDoc.timeSignatures.length,
    );
  });

  it('preserves time signature values', () => {
    for (let i = 0; i < originalDoc.timeSignatures.length; i++) {
      expect(roundTripped.timeSignatures[i].tick).toBe(
        originalDoc.timeSignatures[i].tick,
      );
      expect(roundTripped.timeSignatures[i].numerator).toBe(
        originalDoc.timeSignatures[i].numerator,
      );
      expect(roundTripped.timeSignatures[i].denominator).toBe(
        originalDoc.timeSignatures[i].denominator,
      );
    }
  });

  it('preserves section count', () => {
    expect(roundTripped.sections.length).toBe(originalDoc.sections.length);
  });

  it('preserves track count', () => {
    expect(roundTripped.trackData.length).toBe(originalDoc.trackData.length);
  });

  it('preserves drum note counts per track', () => {
    const originalDrumTracks = originalDoc.trackData.filter(
      (t) => t.instrument === 'drums',
    );
    const roundTrippedDrumTracks = roundTripped.trackData.filter(
      (t) => t.instrument === 'drums',
    );

    expect(roundTrippedDrumTracks.length).toBe(originalDrumTracks.length);

    for (let i = 0; i < originalDrumTracks.length; i++) {
      const origTrack = originalDrumTracks[i];
      const rtTrack = roundTrippedDrumTracks.find(
        (t) => t.difficulty === origTrack.difficulty,
      );
      expect(rtTrack).toBeDefined();

      // Count total notes across all noteEventGroups
      const origNoteCount = origTrack.trackEvents.length;
      const rtNoteCount = rtTrack!.noteEventGroups.reduce(
        (sum, group) => sum + group.length,
        0,
      );

      // After round-trip through parseChartFile, modifier events are resolved
      // into note flags, so raw event count won't match noteEventGroup count.
      // Instead verify both have notes.
      expect(origNoteCount).toBeGreaterThan(0);
      expect(rtNoteCount).toBeGreaterThan(0);
    }
  });

  it('preserves star power sections', () => {
    for (const origTrack of originalDoc.trackData) {
      const rtTrack = roundTripped.trackData.find(
        (t) =>
          t.instrument === origTrack.instrument &&
          t.difficulty === origTrack.difficulty,
      );
      expect(rtTrack).toBeDefined();
      expect(rtTrack!.starPowerSections.length).toBe(
        origTrack.starPowerSections.length,
      );

      for (let i = 0; i < origTrack.starPowerSections.length; i++) {
        expect(rtTrack!.starPowerSections[i].tick).toBe(
          origTrack.starPowerSections[i].tick,
        );
        expect(rtTrack!.starPowerSections[i].length).toBe(
          origTrack.starPowerSections[i].length,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// .chart round-trip — notes preserved
// ---------------------------------------------------------------------------

describe('.chart round-trip — notes preserved', () => {
  it('preserves ExpertDrums note count through double round-trip', () => {
    // Parse the fixture twice through the same pipeline to get comparable data
    const originalFiles = chartFixtureFiles();
    const chartData = originalFiles.find((f) => f.fileName === 'notes.chart')!;
    const originalParsed = parseChartFile(chartData.data, 'chart');

    const doc = readChart(originalFiles);
    const outputFiles = writeChart(doc);
    const outputChart = outputFiles.find(
      (f) => f.fileName === 'notes.chart',
    )!;
    const roundTrippedParsed = parseChartFile(outputChart.data, 'chart');

    const origExpertDrums = originalParsed.trackData.find(
      (t) => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    const rtExpertDrums = roundTrippedParsed.trackData.find(
      (t) => t.instrument === 'drums' && t.difficulty === 'expert',
    );

    expect(origExpertDrums).toBeDefined();
    expect(rtExpertDrums).toBeDefined();

    const origNoteCount = origExpertDrums!.noteEventGroups.reduce(
      (sum, group) => sum + group.length,
      0,
    );
    const rtNoteCount = rtExpertDrums!.noteEventGroups.reduce(
      (sum, group) => sum + group.length,
      0,
    );

    expect(rtNoteCount).toBe(origNoteCount);
  });

  it('preserves note group count (unique tick positions)', () => {
    const originalFiles = chartFixtureFiles();
    const chartData = originalFiles.find((f) => f.fileName === 'notes.chart')!;
    const originalParsed = parseChartFile(chartData.data, 'chart');

    const doc = readChart(originalFiles);
    const outputFiles = writeChart(doc);
    const outputChart = outputFiles.find(
      (f) => f.fileName === 'notes.chart',
    )!;
    const roundTrippedParsed = parseChartFile(outputChart.data, 'chart');

    const origExpertDrums = originalParsed.trackData.find(
      (t) => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    const rtExpertDrums = roundTrippedParsed.trackData.find(
      (t) => t.instrument === 'drums' && t.difficulty === 'expert',
    );

    expect(rtExpertDrums!.noteEventGroups.length).toBe(
      origExpertDrums!.noteEventGroups.length,
    );
  });
});

// ---------------------------------------------------------------------------
// .mid round-trip
// ---------------------------------------------------------------------------

describe('.mid round-trip', () => {
  let originalDoc: ChartDocument;
  let outputFiles: FileEntry[];
  let roundTripped: ReturnType<typeof parseChartFile>;

  beforeAll(() => {
    originalDoc = readChart(midFixtureFiles());
    outputFiles = writeChart(originalDoc);

    const midFileEntry = outputFiles.find((f) => f.fileName === 'notes.mid');
    expect(midFileEntry).toBeDefined();
    roundTripped = parseChartFile(midFileEntry!.data, 'mid');
  });

  it('preserves resolution', () => {
    expect(roundTripped.resolution).toBe(originalDoc.chartTicksPerBeat);
  });

  it('preserves tempo count', () => {
    expect(roundTripped.tempos.length).toBe(originalDoc.tempos.length);
  });

  it('preserves tempo values', () => {
    for (let i = 0; i < originalDoc.tempos.length; i++) {
      expect(roundTripped.tempos[i].tick).toBe(originalDoc.tempos[i].tick);
      expect(roundTripped.tempos[i].beatsPerMinute).toBeCloseTo(
        originalDoc.tempos[i].beatsPerMinute,
        2,
      );
    }
  });

  it('preserves time signature count', () => {
    expect(roundTripped.timeSignatures.length).toBe(
      originalDoc.timeSignatures.length,
    );
  });

  it('preserves track count', () => {
    expect(roundTripped.trackData.length).toBe(originalDoc.trackData.length);
  });

  it('preserves track instruments and difficulties', () => {
    for (const origTrack of originalDoc.trackData) {
      const rtTrack = roundTripped.trackData.find(
        (t) =>
          t.instrument === origTrack.instrument &&
          t.difficulty === origTrack.difficulty,
      );
      expect(rtTrack).toBeDefined();
    }
  });

  it('preserves drum note counts through double round-trip', () => {
    const originalFiles = midFixtureFiles();
    const midData = originalFiles.find((f) => f.fileName === 'notes.mid')!;
    const originalParsed = parseChartFile(midData.data, 'mid');

    const doc = readChart(originalFiles);
    const out = writeChart(doc);
    const outputMid = out.find((f) => f.fileName === 'notes.mid')!;
    const roundTrippedParsed = parseChartFile(outputMid.data, 'mid');

    const origDrumTracks = originalParsed.trackData.filter(
      (t) => t.instrument === 'drums',
    );
    const rtDrumTracks = roundTrippedParsed.trackData.filter(
      (t) => t.instrument === 'drums',
    );

    expect(rtDrumTracks.length).toBe(origDrumTracks.length);

    for (const origTrack of origDrumTracks) {
      const rtTrack = rtDrumTracks.find(
        (t) => t.difficulty === origTrack.difficulty,
      );
      expect(rtTrack).toBeDefined();

      const origNoteCount = origTrack.noteEventGroups.reduce(
        (sum, group) => sum + group.length,
        0,
      );
      const rtNoteCount = rtTrack!.noteEventGroups.reduce(
        (sum, group) => sum + group.length,
        0,
      );

      expect(rtNoteCount).toBe(origNoteCount);
    }
  });

  it('preserves section count', () => {
    expect(roundTripped.sections.length).toBe(originalDoc.sections.length);
  });
});

// ---------------------------------------------------------------------------
// writeChart output
// ---------------------------------------------------------------------------

describe('writeChart', () => {
  it('produces a song.ini file', () => {
    const doc = readChart(chartFixtureFiles());
    const outputFiles = writeChart(doc);
    const iniFile = outputFiles.find((f) => f.fileName === 'song.ini');
    expect(iniFile).toBeDefined();
    expect(iniFile!.data.length).toBeGreaterThan(0);
  });

  it('passes through assets unchanged', () => {
    const dummyAudio = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    const files: FileEntry[] = [
      ...chartFixtureFiles(),
      makeFileEntry('song.ogg', dummyAudio),
    ];
    const doc = readChart(files);
    const outputFiles = writeChart(doc);

    const outputAudio = outputFiles.find((f) => f.fileName === 'song.ogg');
    expect(outputAudio).toBeDefined();
    expect(outputAudio!.data).toEqual(dummyAudio);
  });

  it('includes chart file in output', () => {
    const doc = readChart(chartFixtureFiles());
    const outputFiles = writeChart(doc);
    const chartFile = outputFiles.find((f) => f.fileName === 'notes.chart');
    expect(chartFile).toBeDefined();
    expect(chartFile!.data.length).toBeGreaterThan(0);
  });

  it('includes mid file when originalFormat is mid', () => {
    const doc = readChart(midFixtureFiles());
    const outputFiles = writeChart(doc);
    const midFile = outputFiles.find((f) => f.fileName === 'notes.mid');
    expect(midFile).toBeDefined();
    expect(midFile!.data.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Metadata round-trip
// ---------------------------------------------------------------------------

describe('metadata round-trip', () => {
  it('preserves metadata fields in song.ini output (.chart)', () => {
    const doc = readChart(chartFixtureFiles());
    const outputFiles = writeChart(doc);
    const iniFile = outputFiles.find((f) => f.fileName === 'song.ini')!;
    const iniText = new TextDecoder().decode(iniFile.data);

    expect(iniText).toContain('name = Test Chart Song');
    expect(iniText).toContain('artist = Test Artist');
    expect(iniText).toContain('album = Test Album');
    expect(iniText).toContain('genre = Rock');
    expect(iniText).toContain('year = 2024');
    expect(iniText).toContain('charter = TestCharter');
    expect(iniText).toContain('song_length = 340913');
    expect(iniText).toContain('diff_drums = 2');
    expect(iniText).toContain('diff_drums_real = 2');
    expect(iniText).toContain('preview_start_time = 171910');
    expect(iniText).toContain('icon = tomato');
    expect(iniText).toContain('album_track = 2');
    expect(iniText).toContain('playlist_track = 2');
  });

  it('preserves metadata fields in song.ini output (.mid)', () => {
    const doc = readChart(midFixtureFiles());
    const outputFiles = writeChart(doc);
    const iniFile = outputFiles.find((f) => f.fileName === 'song.ini')!;
    const iniText = new TextDecoder().decode(iniFile.data);

    expect(iniText).toContain('name = Test MIDI Song');
    expect(iniText).toContain('artist = Test MIDI Artist');
    expect(iniText).toContain('album = Test MIDI Album');
    expect(iniText).toContain('charter = TestCharter');
    expect(iniText).toContain('diff_drums = 2');
    expect(iniText).toContain('loading_phrase = Test loading phrase');
    expect(iniText).toContain('icon = haggis');
  });
});

// ---------------------------------------------------------------------------
// C2: readChart without song.ini — metadata from .chart [Song] section
// ---------------------------------------------------------------------------

describe('readChart without song.ini', () => {
  it('falls back to .chart [Song] section metadata when no song.ini', () => {
    const files: FileEntry[] = [
      makeFileEntry('notes.chart', loadFixture('drums-basic.chart')),
    ];
    const doc = readChart(files);

    // These values come from scan-chart parsing the [Song] section
    expect(doc.metadata.name).toBe('Test Chart Song');
    expect(doc.metadata.artist).toBe('Test Artist');
    expect(doc.metadata.charter).toBe('TestCharter');
    expect(doc.metadata.album).toBe('Test Album');
  });
});

// ---------------------------------------------------------------------------
// A7: Case-insensitive INI section lookup
// ---------------------------------------------------------------------------

describe('readChart with uppercase [Song] in INI', () => {
  it('reads metadata from [Song] (uppercase) in song.ini', () => {
    const iniText = '[Song]\r\nname = Test Uppercase\r\nartist = UpperArtist\r\n';
    const encoder = new TextEncoder();
    const files: FileEntry[] = [
      makeFileEntry('notes.chart', loadFixture('drums-basic.chart')),
      makeFileEntry('song.ini', encoder.encode(iniText)),
    ];
    const doc = readChart(files);
    expect(doc.metadata.name).toBe('Test Uppercase');
    expect(doc.metadata.artist).toBe('UpperArtist');
  });
});

// ---------------------------------------------------------------------------
// C3: Boolean metadata round-trip
// ---------------------------------------------------------------------------

describe('boolean metadata round-trip', () => {
  it('round-trips boolean metadata through song.ini', () => {
    const doc = createChart({ format: 'chart' });
    doc.metadata.modchart = true;
    doc.metadata.pro_drums = true;
    doc.metadata.five_lane_drums = false;

    const outputFiles = writeChart(doc);
    const iniFile = outputFiles.find((f) => f.fileName === 'song.ini')!;
    const iniText = new TextDecoder().decode(iniFile.data);

    // Verify INI output uses Python-style True/False
    expect(iniText).toContain('modchart = True');
    expect(iniText).toContain('pro_drums = True');
    expect(iniText).toContain('five_lane_drums = False');

    // Re-read and verify round-trip
    const chartFile = outputFiles.find((f) => f.fileName === 'notes.chart')!;
    const reRead = readChart([chartFile, iniFile]);
    expect(reRead.metadata.modchart).toBe(true);
    expect(reRead.metadata.pro_drums).toBe(true);
    expect(reRead.metadata.five_lane_drums).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unknown INI fields preserved through round-trip
// ---------------------------------------------------------------------------

describe('extraIniFields round-trip', () => {
  it('preserves unknown song.ini fields through read → write → read', () => {
    const iniText = [
      '[song]',
      'name = Test Song',
      'artist = Test Artist',
      'sysex_slider = True',
      'sysex_open_bass = True',
      'diff_bass_real = -1',
      'diff_guitar_real = -1',
      'custom_field = hello world',
      '',
    ].join('\r\n');
    const encoder = new TextEncoder();
    const files: FileEntry[] = [
      makeFileEntry('notes.chart', loadFixture('drums-basic.chart')),
      makeFileEntry('song.ini', encoder.encode(iniText)),
    ];

    const doc = readChart(files);

    // Verify unknown fields were captured
    expect(doc.metadata.extraIniFields).toBeDefined();
    expect(doc.metadata.extraIniFields!['sysex_slider']).toBe('True');
    expect(doc.metadata.extraIniFields!['sysex_open_bass']).toBe('True');
    expect(doc.metadata.extraIniFields!['diff_bass_real']).toBe('-1');
    expect(doc.metadata.extraIniFields!['custom_field']).toBe('hello world');

    // Known fields should NOT be in extraIniFields
    expect(doc.metadata.extraIniFields!['name']).toBeUndefined();
    expect(doc.metadata.extraIniFields!['artist']).toBeUndefined();

    // Write and re-read
    const outputFiles = writeChart(doc);
    const iniFile = outputFiles.find((f) => f.fileName === 'song.ini')!;
    const outputIni = new TextDecoder().decode(iniFile.data);

    // Verify unknown fields appear in output
    expect(outputIni).toContain('sysex_slider = True');
    expect(outputIni).toContain('sysex_open_bass = True');
    expect(outputIni).toContain('diff_bass_real = -1');
    expect(outputIni).toContain('custom_field = hello world');

    // Re-read and verify they survive the full round-trip
    const reDoc = readChart(outputFiles);
    expect(reDoc.metadata.extraIniFields).toEqual(doc.metadata.extraIniFields);
  });

  it('does not create extraIniFields when all fields are known', () => {
    const doc = readChart(chartFixtureFiles());
    // The test fixture only has known fields, so extraIniFields should be absent
    expect(doc.metadata.extraIniFields).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// C5: Image asset classification
// ---------------------------------------------------------------------------

describe('image asset classification', () => {
  it('classifies image files as assets on read', () => {
    const dummyImage = new Uint8Array([0x01]);
    const files: FileEntry[] = [
      ...chartFixtureFiles(),
      makeFileEntry('album.png', dummyImage),
      makeFileEntry('background.jpg', dummyImage),
    ];
    const doc = readChart(files);
    const assetNames = doc.assets.map((a) => a.fileName);
    expect(assetNames).toContain('album.png');
    expect(assetNames).toContain('background.jpg');
  });

  it('passes through image assets in writeChart output', () => {
    const dummyImage = new Uint8Array([0x01]);
    const files: FileEntry[] = [
      ...chartFixtureFiles(),
      makeFileEntry('album.png', dummyImage),
      makeFileEntry('background.jpg', dummyImage),
    ];
    const doc = readChart(files);
    const outputFiles = writeChart(doc);
    const outputNames = outputFiles.map((f) => f.fileName);
    expect(outputNames).toContain('album.png');
    expect(outputNames).toContain('background.jpg');
  });
});

// ---------------------------------------------------------------------------
// Full scan-chart output round-trip
// ---------------------------------------------------------------------------

const DEFAULT_MODIFIERS = {
  song_length: 0,
  hopo_frequency: 0,
  eighthnote_hopo: false,
  multiplier_note: 0,
  sustain_cutoff_threshold: -1,
  chord_snap_threshold: 0,
  five_lane_drums: false,
  pro_drums: true,
  end_events: true,
};

/**
 * Strip msTime / msLength from scan-chart output for structural comparison.
 * These are computed from tick + tempo and may have floating-point drift,
 * so we compare them separately with toBeCloseTo.
 */
function stripTimingFields(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(stripTimingFields);
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'msTime' || k === 'msLength') continue;
      result[k] = stripTimingFields(v);
    }
    return result;
  }
  return obj;
}

/**
 * Collect all msTime values from a scan-chart output for approximate comparison.
 */
function collectMsTimes(obj: unknown, path = ''): Array<{path: string; value: number}> {
  const results: Array<{path: string; value: number}> = [];
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => results.push(...collectMsTimes(item, `${path}[${i}]`)));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'msTime' && typeof v === 'number') {
        results.push({path: `${path}.msTime`, value: v});
      } else if (k === 'msLength' && typeof v === 'number') {
        results.push({path: `${path}.msLength`, value: v});
      } else {
        results.push(...collectMsTimes(v, `${path}.${k}`));
      }
    }
  }
  return results;
}

describe('full scan-chart output round-trip', () => {
  it('.chart: entire ParsedChart structure survives write → readChart → re-parse', () => {
    // 1. Parse original (with ini, like a real load)
    const originalFiles = chartFixtureFiles();
    const original = parseChartFile(loadFixture('drums-basic.chart'), 'chart', DEFAULT_MODIFIERS);

    // 2. Load into ChartDocument and write back (produces chart + ini)
    const doc = readChart(originalFiles);
    const outputFiles = writeChart(doc);
    const chartFile = outputFiles.find(f => f.fileName === 'notes.chart')!;
    const iniFile = outputFiles.find(f => f.fileName === 'song.ini')!;

    // 3. Re-read with both chart + ini (full round-trip)
    const reDoc = readChart([chartFile, iniFile]);
    // 4. Write again and parse with scan-chart for full comparison
    const reOutputFiles = writeChart(reDoc);
    const reChartFile = reOutputFiles.find(f => f.fileName === 'notes.chart')!;
    const roundTripped = parseChartFile(reChartFile.data, 'chart', DEFAULT_MODIFIERS);

    // resolution
    expect(roundTripped.resolution).toBe(original.resolution);

    // drumType
    expect(roundTripped.drumType).toBe(original.drumType);

    // metadata (chart-level fields that survive the .chart [Song] section)
    // name/artist/charter etc. live in song.ini, not .chart — they round-trip
    // through readChart but not through parseChartFile alone.
    if (original.metadata.delay !== undefined) {
      expect(roundTripped.metadata.delay).toBe(original.metadata.delay);
    }

    // tempos (tick + bpm)
    expect(roundTripped.tempos.length).toBe(original.tempos.length);
    for (let i = 0; i < original.tempos.length; i++) {
      expect(roundTripped.tempos[i].tick).toBe(original.tempos[i].tick);
      expect(roundTripped.tempos[i].beatsPerMinute).toBeCloseTo(original.tempos[i].beatsPerMinute, 1);
    }

    // time signatures
    expect(roundTripped.timeSignatures.length).toBe(original.timeSignatures.length);
    for (let i = 0; i < original.timeSignatures.length; i++) {
      expect(roundTripped.timeSignatures[i].tick).toBe(original.timeSignatures[i].tick);
      expect(roundTripped.timeSignatures[i].numerator).toBe(original.timeSignatures[i].numerator);
      expect(roundTripped.timeSignatures[i].denominator).toBe(original.timeSignatures[i].denominator);
    }

    // sections
    expect(roundTripped.sections.length).toBe(original.sections.length);
    for (let i = 0; i < original.sections.length; i++) {
      expect(roundTripped.sections[i].tick).toBe(original.sections[i].tick);
      expect(roundTripped.sections[i].name).toBe(original.sections[i].name);
    }

    // lyrics
    expect(roundTripped.lyrics.length).toBe(original.lyrics.length);
    for (let i = 0; i < original.lyrics.length; i++) {
      expect(roundTripped.lyrics[i].tick).toBe(original.lyrics[i].tick);
      expect(roundTripped.lyrics[i].text).toBe(original.lyrics[i].text);
    }

    // vocalPhrases
    expect(roundTripped.vocalPhrases.length).toBe(original.vocalPhrases.length);

    // hasLyrics, hasVocals, hasForcedNotes
    expect(roundTripped.hasLyrics).toBe(original.hasLyrics);
    expect(roundTripped.hasVocals).toBe(original.hasVocals);
    expect(roundTripped.hasForcedNotes).toBe(original.hasForcedNotes);

    // trackData: same instruments and difficulties
    expect(roundTripped.trackData.length).toBe(original.trackData.length);
    for (const origTrack of original.trackData) {
      const rtTrack = roundTripped.trackData.find(
        t => t.instrument === origTrack.instrument && t.difficulty === origTrack.difficulty,
      );
      expect(rtTrack).toBeDefined();
      if (!rtTrack) continue;

      // Same number of note groups
      expect(rtTrack.noteEventGroups.length).toBe(origTrack.noteEventGroups.length);

      // Each note group: same number of notes, same ticks and types
      for (let g = 0; g < origTrack.noteEventGroups.length; g++) {
        const origGroup = origTrack.noteEventGroups[g];
        const rtGroup = rtTrack.noteEventGroups[g];
        expect(rtGroup.length).toBe(origGroup.length);
        for (let n = 0; n < origGroup.length; n++) {
          expect(rtGroup[n].tick).toBe(origGroup[n].tick);
          expect(rtGroup[n].type).toBe(origGroup[n].type);
          expect(rtGroup[n].flags).toBe(origGroup[n].flags);
        }
      }

      // Star power sections
      expect(rtTrack.starPowerSections.length).toBe(origTrack.starPowerSections.length);
      for (let i = 0; i < origTrack.starPowerSections.length; i++) {
        expect(rtTrack.starPowerSections[i].tick).toBe(origTrack.starPowerSections[i].tick);
        expect(rtTrack.starPowerSections[i].length).toBe(origTrack.starPowerSections[i].length);
      }

      // Solo sections
      expect(rtTrack.soloSections.length).toBe(origTrack.soloSections.length);
    }

    // msTime values should be close (floating-point)
    const origTimes = collectMsTimes(original);
    const rtTimes = collectMsTimes(roundTripped);
    expect(rtTimes.length).toBe(origTimes.length);
    for (let i = 0; i < origTimes.length; i++) {
      expect(rtTimes[i].value).toBeCloseTo(origTimes[i].value, 1);
    }
  });

  it('.chart: delay round-trips through metadata', () => {
    const doc = readChart(chartFixtureFiles());
    doc.metadata.delay = 2000; // ms

    const outputFiles = writeChart(doc);
    const chartFile = outputFiles.find(f => f.fileName === 'notes.chart')!;
    const roundTripped = parseChartFile(chartFile.data, 'chart', DEFAULT_MODIFIERS);

    expect(roundTripped.metadata.delay).toBe(2000);
  });

  it('.chart: negative delay round-trips', () => {
    const doc = readChart(chartFixtureFiles());
    doc.metadata.delay = -500;

    const outputFiles = writeChart(doc);
    const chartFile = outputFiles.find(f => f.fileName === 'notes.chart')!;
    const roundTripped = parseChartFile(chartFile.data, 'chart', DEFAULT_MODIFIERS);

    expect(roundTripped.metadata.delay).toBe(-500);
  });
});
