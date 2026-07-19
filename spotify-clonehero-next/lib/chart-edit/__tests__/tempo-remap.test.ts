/**
 * Audio-anchored tempo remap tests (plan 0061 §3 class (a) / §5).
 *
 * Covers the KEEP-MS primitive and the pure helpers it composes:
 *  - `synctrackFromChart` round-trips a chart's tempo grid through the
 *    ms-anchored `Synctrack` shape `swapSynctrack` consumes.
 *  - `nudgeNoteCollisions` bumps same-pad collisions apart (+1 tick, never
 *    merge, count preserved).
 *  - `applyMarkerMoveBpms` derives format-quantized segment BPMs for a marker
 *    drag, clamped so a marker can't cross a neighbour.
 *  - `remapKeepMs` preserves note audio time, exact-re-ticks lyrics, snaps
 *    sections to whole-note gridlines, and round-trips through write→parse.
 */

import {parseChartFile, defaultIniChartModifiers} from '@eliwhite/scan-chart';
import type {ChartDocument, ParsedChart, NoteEvent} from '../types';
import {
  createEmptyChart,
  writeChartFolder,
  addDrumNote,
  addSection,
  retimeChart,
  makeChartTiming,
  synctrackFromChart,
  nudgeNoteCollisions,
  applyMarkerMoveBpms,
  remapKeepMs,
  quantizeBpm,
} from '../index';
import {emptyTrackData} from './test-utils';
import {buildSegments, tickToMs} from '@/lib/tempo-map/synctrack-ticks';
import type {Synctrack} from '@/lib/tempo-map/types';

const RES = 480;
const MODIFIERS = {...defaultIniChartModifiers, pro_drums: true};

/** A 120-BPM chart (res 480) with drum notes, a section, and one vocal lyric,
 *  all with correct baseline timing. `bpm2`/`ts2` add a mid-song change. */
function makeDoc(): ChartDocument {
  const parsedChart = createEmptyChart({
    format: 'chart',
    bpm: 120,
    resolution: RES,
  });
  parsedChart.iniChartModifiers = {
    ...parsedChart.iniChartModifiers,
    pro_drums: true,
  };
  const track = emptyTrackData('drums', 'expert');
  parsedChart.trackData.push(track);
  const doc: ChartDocument = {parsedChart, assets: []};

  const timing = makeChartTiming(parsedChart);
  addDrumNote(track, {tick: 480, type: 'redDrum'}, timing);
  addDrumNote(
    track,
    {tick: 960, type: 'yellowDrum', flags: {cymbal: true}},
    timing,
  );
  addDrumNote(track, {tick: 1440, type: 'blueDrum'}, timing);
  addDrumNote(track, {tick: 1920, type: 'greenDrum'}, timing);

  addSection(doc, 720, 'Verse');

  parsedChart.vocalTracks = {
    parts: {
      vocals: {
        notePhrases: [
          {
            tick: 0,
            msTime: 0,
            length: 1920,
            msLength: 0,
            isPercussion: false,
            notes: [
              {
                tick: 600,
                msTime: 0,
                length: 60,
                msLength: 0,
                pitch: 60,
                type: 'pitched',
              },
            ],
            lyrics: [{tick: 600, msTime: 0, text: 'la', flags: 0}],
          },
        ],
        staticLyricPhrases: [],
        starPowerSections: [],
        rangeShifts: [],
        lyricShifts: [],
        textEvents: [],
      },
    },
    rangeShifts: [],
    lyricShifts: [],
  };

  retimeChart(parsedChart);
  return doc;
}

function cloneWithTempos(
  doc: ChartDocument,
  tempos: ParsedChart['tempos'],
): ChartDocument {
  return {
    ...doc,
    parsedChart: {...doc.parsedChart, tempos},
  };
}

function flatNotes(doc: ChartDocument): NoteEvent[] {
  return doc.parsedChart.trackData[0].noteEventGroups.flat();
}

function parseDoc(doc: ChartDocument): ChartDocument {
  const files = writeChartFolder({parsedChart: doc.parsedChart, assets: []});
  const chartFile = files.find(f => f.fileName === 'notes.chart')!;
  const parsed = parseChartFile(chartFile.data, 'chart', MODIFIERS);
  return {
    parsedChart: {
      ...parsed,
      chartBytes: chartFile.data,
      format: 'chart',
      iniChartModifiers: MODIFIERS,
    },
    assets: [],
  };
}

// ---------------------------------------------------------------------------
// synctrackFromChart
// ---------------------------------------------------------------------------

describe('synctrackFromChart', () => {
  it('integrates ms from a multi-tempo chart consistently with bpm', () => {
    const doc = makeDoc();
    doc.parsedChart.tempos = [
      {tick: 0, beatsPerMinute: 120, msTime: 0},
      {tick: 1920, beatsPerMinute: 90, msTime: 0},
    ];
    retimeChart(doc.parsedChart);

    const sync = synctrackFromChart(doc.parsedChart);
    expect(sync.tempos.map(t => t.bpm)).toEqual([120, 90]);
    // tempo 1 at tick 1920 / 120bpm = 4 beats = 2000ms.
    expect(sync.tempos[0].ms).toBe(0);
    expect(sync.tempos[1].ms).toBeCloseTo(2000, 6);
  });

  it('round-trips notes through swapSynctrack keeping their audio time', () => {
    const doc = makeDoc();
    const sync = synctrackFromChart(doc.parsedChart);
    const remapped = remapKeepMs(doc, sync);
    // An identity remap must leave every note's audio time intact.
    const before = flatNotes(doc);
    const after = flatNotes(remapped);
    for (const b of before) {
      const a = after.find(n => n.type === b.type)!;
      expect(Math.abs(a.msTime - b.msTime)).toBeLessThan(3);
    }
  });
});

// ---------------------------------------------------------------------------
// nudgeNoteCollisions
// ---------------------------------------------------------------------------

describe('nudgeNoteCollisions', () => {
  const note = (tick: number, type: number, msTime: number): NoteEvent =>
    ({tick, msTime, length: 0, msLength: 0, type, flags: 0}) as NoteEvent;

  it('bumps the later same-pad note +1 tick and preserves count', () => {
    // Two reds (type 0) on tick 500; the later one (bigger msTime) yields.
    const groups = [[note(500, 0, 100)], [note(500, 0, 120)]];
    const out = nudgeNoteCollisions(groups);
    const flat = out.flat();
    expect(flat).toHaveLength(2);
    const ticks = flat.map(n => n.tick).sort((a, b) => a - b);
    expect(ticks).toEqual([500, 501]);
    // The earlier hit (msTime 100) keeps 500.
    expect(flat.find(n => n.msTime === 100)!.tick).toBe(500);
    expect(flat.find(n => n.msTime === 120)!.tick).toBe(501);
  });

  it('repeats the nudge until a free slot is found', () => {
    const groups = [
      [note(500, 0, 100)],
      [note(500, 0, 110)],
      [note(501, 0, 120)],
    ];
    const out = nudgeNoteCollisions(groups).flat();
    expect(out.map(n => n.tick).sort((a, b) => a - b)).toEqual([500, 501, 502]);
  });

  it('leaves different-type notes on one tick as a chord', () => {
    const groups = [[note(500, 0, 100), note(500, 1, 100)]];
    const out = nudgeNoteCollisions(groups);
    expect(out).toHaveLength(1);
    expect(out[0].map(n => n.tick)).toEqual([500, 500]);
  });

  it('merges different-type notes that land on one tick into one group', () => {
    const groups = [[note(500, 0, 100)], [note(500, 1, 100)]];
    const out = nudgeNoteCollisions(groups);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// applyMarkerMoveBpms
// ---------------------------------------------------------------------------

describe('applyMarkerMoveBpms', () => {
  it('recomputes both adjacent segment BPMs, format-quantized', () => {
    const chart = makeDoc().parsedChart;
    chart.tempos = [
      {tick: 0, beatsPerMinute: 120, msTime: 0},
      {tick: 1920, beatsPerMinute: 120, msTime: 2000},
      {tick: 3840, beatsPerMinute: 120, msTime: 4000},
    ];
    // Drag marker at 1920 from 2000ms to 2200ms.
    const applied = applyMarkerMoveBpms(chart, 1920, 2200, 'chart');
    // The marker lands where prev's QUANTIZED bpm re-integrates to — a sub-ms
    // residue off the requested 2200ms (plan 0061 §2 / Finding 4), not exact.
    expect(applied).toBeCloseTo(2200, 0);
    // Prev segment: 4 beats over ~2.2s.
    expect(chart.tempos[0].beatsPerMinute).toBe(
      quantizeBpm(4 / (2200 / 60000), 'chart'),
    );
    // Cur segment BPM is chosen from the marker's re-integrated landing so the
    // NEXT marker's ms stays put — from (4000 - applied), not (4000 - 2200).
    expect(chart.tempos[1].beatsPerMinute).toBe(
      quantizeBpm(4 / ((4000 - applied) / 60000), 'chart'),
    );
    // Every stored BPM is already .chart-representable.
    for (const t of chart.tempos)
      expect(quantizeBpm(t.beatsPerMinute, 'chart')).toBe(t.beatsPerMinute);
  });

  it('keeps the next marker within one BPM-quantization step (single edit)', () => {
    const chart = makeDoc().parsedChart;
    chart.tempos = [
      {tick: 0, beatsPerMinute: 120, msTime: 0},
      {tick: 1920, beatsPerMinute: 120, msTime: 2000},
      {tick: 3840, beatsPerMinute: 120, msTime: 4000},
    ];
    const nextOrig = chart.tempos[2].msTime; // 4000
    applyMarkerMoveBpms(chart, 1920, 2200, 'chart');
    retimeChart(chart); // recompute every msTime from the quantized BPMs
    // Derived bound: the ms a single milli-BPM step spans over the far
    // (4-beat) segment. The residue must sit below it (Finding 4).
    const curBpm = chart.tempos[1].beatsPerMinute;
    const oneStepMs = ((4 * 60000) / (curBpm * curBpm)) * 0.001;
    expect(Math.abs(chart.tempos[2].msTime - nextOrig)).toBeLessThan(
      oneStepMs + 1e-6,
    );
  });

  it('does not accumulate neighbour drift over 100 repeated drags', () => {
    const chart = makeDoc().parsedChart;
    chart.tempos = [
      {tick: 0, beatsPerMinute: 120, msTime: 0},
      {tick: 1920, beatsPerMinute: 120, msTime: 2000},
      {tick: 3840, beatsPerMinute: 120, msTime: 4000},
    ];
    const nextOrig = 4000;
    let maxResidue = 0;
    for (let i = 0; i < 100; i++) {
      // Each drag re-derives from the marker's CURRENT (retimed) ms, targeting
      // the neighbour's current position — the case that would random-walk if
      // the residue compounded. Quantization's fixed point pins it instead.
      applyMarkerMoveBpms(chart, 1920, 2200, 'chart');
      retimeChart(chart);
      maxResidue = Math.max(
        maxResidue,
        Math.abs(chart.tempos[2].msTime - nextOrig),
      );
    }
    // A linear random walk over 100 edits would leave this bound far behind;
    // the fixed-point convergence keeps it pinned to a single sub-ms step.
    expect(maxResidue).toBeLessThan(0.05);
  });

  it('leaves the last marker BPM (open tail) unchanged', () => {
    const chart = makeDoc().parsedChart;
    chart.tempos = [
      {tick: 0, beatsPerMinute: 120, msTime: 0},
      {tick: 1920, beatsPerMinute: 140, msTime: 2000},
    ];
    applyMarkerMoveBpms(chart, 1920, 2200, 'chart');
    expect(chart.tempos[1].beatsPerMinute).toBe(140);
  });

  it('clamps a drag that would cross a neighbour', () => {
    const chart = makeDoc().parsedChart;
    chart.tempos = [
      {tick: 0, beatsPerMinute: 120, msTime: 0},
      {tick: 1920, beatsPerMinute: 120, msTime: 2000},
      {tick: 3840, beatsPerMinute: 120, msTime: 4000},
    ];
    // Try to drag marker 1920 past marker 3840 (4000ms).
    const applied = applyMarkerMoveBpms(chart, 1920, 9999, 'chart');
    expect(applied).toBeLessThan(4000);
    expect(applied).toBeGreaterThan(2000);
  });

  it('refuses to move the song-start anchor', () => {
    const chart = makeDoc().parsedChart;
    expect(() => applyMarkerMoveBpms(chart, 0, 100, 'chart')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// remapKeepMs (class (a) KEEP-MS)
// ---------------------------------------------------------------------------

describe('remapKeepMs', () => {
  /** Change the whole song to 90 BPM (a hand-edit), audio-anchored. */
  function remapTo90(doc: ChartDocument): ChartDocument {
    const changed = cloneWithTempos(doc, [
      {tick: 0, beatsPerMinute: 90, msTime: 0},
    ]);
    return remapKeepMs(changed, synctrackFromChart(changed.parsedChart));
  }

  it('preserves every note audio time within the abstain band', () => {
    const doc = makeDoc();
    const before = flatNotes(doc).map(n => ({type: n.type, msTime: n.msTime}));
    const out = remapTo90(doc);
    const after = flatNotes(out);
    for (const b of before) {
      const a = after.find(n => n.type === b.type)!;
      expect(Math.abs(a.msTime - b.msTime)).toBeLessThan(45);
    }
    expect(after).toHaveLength(before.length);
  });

  it('re-ticks notes onto the new grid (they do not keep their ticks)', () => {
    const doc = makeDoc();
    const beforeTicks = flatNotes(doc)
      .map(n => n.tick)
      .sort((a, b) => a - b);
    const after = flatNotes(remapTo90(doc))
      .map(n => n.tick)
      .sort((a, b) => a - b);
    // Under 90bpm a note at 2000ms lands on a different tick than at 120bpm.
    expect(after).not.toEqual(beforeTicks);
  });

  it('keeps lyrics at their exact audio time (no quantize)', () => {
    const doc = makeDoc();
    const lyricBefore =
      doc.parsedChart.vocalTracks!.parts['vocals'].notePhrases[0].lyrics[0];
    const msBefore = lyricBefore.msTime;
    const out = remapTo90(doc);
    const lyricAfter =
      out.parsedChart.vocalTracks!.parts['vocals'].notePhrases[0].lyrics[0];
    expect(Math.abs(lyricAfter.msTime - msBefore)).toBeLessThan(3);
  });

  it('snaps sections to the nearest whole-note gridline', () => {
    const doc = makeDoc();
    const out = remapTo90(doc);
    const section = out.parsedChart.sections[0];
    // Whole-note grid = resolution*4 ticks.
    expect(section.tick % (RES * 4)).toBe(0);
  });

  it('produces a doc that is already its own write→parse fixed point', () => {
    const doc = makeDoc();
    const out = remapTo90(doc);
    const reparsed = parseDoc(out);
    // Tempo BPMs survive the round trip exactly (format-quantized).
    expect(reparsed.parsedChart.tempos.map(t => t.beatsPerMinute)).toEqual(
      out.parsedChart.tempos.map(t => t.beatsPerMinute),
    );
    // Note ticks survive exactly.
    const outTicks = flatNotes(out)
      .map(n => n.tick)
      .sort((a, b) => a - b);
    const reTicks = flatNotes(reparsed)
      .map(n => n.tick)
      .sort((a, b) => a - b);
    expect(reTicks).toEqual(outTicks);
  });

  it('nudges notes that quantize onto the same tick apart', () => {
    const doc = makeDoc();
    const track = doc.parsedChart.trackData[0];
    // Two reds a few ticks apart that quantize into the same 16th slot.
    track.noteEventGroups = [];
    const timing = makeChartTiming(doc.parsedChart);
    addDrumNote(track, {tick: 480, type: 'redDrum'}, timing);
    addDrumNote(track, {tick: 486, type: 'redDrum'}, timing);
    const out = remapTo90(doc);
    const flat = flatNotes(out);
    // Count preserved, and the two same-pad notes are not on the same tick.
    expect(flat).toHaveLength(2);
    expect(flat[0].tick).not.toBe(flat[1].tick);
  });
});
