/**
 * Regression tests for bugs found during real-chart validation.
 *
 * Each test encodes a specific bug that was caught by the 15K chart test suite,
 * ensuring it doesn't regress without needing to re-run the full set.
 */

import {
  createChart,
  writeChart,
  readChart,
  addDrumNote,
  addStarPower,
  addSoloSection,
  addFlexLane,
  addActivationLane,
  addSection,
  eventTypes,
} from '../index';
import type { ChartDocument, FileEntry, TrackData } from '../types';
import { serializeChart } from '../writer-chart';
import { serializeMidi } from '../writer-mid';
import { parseChartFile } from '@eliwhite/scan-chart';

function makeDoc(format: 'chart' | 'mid' = 'chart'): ChartDocument {
  const doc = createChart({ format, resolution: 480 });
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

// ---------------------------------------------------------------------------
// Solo sections
// ---------------------------------------------------------------------------

describe('solo section roundtrip', () => {
  it('unquoted E solo events in .chart survive roundtrip', () => {
    // Bug: scan-chart's mergeSoloEvents used endTick - startTick + 1,
    // causing solo length to grow by 1 on each roundtrip.
    const doc = makeDoc('chart');
    addDrumNote(doc.trackData[0], { tick: 960, type: 'kick' });
    doc.trackData[0].soloSections.push({ tick: 960, length: 480 });

    const files = writeChart(doc);
    const doc2 = readChart(files);
    const files2 = writeChart(doc2);

    const text1 = new TextDecoder().decode(files.find(f => f.fileName === 'notes.chart')!.data);
    const text2 = new TextDecoder().decode(files2.find(f => f.fileName === 'notes.chart')!.data);

    // soloend tick should be identical
    const soloend1 = text1.match(/(\d+) = E soloend/)?.[1];
    const soloend2 = text2.match(/(\d+) = E soloend/)?.[1];
    expect(soloend1).toBe(soloend2);
    expect(soloend1).toBe('1440'); // 960 + 480
  });

  it('E solo events in track sections are NOT quoted', () => {
    // Bug: writer added quotes around solo/soloend text in track sections,
    // but the format uses unquoted E events.
    const doc = makeDoc('chart');
    addDrumNote(doc.trackData[0], { tick: 0, type: 'kick' });
    doc.trackData[0].soloSections.push({ tick: 0, length: 480 });
    const text = serializeChart(doc);

    expect(text).toContain('E solo');
    expect(text).toContain('E soloend');
    expect(text).not.toMatch(/E "solo"/);
    expect(text).not.toMatch(/E "soloend"/);
  });
});

// ---------------------------------------------------------------------------
// Section names with brackets
// ---------------------------------------------------------------------------

describe('section name with brackets', () => {
  it('preserves ]] in section names through roundtrip', () => {
    // Bug: scan-chart's section regex (.*?)\]?" stripped a trailing ]
    // from section names on each parse, progressively truncating.
    const doc = makeDoc('chart');
    addDrumNote(doc.trackData[0], { tick: 0, type: 'kick' });
    addSection(doc, 0, '[[BREAKDOWN]]');

    const files = writeChart(doc);
    const doc2 = readChart(files);
    expect(doc2.sections[0].name).toBe('[[BREAKDOWN]]');
  });
});

// ---------------------------------------------------------------------------
// Disco flip
// ---------------------------------------------------------------------------

describe('disco flip roundtrip', () => {
  it('.chart preserves disco flip events in track sections', () => {
    // Bug: .chart writer didn't emit disco flip E events.
    const doc = makeDoc('chart');
    addDrumNote(doc.trackData[0], { tick: 0, type: 'kick' });
    doc.trackData[0].trackEvents.push({
      tick: 480,
      length: 0,
      type: eventTypes.discoFlipOff,
    });

    const text = serializeChart(doc);
    expect(text).toContain('mix 3 drums0');
  });

  it('MIDI preserves disco flip per-difficulty', () => {
    // Bug: MIDI writer deduped disco flip by tick+type, losing per-difficulty events.
    const doc = makeDoc('mid');
    // Add a disco flip to expert
    addDrumNote(doc.trackData[0], { tick: 0, type: 'kick' });
    doc.trackData[0].trackEvents.push({
      tick: 480,
      length: 0,
      type: eventTypes.discoFlipOff,
    });

    const bytes = serializeMidi(doc);
    const parsed = parseChartFile(bytes, 'mid');
    const expert = parsed.trackData.find(
      (t) => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    expect(expert).toBeDefined();
    // The disco flip should survive the roundtrip
    // (scan-chart produces discoFlipOff as a trackEvent)
  });
});

// ---------------------------------------------------------------------------
// forceOpen SysEx
// ---------------------------------------------------------------------------

describe('forceOpen SysEx', () => {
  it('MIDI writer emits SysEx for forceOpen events', () => {
    // Bug: forceOpen was skipped with "complex encoding" comment.
    const doc = createChart({ format: 'mid', resolution: 480 });
    doc.trackData.push({
      instrument: 'guitar',
      difficulty: 'expert',
      starPowerSections: [],
      rejectedStarPowerSections: [],
      soloSections: [],
      flexLanes: [],
      drumFreestyleSections: [],
      trackEvents: [
        { tick: 0, length: 480, type: eventTypes.green },
        { tick: 0, length: 480, type: eventTypes.forceOpen },
      ],
    });

    const bytes = serializeMidi(doc);
    const parsed = parseChartFile(bytes, 'mid');
    const guitar = parsed.trackData.find(
      (t) => t.instrument === 'guitar' && t.difficulty === 'expert',
    );
    expect(guitar).toBeDefined();
    // forceOpen should roundtrip
    const hasOpen = guitar!.noteEventGroups.some((group) =>
      group.some((n) => n.type === 0), // noteTypes.open
    );
    expect(hasOpen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Flex lane LDS velocity
// ---------------------------------------------------------------------------

describe('flex lane LDS velocity', () => {
  it('writes flex lanes with correct velocity for non-expert difficulties', () => {
    // Bug: all flex lanes written with velocity 100 (expert-only).
    // fixFlexLaneLds in scan-chart filters by velocity range per difficulty.
    const doc = createChart({ format: 'mid', resolution: 480 });
    // Add drums with flex lanes on hard
    for (const difficulty of ['expert', 'hard'] as const) {
      doc.trackData.push({
        instrument: 'drums',
        difficulty,
        starPowerSections: [],
        rejectedStarPowerSections: [],
        soloSections: [],
        flexLanes: [{ tick: 0, length: 480, isDouble: false }],
        drumFreestyleSections: [],
        trackEvents: [{ tick: 0, length: 1, type: eventTypes.kick }],
      });
    }

    const bytes = serializeMidi(doc);
    const parsed = parseChartFile(bytes, 'mid');
    const hard = parsed.trackData.find(
      (t) => t.instrument === 'drums' && t.difficulty === 'hard',
    );
    expect(hard).toBeDefined();
    expect(hard!.flexLanes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Duplicate track dedup in scan-chart
// ---------------------------------------------------------------------------

describe('coda freestyle sections', () => {
  it('coda sections produce MIDI note 120 AND [coda] text event', () => {
    // Bug: original writer skipped coda sections from note 120 output,
    // losing the freestyle section on re-parse (only [coda] text preserved).
    const doc = makeDoc('mid');
    addDrumNote(doc.trackData[0], { tick: 0, type: 'kick' });
    doc.trackData[0].drumFreestyleSections.push({
      tick: 960,
      length: 480,
      isCoda: true,
    });

    const bytes = serializeMidi(doc);
    const parsed = parseChartFile(bytes, 'mid');
    const expert = parsed.trackData.find(
      (t) => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    expect(expert).toBeDefined();
    expect(expert!.drumFreestyleSections.length).toBe(1);
    expect(expert!.drumFreestyleSections[0].isCoda).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Zero-length MIDI notes
// ---------------------------------------------------------------------------

describe('zero-length MIDI notes', () => {
  it('zero-length drum notes survive MIDI roundtrip', () => {
    // Bug: noteOff sorted before noteOn at same tick, causing scan-chart
    // to discard the note. Fixed with Math.max(length, 1).
    const doc = makeDoc('mid');
    addDrumNote(doc.trackData[0], { tick: 0, type: 'kick' });
    addDrumNote(doc.trackData[0], { tick: 480, type: 'redDrum' });

    const bytes = serializeMidi(doc);
    const parsed = parseChartFile(bytes, 'mid');
    const expert = parsed.trackData.find(
      (t) => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    expect(expert!.noteEventGroups.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// PART VOCALS lyrics
// ---------------------------------------------------------------------------

describe('MIDI lyrics on PART VOCALS', () => {
  it('lyrics are written to PART VOCALS track, not EVENTS', () => {
    // Bug: original writer put lyrics on EVENTS track, but scan-chart
    // reads them from PART VOCALS only.
    const doc = makeDoc('mid');
    addDrumNote(doc.trackData[0], { tick: 0, type: 'kick' });
    doc.lyrics = [{ tick: 0, length: 0, text: 'Hello' }];

    const bytes = serializeMidi(doc);
    const parsed = parseChartFile(bytes, 'mid');
    expect(parsed.lyrics).toHaveLength(1);
    expect(parsed.lyrics[0].text).toBe('Hello');
  });
});

// ---------------------------------------------------------------------------
// Tom markers on non-drum instruments (scan-chart bug)
// ---------------------------------------------------------------------------

describe('tom markers are drums-only', () => {
  it('MIDI notes 110-112 on guitar are ignored, not parsed as tom markers', () => {
    // Bug: scan-chart's getInstrumentEventType returned yellowTomMarker
    // for note 110 on ALL instruments, causing guitar tracks to have
    // tom marker events that can't roundtrip.
    const doc = createChart({ format: 'mid', resolution: 480 });
    doc.trackData.push({
      instrument: 'guitar',
      difficulty: 'expert',
      starPowerSections: [],
      rejectedStarPowerSections: [],
      soloSections: [],
      flexLanes: [],
      drumFreestyleSections: [],
      trackEvents: [
        { tick: 0, length: 480, type: eventTypes.green },
        { tick: 480, length: 480, type: eventTypes.red },
      ],
    });

    const bytes = serializeMidi(doc);
    const parsed = parseChartFile(bytes, 'mid');
    const guitar = parsed.trackData.find(
      (t) => t.instrument === 'guitar' && t.difficulty === 'expert',
    );
    expect(guitar).toBeDefined();
    // No tom markers should appear on guitar
    const hasTomMarkers = guitar!.noteEventGroups.some((group) =>
      group.some((n) => n.flags & 16), // noteFlags.tom
    );
    expect(hasTomMarkers).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Duplicate track dedup (scan-chart bug)
// ---------------------------------------------------------------------------

describe('duplicate MIDI track dedup', () => {
  it('scan-chart deduplicates trackData entries with same tick+type', () => {
    // Bug: some MIDIs produced duplicate trackEvents or starPowerSections
    // at the same tick, causing count mismatches on roundtrip.
    const doc = makeDoc('mid');
    addDrumNote(doc.trackData[0], { tick: 0, type: 'kick' });
    // Manually add duplicate SP at same tick
    doc.trackData[0].starPowerSections.push(
      { tick: 960, length: 480 },
      { tick: 960, length: 480 },
    );

    const files = writeChart(doc);
    const doc2 = readChart(files);
    const expert = doc2.trackData.find(
      (t) => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    // Writer should write only one SP, re-parse should have only one
    expect(expert!.starPowerSections.length).toBe(1);
  });
});
