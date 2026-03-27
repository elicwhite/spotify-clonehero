/**
 * Tests for the .chart serializer (writer-chart.ts).
 *
 * Focuses on format correctness: section headers, field encoding,
 * note emission, and round-trip parsing via scan-chart.
 */

import {
  createChart,
  writeChart,
  addDrumNote,
  addStarPower,
  addActivationLane,
  addSoloSection,
  addSection,
  eventTypes,
} from '../index';
import type { ChartDocument, TrackData } from '../types';
import { serializeChart } from '../writer-chart';
import { parseChartFile } from '@eliwhite/scan-chart';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeDocWithDrumTrack(): ChartDocument {
  const doc = createChart({ format: 'chart', resolution: 192 });
  doc.trackData.push({
    instrument: 'drums',
    difficulty: 'expert',
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

// ---------------------------------------------------------------------------
// [Song] section
// ---------------------------------------------------------------------------

describe('serializeChart', () => {
  it('empty chart has [Song] section', () => {
    const doc = createChart({ format: 'chart' });
    const text = serializeChart(doc);
    expect(text).toContain('[Song]');
  });

  it('writes Resolution in [Song]', () => {
    const doc = createChart({ format: 'chart', resolution: 192 });
    const text = serializeChart(doc);
    expect(text).toContain('Resolution = 192');
  });

  it('omits Offset when delay is not set', () => {
    const doc = createChart({ format: 'chart' });
    const text = serializeChart(doc);
    expect(text).not.toContain('Offset');
  });

  it('writes Offset when delay is non-zero', () => {
    const doc = createChart({ format: 'chart' });
    doc.metadata.delay = 500;
    const text = serializeChart(doc);
    expect(text).toContain('Offset = 500');
  });

  it('writes audio stream references from assets', () => {
    const doc = createChart({ format: 'chart' });
    doc.assets.push({
      fileName: 'song.ogg',
      data: new Uint8Array(0),
    });
    const text = serializeChart(doc);
    expect(text).toContain('MusicStream = "song.ogg"');
  });

  // ---------------------------------------------------------------------------
  // [SyncTrack] section
  // ---------------------------------------------------------------------------

  it('writes default 120 BPM as millibeats', () => {
    const doc = createChart({ format: 'chart', bpm: 120 });
    const text = serializeChart(doc);
    expect(text).toContain('0 = B 120000');
  });

  it('writes fractional BPM as millibeats', () => {
    const doc = createChart({ format: 'chart', bpm: 120.5 });
    const text = serializeChart(doc);
    expect(text).toContain('120500');
  });

  it('writes default 4/4 time signature', () => {
    const doc = createChart({ format: 'chart' });
    const text = serializeChart(doc);
    expect(text).toContain('0 = TS 4');
  });

  it('writes time signature with non-4 denominator', () => {
    const doc = createChart({
      format: 'chart',
      timeSignature: { numerator: 3, denominator: 8 },
    });
    const text = serializeChart(doc);
    // 8 = 2^3, so denominator exponent is 3
    expect(text).toContain('0 = TS 3 3');
  });

  // ---------------------------------------------------------------------------
  // [Events] section
  // ---------------------------------------------------------------------------

  it('writes section markers', () => {
    const doc = createChart({ format: 'chart' });
    addSection(doc, 0, 'Verse');
    const text = serializeChart(doc);
    expect(text).toContain('E "section Verse"');
  });

  it('writes end events', () => {
    const doc = createChart({ format: 'chart' });
    doc.endEvents.push({ tick: 1920 });
    const text = serializeChart(doc);
    expect(text).toContain('E "end"');
  });

  it('writes lyrics in [Events] section', () => {
    const doc = createChart({ format: 'chart' });
    doc.lyrics.push({ tick: 0, length: 0, text: 'Hello' });
    doc.lyrics.push({ tick: 480, length: 0, text: 'World' });
    const text = serializeChart(doc);
    expect(text).toContain('0 = E "lyric Hello"');
    expect(text).toContain('480 = E "lyric World"');
  });

  // ---------------------------------------------------------------------------
  // Track sections
  // ---------------------------------------------------------------------------

  it('writes ExpertDrums section name', () => {
    const doc = makeDocWithDrumTrack();
    const text = serializeChart(doc);
    expect(text).toContain('[ExpertDrums]');
  });

  it('emits drum kick note as N 0', () => {
    const doc = makeDocWithDrumTrack();
    addDrumNote(getTrack(doc), { tick: 0, type: 'kick' });
    const text = serializeChart(doc);
    expect(text).toContain('0 = N 0 0');
  });

  it('emits cymbal marker as N 66', () => {
    const doc = makeDocWithDrumTrack();
    addDrumNote(getTrack(doc), {
      tick: 0,
      type: 'yellowDrum',
      flags: { cymbal: true },
    });
    const text = serializeChart(doc);
    // Base yellowDrum = N 2, cymbal marker = N 66
    expect(text).toContain('0 = N 2 0');
    expect(text).toContain('0 = N 66 0');
  });

  it('emits double kick as N 32', () => {
    const doc = makeDocWithDrumTrack();
    addDrumNote(getTrack(doc), {
      tick: 0,
      type: 'kick',
      flags: { doubleKick: true },
    });
    const text = serializeChart(doc);
    expect(text).toContain('0 = N 0 0');
    expect(text).toContain('0 = N 32 0');
  });

  it('emits star power as S 2', () => {
    const doc = makeDocWithDrumTrack();
    addStarPower(getTrack(doc), 0, 192);
    const text = serializeChart(doc);
    expect(text).toContain('0 = S 2 192');
  });

  it('emits activation lane as S 64', () => {
    const doc = makeDocWithDrumTrack();
    addActivationLane(getTrack(doc), 0, 192);
    const text = serializeChart(doc);
    expect(text).toContain('0 = S 64 192');
  });

  it('emits solo section events', () => {
    const doc = makeDocWithDrumTrack();
    addSoloSection(getTrack(doc), 0, 192);
    const text = serializeChart(doc);
    expect(text).toContain('E "solo"');
    expect(text).toContain('E "soloend"');
  });

  // ---------------------------------------------------------------------------
  // Line endings
  // ---------------------------------------------------------------------------

  it('uses Windows line endings', () => {
    const doc = createChart({ format: 'chart' });
    const text = serializeChart(doc);
    expect(text).toContain('\r\n');
    // No bare \n (not preceded by \r)
    const stripped = text.replace(/\r\n/g, '');
    expect(stripped).not.toContain('\n');
  });

  // ---------------------------------------------------------------------------
  // Round-trip
  // ---------------------------------------------------------------------------

  it('round-trips through parseChartFile', () => {
    const doc = makeDocWithDrumTrack();
    const track = getTrack(doc);

    // Add a few notes
    addDrumNote(track, { tick: 0, type: 'kick' });
    addDrumNote(track, { tick: 192, type: 'redDrum' });
    addDrumNote(track, {
      tick: 384,
      type: 'yellowDrum',
      flags: { cymbal: true },
    });

    // Add a section
    addSection(doc, 0, 'Intro');

    // Add star power
    addStarPower(track, 0, 384);

    const text = serializeChart(doc);
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const parsed = parseChartFile(data, 'chart');

    // Resolution
    expect(parsed.resolution).toBe(192);

    // Tempos
    expect(parsed.tempos.length).toBeGreaterThanOrEqual(1);
    expect(parsed.tempos[0].beatsPerMinute).toBe(120);

    // Time signatures
    expect(parsed.timeSignatures.length).toBeGreaterThanOrEqual(1);

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
    expect(drumTrack!.starPowerSections[0].length).toBe(384);
  });
});
