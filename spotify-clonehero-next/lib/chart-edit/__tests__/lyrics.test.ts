/**
 * Tests for lyrics and vocal phrase round-tripping through both formats.
 *
 * Validates that lyrics (syllable text + tick) and vocalPhrases
 * (phrase_start/phrase_end boundaries) survive:
 *   .chart → parse → write .chart → re-parse
 *   .chart → parse → write .mid  → re-parse
 *   .mid   → parse → write .chart → re-parse
 *   .mid   → parse → write .mid  → re-parse
 */

import { createChart, writeChart, readChart } from '../index';
import type { ChartDocument, FileEntry } from '../types';
import { serializeChart } from '../writer-chart';
import { serializeMidi } from '../writer-mid';
import { parseChartFile } from '@eliwhite/scan-chart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDocWithLyrics(format: 'chart' | 'mid' = 'chart'): ChartDocument {
  const doc = createChart({ format, resolution: 480 });

  doc.lyrics = [
    { tick: 0, length: 0, text: 'Hel' },
    { tick: 240, length: 0, text: 'lo' },
    { tick: 480, length: 0, text: 'world' },
    { tick: 960, length: 0, text: '!' },
  ];

  doc.vocalPhrases = [
    { tick: 0, length: 480 },   // "Hel-lo" phrase
    { tick: 480, length: 960 }, // "world !" phrase
  ];

  doc.hasLyrics = true;

  // Need at least one drum track so chart isn't empty
  doc.trackData.push({
    instrument: 'drums',
    difficulty: 'expert',
    starPowerSections: [],
    rejectedStarPowerSections: [],
    soloSections: [],
    flexLanes: [],
    drumFreestyleSections: [],
    trackEvents: [{ tick: 0, length: 1, type: 17 /* kick */ }],
  });

  return doc;
}

// ---------------------------------------------------------------------------
// .chart writer: lyrics and phrases
// ---------------------------------------------------------------------------

describe('.chart lyrics', () => {
  it('writes lyric events to [Events] section', () => {
    const doc = makeDocWithLyrics('chart');
    const text = serializeChart(doc);
    const lines = text.split('\r\n');

    const lyricLines = lines.filter((l) => l.includes('lyric'));
    expect(lyricLines).toHaveLength(4);
    expect(lyricLines[0]).toContain('0 = E "lyric Hel"');
    expect(lyricLines[1]).toContain('240 = E "lyric lo"');
    expect(lyricLines[2]).toContain('480 = E "lyric world"');
    expect(lyricLines[3]).toContain('960 = E "lyric !"');
  });

  it('writes phrase_start and phrase_end events', () => {
    const doc = makeDocWithLyrics('chart');
    const text = serializeChart(doc);
    const lines = text.split('\r\n');

    const phraseStarts = lines.filter((l) => l.includes('phrase_start'));
    const phraseEnds = lines.filter((l) => l.includes('phrase_end'));

    expect(phraseStarts).toHaveLength(2);
    expect(phraseEnds).toHaveLength(2);

    expect(phraseStarts[0]).toContain('0 = E "phrase_start"');
    expect(phraseStarts[1]).toContain('480 = E "phrase_start"');
    expect(phraseEnds[0]).toContain('480 = E "phrase_end"');
    expect(phraseEnds[1]).toContain('1440 = E "phrase_end"');
  });

  it('round-trips lyrics through .chart write → parse', () => {
    const doc = makeDocWithLyrics('chart');
    const output = writeChart(doc);
    const chartFile = output.find((f) => f.fileName === 'notes.chart')!;
    const parsed = parseChartFile(chartFile.data, 'chart');

    expect(parsed.lyrics).toHaveLength(4);
    expect(parsed.lyrics[0]).toEqual(
      expect.objectContaining({ tick: 0, text: 'Hel' }),
    );
    expect(parsed.lyrics[1]).toEqual(
      expect.objectContaining({ tick: 240, text: 'lo' }),
    );
    expect(parsed.lyrics[2]).toEqual(
      expect.objectContaining({ tick: 480, text: 'world' }),
    );
    expect(parsed.lyrics[3]).toEqual(
      expect.objectContaining({ tick: 960, text: '!' }),
    );
  });

  it('round-trips vocalPhrases through .chart write → parse', () => {
    const doc = makeDocWithLyrics('chart');
    const output = writeChart(doc);
    const chartFile = output.find((f) => f.fileName === 'notes.chart')!;
    const parsed = parseChartFile(chartFile.data, 'chart');

    expect(parsed.vocalPhrases).toHaveLength(2);
    expect(parsed.vocalPhrases[0]).toEqual(
      expect.objectContaining({ tick: 0, length: 480 }),
    );
    expect(parsed.vocalPhrases[1]).toEqual(
      expect.objectContaining({ tick: 480, length: 960 }),
    );
  });

  it('writes no phrase events when vocalPhrases is empty', () => {
    const doc = makeDocWithLyrics('chart');
    doc.vocalPhrases = [];
    const text = serializeChart(doc);

    expect(text).not.toContain('phrase_start');
    expect(text).not.toContain('phrase_end');
    // Lyrics should still be present
    expect(text).toContain('lyric Hel');
  });
});

// ---------------------------------------------------------------------------
// MIDI writer: lyrics and phrases
// ---------------------------------------------------------------------------

describe('MIDI lyrics', () => {
  it('creates PART VOCALS track when lyrics exist', () => {
    const doc = makeDocWithLyrics('mid');
    const bytes = serializeMidi(doc);
    const { parseMidi } = require('midi-file');
    const midi = parseMidi(bytes);

    // Track 0: tempo, Track 1: EVENTS, Track 2: PART VOCALS, Track 3: PART DRUMS
    const vocalsTrack = midi.tracks[2];
    const trackName = vocalsTrack.find(
      (e: any) => e.type === 'trackName',
    );
    expect(trackName.text).toBe('PART VOCALS');
  });

  it('writes lyrics as MIDI lyric meta events on PART VOCALS', () => {
    const doc = makeDocWithLyrics('mid');
    const bytes = serializeMidi(doc);
    const { parseMidi } = require('midi-file');
    const midi = parseMidi(bytes);

    const vocalsTrack = midi.tracks[2];
    const lyricEvents = vocalsTrack.filter(
      (e: any) => e.type === 'lyrics',
    );
    expect(lyricEvents).toHaveLength(4);

    // Lyrics should have the correct text (via delta times)
    const texts = lyricEvents.map((e: any) => e.text);
    expect(texts).toEqual(['Hel', 'lo', 'world', '!']);
  });

  it('writes phrase markers as note 105 on PART VOCALS', () => {
    const doc = makeDocWithLyrics('mid');
    const bytes = serializeMidi(doc);
    const { parseMidi } = require('midi-file');
    const midi = parseMidi(bytes);

    const vocalsTrack = midi.tracks[2];
    const noteOns = vocalsTrack.filter(
      (e: any) => e.type === 'noteOn' && e.noteNumber === 105,
    );
    const noteOffs = vocalsTrack.filter(
      (e: any) => e.type === 'noteOff' && e.noteNumber === 105,
    );

    expect(noteOns).toHaveLength(2);
    expect(noteOffs).toHaveLength(2);
  });

  it('does not create PART VOCALS track when no lyrics or phrases', () => {
    const doc = makeDocWithLyrics('mid');
    doc.lyrics = [];
    doc.vocalPhrases = [];
    const bytes = serializeMidi(doc);
    const { parseMidi } = require('midi-file');
    const midi = parseMidi(bytes);

    // Should only have tempo + EVENTS + PART DRUMS = 3 tracks
    expect(midi.tracks).toHaveLength(3);
  });

  it('round-trips lyrics through MIDI write → parse', () => {
    const doc = makeDocWithLyrics('mid');
    const output = writeChart(doc);
    const midFile = output.find((f) => f.fileName === 'notes.mid')!;
    const parsed = parseChartFile(midFile.data, 'mid');

    expect(parsed.lyrics).toHaveLength(4);
    expect(parsed.lyrics.map((l: any) => l.text)).toEqual([
      'Hel',
      'lo',
      'world',
      '!',
    ]);
  });

  it('round-trips vocalPhrases through MIDI write → parse', () => {
    const doc = makeDocWithLyrics('mid');
    const output = writeChart(doc);
    const midFile = output.find((f) => f.fileName === 'notes.mid')!;
    const parsed = parseChartFile(midFile.data, 'mid');

    expect(parsed.vocalPhrases).toHaveLength(2);
    expect(parsed.vocalPhrases[0]).toEqual(
      expect.objectContaining({ tick: 0 }),
    );
    expect(parsed.vocalPhrases[1]).toEqual(
      expect.objectContaining({ tick: 480 }),
    );
  });
});

// ---------------------------------------------------------------------------
// Cross-format lyrics round-trip
// ---------------------------------------------------------------------------

describe('cross-format lyrics', () => {
  it('.chart → MIDI → parse preserves lyrics', () => {
    const doc = makeDocWithLyrics('chart');
    // Flip to MIDI format
    doc.originalFormat = 'mid';
    const output = writeChart(doc);
    const midFile = output.find((f) => f.fileName === 'notes.mid')!;
    const parsed = parseChartFile(midFile.data, 'mid');

    expect(parsed.lyrics).toHaveLength(4);
    expect(parsed.lyrics.map((l: any) => l.text)).toEqual([
      'Hel', 'lo', 'world', '!',
    ]);
  });

  it('.chart → MIDI → parse preserves vocalPhrases', () => {
    const doc = makeDocWithLyrics('chart');
    doc.originalFormat = 'mid';
    const output = writeChart(doc);
    const midFile = output.find((f) => f.fileName === 'notes.mid')!;
    const parsed = parseChartFile(midFile.data, 'mid');

    expect(parsed.vocalPhrases).toHaveLength(2);
  });

  it('MIDI → .chart → parse preserves lyrics', () => {
    const doc = makeDocWithLyrics('mid');
    // Flip to .chart format
    doc.originalFormat = 'chart';
    const output = writeChart(doc);
    const chartFile = output.find((f) => f.fileName === 'notes.chart')!;
    const parsed = parseChartFile(chartFile.data, 'chart');

    expect(parsed.lyrics).toHaveLength(4);
    expect(parsed.lyrics.map((l: any) => l.text)).toEqual([
      'Hel', 'lo', 'world', '!',
    ]);
  });

  it('MIDI → .chart → parse preserves vocalPhrases', () => {
    const doc = makeDocWithLyrics('mid');
    doc.originalFormat = 'chart';
    const output = writeChart(doc);
    const chartFile = output.find((f) => f.fileName === 'notes.chart')!;
    const parsed = parseChartFile(chartFile.data, 'chart');

    expect(parsed.vocalPhrases).toHaveLength(2);
    expect(parsed.vocalPhrases[0]).toEqual(
      expect.objectContaining({ tick: 0, length: 480 }),
    );
    expect(parsed.vocalPhrases[1]).toEqual(
      expect.objectContaining({ tick: 480, length: 960 }),
    );
  });

  it('full round-trip: .chart → readChart → write .mid → readChart → write .chart → parse', () => {
    // Start with a .chart doc
    const doc1 = makeDocWithLyrics('chart');
    const files1 = writeChart(doc1);

    // Read as chart, write as MIDI
    const doc2 = readChart(files1);
    doc2.originalFormat = 'mid';
    const files2 = writeChart(doc2);

    // Read as MIDI, write back as chart
    const doc3 = readChart(files2);
    doc3.originalFormat = 'chart';
    const files3 = writeChart(doc3);

    // Parse the final .chart
    const chartFile = files3.find((f) => f.fileName === 'notes.chart')!;
    const parsed = parseChartFile(chartFile.data, 'chart');

    expect(parsed.lyrics).toHaveLength(4);
    expect(parsed.lyrics.map((l: any) => l.text)).toEqual([
      'Hel', 'lo', 'world', '!',
    ]);
    expect(parsed.vocalPhrases).toHaveLength(2);
  });
});
