import {detectFills, getExpertDrumsTrack} from '../detection/detectFills';
import {classifyFill, classifyAndDedupe} from '../detection/classify';
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
