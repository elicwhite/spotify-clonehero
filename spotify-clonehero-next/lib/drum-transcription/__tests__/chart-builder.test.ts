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
  buildChartDocumentFromExistingChart,
  buildConfidenceData,
  RESOLUTION,
} from '../pipeline/chart-builder';
import {buildTimedTempos, msToTick} from '../timing';
import type {RawDrumEvent} from '../ml/types';
import {
  SYSTEMATIC_ONSET_MS_AUDIO_FLOW,
  SYSTEMATIC_ONSET_MS_CHART_FLOW,
} from '../ml/types';
import type {Synctrack} from '@/lib/tempo-map/types';
import {
  writeChartFolder,
  readChart,
  getDrumNotes,
  createEmptyChart,
  drumTypes,
  noteId,
} from '@/lib/chart-edit';
import {noteTypes, noteFlags} from '@eliwhite/scan-chart';

// `timeSeconds` here is the CHART-INTENDED position (where the note should land).
// This file only exercises buildChartDocument (the audio-flow builder), so the
// pipeline adds SYSTEMATIC_ONSET_MS_AUDIO_FLOW at chart placement to correct the
// CRNN's systematic earliness, so a real model onset arrives that much before its
// chart position. We pre-subtract the offset so these events simulate real model
// onsets and land at the intended `timeSeconds` — keeping every tick assertion
// below exact. A dedicated test ('applies the systematic onset offset') pins the
// offset behavior itself.
function ev(
  timeSeconds: number,
  drumClass: RawDrumEvent['drumClass'],
  confidence = 0.9,
): RawDrumEvent {
  return {
    timeSeconds: timeSeconds - SYSTEMATIC_ONSET_MS_AUDIO_FLOW / 1000,
    drumClass,
    midiPitch: 0,
    confidence,
  };
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
    expect(byTick.get(960)?.type).toBe(noteTypes.kick);
    expect(byTick.get(5120)?.type).toBe(noteTypes.redDrum);
    expect(byTick.get(6080)?.type).toBe(noteTypes.yellowDrum);
    expect(!!((byTick.get(6080)?.flags ?? 0) & noteFlags.cymbal)).toBe(true);

    // Generic consistency: every note tick equals msToTick over the tempo
    // map actually written into the chart — including the systematic onset
    // offset the pipeline applies at placement (chart-builder snapOnsetTick).
    const timed = buildTimedTempos(chart.tempos, RESOLUTION);
    const expected = events
      .map(e =>
        msToTick(
          e.timeSeconds * 1000 + SYSTEMATIC_ONSET_MS_AUDIO_FLOW,
          timed,
          RESOLUTION,
        ),
      )
      .sort((a, b) => a - b);
    expect(notes.map(n => n.tick).sort((a, b) => a - b)).toEqual(expected);
  });

  it('keys confidence data by the same real-tempo-map ticks', () => {
    const conf = buildConfidenceData(events, chart.tempos, RESOLUTION);
    expect(conf.notes).toEqual({
      '960:kick': 0.9,
      '5120:redDrum': 0.8,
      '6080:yellowDrum': 0.7,
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
    expect(notes[0].type).toBe(noteTypes.redDrum);
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
    expect(byKey.has(`360-${noteTypes.redDrum}`)).toBe(true); // 16th (within tolerance)
    expect(byKey.has(`160-${noteTypes.yellowDrum}`)).toBe(true); // triplet (HH cymbal)
    expect(
      !!((byKey.get(`160-${noteTypes.yellowDrum}`)?.flags ?? 0) & noteFlags.cymbal),
    ).toBe(true);
    // The far-off-grid kick abstains: it keeps its raw rounded tick (200),
    // NOT the nearest grid line (240).
    expect(byKey.has(`200-${noteTypes.kick}`)).toBe(true);
    expect(byKey.has(`240-${noteTypes.kick}`)).toBe(false);
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
      '360:redDrum': 0.91,
      '160:yellowDrum': 0.72,
      '200:kick': 0.63, // abstained note: confidence key uses the raw tick too
    });
    // Every confidence key must correspond to a real note's canonical noteId
    // (`${tick}:${type}`) — the key the editor looks up per note.
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    const noteKeys = new Set(notes.map(n => noteId(n)));
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

describe('single grid function keeps chords whole (per-lane carve-out dropped)', () => {
  // Flat 120 BPM: an onset at 0.10s -> frac tick 96; candidate snaps to the
  // nearest of 16th (120) / 16th-triplet (80) -> 80. ALL lanes use candidate,
  // so notes sharing an onset land on the SAME tick — chords never split.
  it('snaps a pitched lane and a cymbal at the same onset to the SAME tick', () => {
    const events = [ev(0.1, 'SD', 0.9), ev(0.1, 'RD', 0.8)];
    const doc = buildChartDocument(events, 'Chord Align', 4, null);
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    const byType = new Map(notes.map(n => [n.type, n]));
    expect(byType.get(noteTypes.redDrum)?.tick).toBe(80); // snare: candidate -> 80
    // Ride: candidate -> 80 too (was uniform 100 under the dropped carve-out),
    // so it stays aligned with the snare in the same chord.
    expect(byType.get(noteTypes.blueDrum)?.tick).toBe(80);
    expect(
      !!((byType.get(noteTypes.blueDrum)?.flags ?? 0) & noteFlags.cymbal),
    ).toBe(true);
  });

  it('candidate-snaps hihat', () => {
    const doc = buildChartDocument([ev(0.1, 'HH', 0.7)], 'Hihat', 4, null);
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    expect(notes).toHaveLength(1);
    expect(notes[0].tick).toBe(80);
    expect(!!(notes[0].flags & noteFlags.cymbal)).toBe(true);
  });

  it('keeps a same-pad tom+cymbal chord as ONE gem (dedup regression guard)', () => {
    // Floor-tom (FT) and crash (CR) both map to greenDrum. Under the dropped
    // per-lane carve-out they snapped to different ticks (candidate 80 vs
    // uniform 100) and rendered as TWO green gems ~21ms apart. With one grid
    // function they share tick 80 and dedup collapses them to a single gem.
    const events = [ev(0.1, 'FT', 0.8), ev(0.1, 'CR', 0.9)];
    const doc = buildChartDocument(events, 'Tom+Cymbal', 4, null);
    const green = getDrumNotes(doc.parsedChart.trackData[0]).filter(
      n => n.type === noteTypes.greenDrum,
    );
    expect(green).toHaveLength(1); // ONE gem, not two split across ticks
    expect(green[0].tick).toBe(80);
    expect(!!(green[0].flags & noteFlags.cymbal)).toBe(true); // crash (higher conf) wins -> cymbal
  });

  it('keys confidence data by the snapped ticks', () => {
    const events = [ev(0.1, 'SD', 0.9), ev(0.1, 'RD', 0.8)];
    const doc = buildChartDocument(events, 'Conf', 4, null);
    const conf = buildConfidenceData(
      events,
      doc.parsedChart.tempos.map(t => ({
        tick: t.tick,
        beatsPerMinute: t.beatsPerMinute,
      })),
      RESOLUTION,
    );
    expect(conf.notes).toEqual({
      '80:redDrum': 0.9,
      '80:blueDrum': 0.8,
    });
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
    expect(notes[0]).toMatchObject({tick: 240, type: noteTypes.redDrum});
  });

  it('keeps the higher-confidence event on a cross-class collision (cymbal wins)', () => {
    // HT (yellow tom) 0.996s and HH (yellow cymbal) 1.004s both snap to 960;
    // HH has the higher confidence -> one yellowDrum with the cymbal flag set.
    const events = [ev(0.996, 'HT', 0.6), ev(1.004, 'HH', 0.9)];
    const doc = buildChartDocument(events, 'Cymbal Wins', 4, null);
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({tick: 960, type: noteTypes.yellowDrum});
    expect(!!(notes[0].flags & noteFlags.cymbal)).toBe(true);
  });

  it('keeps the tom (no cymbal flag) when the tom has higher confidence', () => {
    // Mirror of the above: HT outscores HH -> yellow tom, cymbal flag absent.
    const events = [ev(0.996, 'HT', 0.9), ev(1.004, 'HH', 0.6)];
    const doc = buildChartDocument(events, 'Tom Wins', 4, null);
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({tick: 960, type: noteTypes.yellowDrum});
    expect(!!(notes[0].flags & noteFlags.cymbal)).not.toBe(true);
  });

  it('prefers the cymbal on a confidence tie', () => {
    // HT and HH tie in confidence at the same snapped tick (960) -> cymbal wins.
    const events = [ev(0.996, 'HT', 0.7), ev(1.004, 'HH', 0.7)];
    const doc = buildChartDocument(events, 'Tie Prefers Cymbal', 4, null);
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({tick: 960, type: noteTypes.yellowDrum});
    expect(!!(notes[0].flags & noteFlags.cymbal)).toBe(true);
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
    expect(conf.notes).toEqual({'960:yellowDrum': 0.9});
    // Every confidence key must correspond to a real note's canonical noteId.
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    const noteKeys = new Set(notes.map(n => noteId(n)));
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
    expect(cymbal?.type).toBe(noteTypes.yellowDrum);
    expect(!!((cymbal?.flags ?? 0) & noteFlags.cymbal)).toBe(true);

    const tom = byTick.get(1920); // HT at 2.0s
    expect(tom?.type).toBe(noteTypes.yellowDrum);
    expect(!!((tom?.flags ?? 0) & noteFlags.cymbal)).not.toBe(true);
  });
});

describe('flow-specific systematic onset correction', () => {
  // Flat 120 BPM: 0.96 ticks/ms exactly. The SAME raw (uncorrected) event,
  // fed through each builder, must be corrected by that builder's OWN
  // constant (audio-flow 7ms vs chart-flow 0ms, the t4-basis optima) — not a
  // shared one. At 1041ms raw the two adjusted positions land on opposite
  // sides of the abstain tolerance around the 960/1040 grid pair, so the two
  // flows produce genuinely different tick placements (999 raw-abstained vs
  // 1040 snapped), proving each flow reads its own constant rather than one
  // leaking into the other.
  const rawEvent: RawDrumEvent = {
    timeSeconds: 1.041,
    drumClass: 'BD',
    midiPitch: 0,
    confidence: 0.9,
  };

  it('buildChartDocumentFromExistingChart (chart-flow) applies SYSTEMATIC_ONSET_MS_CHART_FLOW (0ms)', () => {
    const existing = {
      parsedChart: createEmptyChart({
        format: 'chart',
        resolution: RESOLUTION,
        bpm: 120,
        timeSignature: {numerator: 4, denominator: 4},
      }),
      assets: [],
    };
    const doc = buildChartDocumentFromExistingChart(existing, [rawEvent], 4);
    const track = doc.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    expect(track).toBeDefined();
    const notes = getDrumNotes(track!);
    expect(notes).toHaveLength(1);
    // 1041ms + 0ms = 1041ms -> 999.36 ticks; nearest grid line (960) is
    // 41ms of drift away (> the 40ms tolerance) -> abstains at round(999.36).
    expect(notes[0].tick).toBe(999);
  });

  it('buildChartDocument (audio-flow) applies SYSTEMATIC_ONSET_MS_AUDIO_FLOW (7ms)', () => {
    const doc = buildChartDocument([rawEvent], 'AudioFlowOffset', 4, null);
    const notes = getDrumNotes(doc.parsedChart.trackData[0]);
    expect(notes).toHaveLength(1);
    // 1041ms + 7ms = 1048ms -> 1006.08 ticks; nearest grid line (1040) is
    // 35.33ms of drift away (<= the 40ms tolerance) -> snaps to 1040.
    expect(notes[0].tick).toBe(1040);
  });

  it('sanity check: SYSTEMATIC_ONSET_MS_AUDIO_FLOW and _CHART_FLOW are the t4-basis 7/0ms optima', () => {
    expect(SYSTEMATIC_ONSET_MS_AUDIO_FLOW).toBe(7);
    expect(SYSTEMATIC_ONSET_MS_CHART_FLOW).toBe(0);
  });
});
