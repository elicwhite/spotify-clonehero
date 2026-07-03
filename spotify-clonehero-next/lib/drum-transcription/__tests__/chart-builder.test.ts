/**
 * Tests for pipeline/chart-builder:
 *
 *  - Chart build under a non-trivial multi-tempo synctrack: drum events are
 *    quantized with msToTick over the REAL tempo map, and the chart's
 *    tempos/timeSignatures match the lib/tempo-map conversion
 *    (swapSynctrack/buildSyncLayout semantics, incl. lead-in handling).
 *  - Flat-120 fallback when no synctrack is available.
 *  - Cymbal round-trip regression: drumType=fourLanePro must survive
 *    writeChartFolder -> readChart({pro_drums: true}) so cymbals stay
 *    cymbals and toms stay toms.
 */

import {
  buildChartDocument,
  buildConfidenceData,
  RESOLUTION,
} from '../pipeline/chart-builder';
import {buildTimedTempos, msToTick} from '../timing';
import type {RawDrumEvent} from '../ml/types';
import type {Synctrack} from '@/lib/tempo-map/types';
import {
  writeChartFolder,
  readChart,
  getDrumNotes,
  drumTypes,
} from '@/lib/chart-edit';

function ev(
  timeSeconds: number,
  drumClass: RawDrumEvent['drumClass'],
  confidence = 0.9,
): RawDrumEvent {
  return {timeSeconds, drumClass, midiPitch: 0, confidence};
}

describe('buildChartDocument with a multi-tempo synctrack', () => {
  // 120 BPM for 4s (= 8 beats = 3840 ticks), then 160 BPM.
  const sync: Synctrack = {
    origin_ms: 0,
    tempos: [
      {ms: 0, bpm: 120},
      {ms: 4000, bpm: 160},
    ],
    timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
  };
  const events = [ev(1.0, 'BD'), ev(5.0, 'SD', 0.8), ev(5.75, 'HH', 0.7)];
  const doc = buildChartDocument(events, 'Multi Tempo', 10, sync);
  const chart = doc.parsedChart;

  it('installs the synctrack tempos in tick domain', () => {
    expect(
      chart.tempos.map(t => ({tick: t.tick, bpm: t.beatsPerMinute})),
    ).toEqual([
      {tick: 0, bpm: 120},
      {tick: 3840, bpm: 160}, // 4s * 2 beats/s * 480
    ]);
    expect(
      chart.timeSignatures.map(ts => ({
        tick: ts.tick,
        numerator: ts.numerator,
        denominator: ts.denominator,
      })),
    ).toEqual([{tick: 0, numerator: 4, denominator: 4}]);
  });

  it('quantizes drum events against the real tempo map', () => {
    const notes = getDrumNotes(chart.trackData[0]);
    const byTick = new Map(notes.map(n => [n.tick, n]));
    // 1.0s @120 -> 960; 5.0s -> 3840 + 1s@160 (1280) = 5120; 5.75s -> 6080.
    expect(byTick.get(960)?.type).toBe('kick');
    expect(byTick.get(5120)?.type).toBe('redDrum');
    expect(byTick.get(6080)?.type).toBe('yellowDrum');
    expect(byTick.get(6080)?.flags.cymbal).toBe(true);

    // Generic consistency: every note tick equals msToTick over the tempo
    // map actually written into the chart.
    const timed = buildTimedTempos(chart.tempos, RESOLUTION);
    const expected = events
      .map(e => msToTick(e.timeSeconds * 1000, timed, RESOLUTION))
      .sort((a, b) => a - b);
    expect(notes.map(n => n.tick).sort((a, b) => a - b)).toEqual(expected);
  });

  it('keys confidence data by the same real-tempo-map ticks', () => {
    const conf = buildConfidenceData(events, chart.tempos, RESOLUTION);
    expect(conf.notes).toEqual({
      '960-kick': 0.9,
      '5120-redDrum': 0.8,
      '6080-yellowDrum': 0.7,
    });
  });

  it('places the end event past the audio duration under the tempo map', () => {
    // 10s -> 3840 + 6s@160 (7680) = 11520 ticks.
    expect(chart.endEvents[0].tick).toBe(11520);
  });

  it('starts sections on real bar lines', () => {
    expect(chart.sections[0]).toMatchObject({tick: 0, name: 'Intro'});
    // 4/4 at 480 -> 1920/bar; next section 4 bars later.
    expect(chart.sections[1]?.tick).toBe(4 * 1920);
  });
});

describe('buildChartDocument with a lead-in origin', () => {
  // First downbeat at 1.0s @120 BPM (2 beats of lead-in): synctrack-ticks
  // writes a 2/4 partial first bar (leadInTs) and the real 4/4 at tick 960.
  const sync: Synctrack = {
    origin_ms: 1000,
    tempos: [
      {ms: 1000, bpm: 120},
      {ms: 5000, bpm: 150},
    ],
    timeSignatures: [{ms: 1000, numerator: 4, denominator: 4}],
  };
  const events = [ev(6.0, 'SD')];
  const doc = buildChartDocument(events, 'Lead In', 8, sync);
  const chart = doc.parsedChart;

  it('writes the partial lead-in bar time signature', () => {
    expect(
      chart.timeSignatures.map(ts => ({
        tick: ts.tick,
        numerator: ts.numerator,
        denominator: ts.denominator,
      })),
    ).toEqual([
      {tick: 0, numerator: 2, denominator: 4},
      {tick: 960, numerator: 4, denominator: 4},
    ]);
  });

  it('collapses the same-BPM lead-in segment and re-ticks tempo changes', () => {
    // Lead-in BPM equals the real BPM (2 beats over 1s = 120), so the
    // segment list collapses to one 120 entry; 150 starts 8 beats after
    // the origin: 960 + 3840 = 4800.
    expect(
      chart.tempos.map(t => ({tick: t.tick, bpm: t.beatsPerMinute})),
    ).toEqual([
      {tick: 0, bpm: 120},
      {tick: 4800, bpm: 150},
    ]);
  });

  it('quantizes events under the lead-in-adjusted map', () => {
    // 6.0s: tempo 150 starts at ms 5000 (tick 4800); +1s @150 = 1200.
    const notes = getDrumNotes(chart.trackData[0]);
    expect(notes).toHaveLength(1);
    expect(notes[0].tick).toBe(6000);
    expect(notes[0].type).toBe('redDrum');
  });
});

describe('buildChartDocument without a synctrack (fallback)', () => {
  it('produces the flat-120 chart', () => {
    const doc = buildChartDocument([ev(1.0, 'BD')], 'Flat', 4, null);
    expect(
      doc.parsedChart.tempos.map(t => ({
        tick: t.tick,
        bpm: t.beatsPerMinute,
      })),
    ).toEqual([{tick: 0, bpm: 120}]);
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    expect(notes[0].tick).toBe(960);
  });
});

describe('grid snapping of transcribed onsets', () => {
  // Flat 120 BPM (no synctrack): tick = ms * 0.96, so 1 tick = 1.0416̅ ms.
  // Snap grid = 16ths (120) / 16th-triplets (80). Onsets near a subdivision
  // snap to it; onsets whose nearest grid line is more than the default
  // 40 ms abstain band away (at the local tempo) are left at their raw tick
  // rather than force-snapped, matching /tempo's swapSynctrack quantizer.
  //   0.37s  -> 355t -> 360 (16th,    drift 5.0 ms  -> snaps)
  //   0.17s  -> 163t -> 160 (triplet, drift 3.3 ms  -> snaps)
  //   0.208s -> 200t -> 240 (16th=triplet tie at 240, drift 42 ms > 40 ms
  //                          -> ABSTAINS, note stays at raw tick 200)
  const events = [
    ev(0.37, 'SD', 0.91), // near a 16th -> snaps
    ev(0.17, 'HH', 0.72), // near an 8th-triplet -> snaps
    ev(0.208, 'BD', 0.63), // in the widest 16th∪triplet gap -> abstains
  ];

  it('snaps within-tolerance onsets and abstains on far-off-grid ones', () => {
    const doc = buildChartDocument(events, 'Snap Flat', 4, null);
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    const byKey = new Map(notes.map(n => [`${n.tick}-${n.type}`, n]));
    expect(byKey.has('360-redDrum')).toBe(true); // 16th (within tolerance)
    expect(byKey.has('160-yellowDrum')).toBe(true); // triplet (HH cymbal)
    expect(byKey.get('160-yellowDrum')?.flags.cymbal).toBe(true);
    // The far-off-grid kick abstains: it keeps its raw rounded tick (200),
    // NOT the nearest grid line (240).
    expect(byKey.has('200-kick')).toBe(true);
    expect(byKey.has('240-kick')).toBe(false);
    // The snapped onsets leave no raw residue behind.
    const ticks = notes.map(n => n.tick);
    expect(ticks).not.toContain(355);
    expect(ticks).not.toContain(163);
  });

  it('keys confidence data by the SAME snapped/abstained ticks as the notes', () => {
    const doc = buildChartDocument(events, 'Snap Flat', 4, null);
    const conf = buildConfidenceData(
      events,
      doc.parsedChart.tempos.map(t => ({
        tick: t.tick,
        beatsPerMinute: t.beatsPerMinute,
      })),
      RESOLUTION,
    );
    expect(conf.notes).toEqual({
      '360-redDrum': 0.91,
      '160-yellowDrum': 0.72,
      '200-kick': 0.63, // abstained note: confidence key uses the raw tick too
    });
    // Every confidence key must correspond to a real note tick+type.
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    const noteKeys = new Set(notes.map(n => `${n.tick}-${n.type}`));
    for (const key of Object.keys(conf.notes)) {
      expect(noteKeys.has(key)).toBe(true);
    }
  });

  it('snaps under a real synctrack too', () => {
    // 120 BPM through 4s, then 160. The 0.37s onset sits in the 120 region
    // and must snap to the 16th at tick 360 just like the flat case.
    const sync: Synctrack = {
      origin_ms: 0,
      tempos: [
        {ms: 0, bpm: 120},
        {ms: 4000, bpm: 160},
      ],
      timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
    };
    const doc = buildChartDocument([ev(0.37, 'SD')], 'Snap Sync', 8, sync);
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    expect(notes).toHaveLength(1);
    expect(notes[0].tick).toBe(360);
  });
});

describe('dedup of onsets colliding on the same snapped tick', () => {
  // Flat 120 BPM: tick = round(ms * 0.96), grid = 16ths (120) / triplets (80).
  it('collapses two same-class onsets that snap to one tick into a single note', () => {
    // SD 0.245s -> 235t -> 240; SD 0.255s -> 245t -> 240. One redDrum at 240.
    const events = [ev(0.245, 'SD', 0.6), ev(0.255, 'SD', 0.8)];
    const doc = buildChartDocument(events, 'Same Class Collision', 4, null);
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({tick: 240, type: 'redDrum'});
  });

  it('keeps the higher-confidence event on a cross-class collision (cymbal wins)', () => {
    // HT (yellow tom) 0.996s and HH (yellow cymbal) 1.004s both snap to 960;
    // HH has the higher confidence -> one yellowDrum with the cymbal flag set.
    const events = [ev(0.996, 'HT', 0.6), ev(1.004, 'HH', 0.9)];
    const doc = buildChartDocument(events, 'Cymbal Wins', 4, null);
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({tick: 960, type: 'yellowDrum'});
    expect(notes[0].flags.cymbal).toBe(true);
  });

  it('keeps the tom (no cymbal flag) when the tom has higher confidence', () => {
    // Mirror of the above: HT outscores HH -> yellow tom, cymbal flag absent.
    const events = [ev(0.996, 'HT', 0.9), ev(1.004, 'HH', 0.6)];
    const doc = buildChartDocument(events, 'Tom Wins', 4, null);
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({tick: 960, type: 'yellowDrum'});
    expect(notes[0].flags.cymbal).not.toBe(true);
  });

  it('prefers the cymbal on a confidence tie', () => {
    // HT and HH tie in confidence at the same snapped tick (960) -> cymbal wins.
    const events = [ev(0.996, 'HT', 0.7), ev(1.004, 'HH', 0.7)];
    const doc = buildChartDocument(events, 'Tie Prefers Cymbal', 4, null);
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({tick: 960, type: 'yellowDrum'});
    expect(notes[0].flags.cymbal).toBe(true);
  });

  it('yields one confidence key at the max confidence for a collision, matching a real note', () => {
    const events = [ev(0.996, 'HT', 0.6), ev(1.004, 'HH', 0.9)];
    const doc = buildChartDocument(events, 'Collision Conf', 4, null);
    const conf = buildConfidenceData(
      events,
      doc.parsedChart.tempos.map(t => ({
        tick: t.tick,
        beatsPerMinute: t.beatsPerMinute,
      })),
      RESOLUTION,
    );
    expect(conf.notes).toEqual({'960-yellowDrum': 0.9});
    // Every confidence key must correspond to a real note tick+type.
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    const noteKeys = new Set(notes.map(n => `${n.tick}-${n.type}`));
    for (const key of Object.keys(conf.notes)) {
      expect(noteKeys.has(key)).toBe(true);
    }
  });
});

describe('cymbal round-trip through writeChartFolder/readChart', () => {
  it('preserves cymbal flags (drumType=fourLanePro) and toms as toms', () => {
    // HH -> yellow cymbal, HT -> yellow tom (same lane, different flag).
    const doc = buildChartDocument(
      [ev(1.0, 'HH'), ev(2.0, 'HT')],
      'Cymbal Test',
      5,
      null,
    );
    expect(doc.parsedChart.drumType).toBe(drumTypes.fourLanePro);

    const files = writeChartFolder(doc);
    const reparsed = readChart(files, {pro_drums: true});
    const track = reparsed.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    expect(track).toBeDefined();

    const notes = getDrumNotes(track!);
    const byTick = new Map(notes.map(n => [n.tick, n]));

    const cymbal = byTick.get(960); // HH at 1.0s @120
    expect(cymbal?.type).toBe('yellowDrum');
    expect(cymbal?.flags.cymbal).toBe(true);

    const tom = byTick.get(1920); // HT at 2.0s
    expect(tom?.type).toBe('yellowDrum');
    expect(tom?.flags.cymbal).not.toBe(true);
  });
});
