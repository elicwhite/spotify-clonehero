import {detectFills, getExpertDrumsTrack} from '../detection/detectFills';
import {
  classifyFill,
  classifyAndDedupe,
  computeDifficultyScore,
} from '../detection/classify';
import {buildFingerprints} from '../detection/grooveModel';
import type {DetectedFill, FillFeatures} from '../detection/types';
import {
  buildChart,
  backbeatBar,
  tomFillBar,
  RES,
  type PlannedNote,
} from './builder';
import {noteFlags} from '@eliwhite/scan-chart';

const BAR = RES * 4;

function songWithFill(fillAtBars: number[]): PlannedNote[] {
  const notes: PlannedNote[] = [];
  let bar = 0;
  const total = Math.max(...fillAtBars) + 3;
  const fillSet = new Set(fillAtBars);
  for (bar = 0; bar < total; bar++) {
    if (fillSet.has(bar)) {
      notes.push(...tomFillBar(bar * BAR));
      notes.push({tick: (bar + 1) * BAR, voices: ['crashGreen']});
    } else {
      notes.push(...backbeatBar(bar * BAR));
    }
  }
  return notes;
}

describe('classifyFill', () => {
  it('classifies a 16th-note one-bar tom fill', () => {
    const chart = buildChart({notes: songWithFill([5])});
    const track = getExpertDrumsTrack(chart)!;
    const fills = detectFills(chart);
    expect(fills.length).toBe(1);

    const c = classifyFill(chart, track, fills[0]);
    expect(c.lengthBars).toBe(1);
    expect(c.subdivision).toBe('16th');
    expect(c.voicingTags).toContain('toms');
    expect(c.voicingTags).toContain('crash-end');
    expect(c.complexity).toBeGreaterThanOrEqual(2);
    expect(c.fingerprint.length).toBeGreaterThan(0);
  });

  it('tags flams and ghosts from raw flags', () => {
    const notes: PlannedNote[] = [];
    for (let b = 0; b < 5; b++) notes.push(...backbeatBar(b * BAR));
    // Fill bar with a flam and a ghost note.
    const sixteenth = RES / 4;
    const toms = ['snare', 'tomYellow', 'tomBlue', 'tomGreen'] as const;
    for (let i = 0; i < 16; i++) {
      const flags = i === 0 ? noteFlags.flam : i === 1 ? noteFlags.ghost : 0;
      notes.push({
        tick: 5 * BAR + i * sixteenth,
        voices: [toms[i % 4]],
        extraFlags: flags,
      });
    }
    notes.push({tick: 6 * BAR, voices: ['crashGreen']});
    notes.push(...backbeatBar(6 * BAR));

    const chart = buildChart({notes});
    const track = getExpertDrumsTrack(chart)!;
    const fills = detectFills(chart);
    expect(fills.length).toBe(1);
    const c = classifyFill(chart, track, fills[0]);
    expect(c.voicingTags).toContain('flams');
    expect(c.voicingTags).toContain('ghosts');
  });

  it('assigns complexity within 1..5', () => {
    const chart = buildChart({notes: songWithFill([5])});
    const track = getExpertDrumsTrack(chart)!;
    const fills = detectFills(chart);
    const c = classifyFill(chart, track, fills[0]);
    expect(c.complexity).toBeGreaterThanOrEqual(1);
    expect(c.complexity).toBeLessThanOrEqual(5);
  });
});

describe('computeDifficultyScore (plan 0045 §6)', () => {
  const EMPTY_FEATURES: FillFeatures = {
    onsetCount: 0,
    notesPerSecond: 0,
    grooveNotesPerSecond: 0,
    densityRatio: 1,
    tomFraction: 0,
    snareFraction: 0,
    kickFraction: 0,
    grooveDissimilarity: 0,
    endsOnCrash: false,
    endsAtSection: false,
    voiceCount: 0,
  };

  /**
   * Score a single hand-built fill bar (notes at `barStart=0`) at `bpm`. The
   * chart is just that one bar; the "fill" spans bar 0.
   */
  function scoreBar(notes: PlannedNote[], bpm: number): number {
    const chart = buildChart({notes, bpm});
    const track = getExpertDrumsTrack(chart)!;
    const fps = buildFingerprints(chart, track);
    const spanFps = fps.filter(fp => fp.startTick >= 0 && fp.endTick <= BAR);
    const subdivision =
      // reuse the real subdivision detection by classifying through it
      classifyFill(chart, track, {
        startTick: 0,
        endTick: BAR,
        grooveStartTick: 0,
        grooveEndTick: 0,
        tempoBpm: bpm,
        confidence: 1,
        features: EMPTY_FEATURES,
      } as DetectedFill).subdivision;
    const fill: DetectedFill = {
      startTick: 0,
      endTick: BAR,
      grooveStartTick: 0,
      grooveEndTick: 0,
      tempoBpm: bpm,
      confidence: 1,
      features: EMPTY_FEATURES,
    };
    return computeDifficultyScore(chart, track, fill, spanFps, subdivision, 1);
  }

  // Hand-built bars of increasing difficulty.
  function quarterSnare(): PlannedNote[] {
    const out: PlannedNote[] = [];
    for (let i = 0; i < 4; i++) out.push({tick: i * RES, voices: ['snare']});
    return out;
  }
  function eighthTomRun(): PlannedNote[] {
    const out: PlannedNote[] = [];
    const toms = ['tomYellow', 'tomBlue'] as const;
    for (let i = 0; i < 8; i++) {
      out.push({tick: i * (RES / 2), voices: [toms[i % 2]]});
    }
    return out;
  }
  function sixteenthTomRun(): PlannedNote[] {
    const out: PlannedNote[] = [];
    const toms = ['snare', 'tomYellow', 'tomBlue', 'tomGreen'] as const;
    for (let i = 0; i < 16; i++) {
      out.push({tick: i * (RES / 4), voices: [toms[Math.floor(i / 4)]]});
    }
    return out;
  }
  function mixedTripletLinear(): PlannedNote[] {
    // 12 triplet onsets across the bar, linear movement K-S-T around the kit,
    // with ghosts + a flam (ornaments) and an off-grid feel.
    const out: PlannedNote[] = [];
    const third = RES / 3; // 8th-note triplet spacing
    const cycle = [
      'kick',
      'snare',
      'tomYellow',
      'kick',
      'tomBlue',
      'snare',
    ] as const;
    for (let i = 0; i < 12; i++) {
      const flags =
        i === 0 ? noteFlags.flam : i % 4 === 1 ? noteFlags.ghost : 0;
      out.push({
        tick: Math.round(i * third),
        voices: [cycle[i % cycle.length]],
        extraFlags: flags,
      });
    }
    return out;
  }

  it('sorts quarter snare < 8th tom < 16th tom < mixed-triplet linear', () => {
    const bpm = 120;
    const q = scoreBar(quarterSnare(), bpm);
    const e = scoreBar(eighthTomRun(), bpm);
    const s = scoreBar(sixteenthTomRun(), bpm);
    const m = scoreBar(mixedTripletLinear(), bpm);
    expect(q).toBeLessThan(e);
    expect(e).toBeLessThan(s);
    expect(s).toBeLessThan(m);
  });

  it('scores the same pattern higher at a higher tempo', () => {
    const slow = scoreBar(sixteenthTomRun(), 90);
    const fast = scoreBar(sixteenthTomRun(), 180);
    expect(fast).toBeGreaterThan(slow);
  });

  it('stays within [0, 100]', () => {
    for (const bpm of [60, 120, 240]) {
      for (const notes of [
        quarterSnare(),
        eighthTomRun(),
        sixteenthTomRun(),
        mixedTripletLinear(),
      ]) {
        const v = scoreBar(notes, bpm);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('classifyAndDedupe', () => {
  it('collapses identical repeated fills and counts repetitions', () => {
    // Same tom fill at bars 5 and 11.
    const chart = buildChart({notes: songWithFill([5, 11])});
    const track = getExpertDrumsTrack(chart)!;
    const fills = detectFills(chart);
    expect(fills.length).toBe(2);

    const classified = classifyAndDedupe(chart, track, fills);
    expect(classified.length).toBe(1);
    expect(classified[0].repetitions).toBe(2);
  });
});
