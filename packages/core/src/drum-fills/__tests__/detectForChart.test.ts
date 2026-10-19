import {
  detectFillsForChart,
  computeChartHash,
  mapSubdivision,
} from '../scan/detectForChart';
import {
  buildChart,
  backbeatBar,
  tomFillBar,
  RES,
  type PlannedNote,
} from './builder';

const BAR = RES * 4;

function songWithFill(): PlannedNote[] {
  const notes: PlannedNote[] = [];
  for (let b = 0; b < 4; b++) notes.push(...backbeatBar(b * BAR));
  notes.push(...tomFillBar(4 * BAR));
  for (let b = 0; b < 2; b++) notes.push(...backbeatBar((5 + b) * BAR));
  notes.push({tick: 5 * BAR, voices: ['crashGreen', 'kick']});
  return notes;
}

const META = {
  libraryPath: 'Songs/Artist - Title',
  song: 'Title',
  artist: 'Artist',
  charter: 'Charter',
};

describe('mapSubdivision', () => {
  it('maps engine subdivisions onto the DB vocabulary', () => {
    expect(mapSubdivision('8th')).toBe('8ths');
    expect(mapSubdivision('16th')).toBe('16ths');
    expect(mapSubdivision('triplet')).toBe('triplets');
    expect(mapSubdivision('mixed')).toBe('mixed');
  });
});

describe('computeChartHash', () => {
  it('is deterministic for the same chart', () => {
    const chart = buildChart({notes: songWithFill()});
    expect(computeChartHash(chart)).toBe(computeChartHash(chart));
  });

  it('differs for different drum content', () => {
    const a = buildChart({notes: songWithFill()});
    const b = buildChart({
      notes: [...backbeatBar(0), ...backbeatBar(BAR)],
    });
    expect(computeChartHash(a)).not.toBe(computeChartHash(b));
  });
});

describe('detectFillsForChart', () => {
  it('returns persistable, classified fill records', () => {
    const chart = buildChart({notes: songWithFill()});
    const fills = detectFillsForChart(chart, META);

    expect(fills.length).toBeGreaterThanOrEqual(1);
    const fill = fills[0];
    expect(fill.song).toBe('Title');
    expect(fill.artist).toBe('Artist');
    expect(fill.libraryPath).toBe('Songs/Artist - Title');
    expect(fill.startTick).toBe(4 * BAR);
    expect(['8ths', '16ths', 'triplets', 'mixed']).toContain(fill.subdivision);
    expect(fill.complexity).toBeGreaterThanOrEqual(1);
    expect(fill.complexity).toBeLessThanOrEqual(5);
    expect(Array.isArray(fill.voicingTags)).toBe(true);
    expect(fill.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('embeds the chart hash in the fill id and uses the supplied chartHash', () => {
    const chart = buildChart({notes: songWithFill()});
    const fills = detectFillsForChart(chart, {...META, chartHash: 'HASH123'});
    expect(fills.length).toBeGreaterThanOrEqual(1);
    for (const f of fills) {
      expect(f.chartHash).toBe('HASH123');
      expect(f.id.startsWith('HASH123:')).toBe(true);
    }
  });

  it('produces stable ids across repeated detection of the same chart', () => {
    const chart = buildChart({notes: songWithFill()});
    const a = detectFillsForChart(chart, META).map(f => f.id);
    const b = detectFillsForChart(chart, META).map(f => f.id);
    expect(a).toEqual(b);
  });

  it('returns [] when there is no Expert drums track', () => {
    const chart = buildChart({notes: [], hasDrums: false});
    expect(detectFillsForChart(chart, META)).toEqual([]);
  });

  it('returns [] for a pure groove with no fills', () => {
    const notes: PlannedNote[] = [];
    for (let b = 0; b < 8; b++) notes.push(...backbeatBar(b * BAR));
    const chart = buildChart({notes});
    expect(detectFillsForChart(chart, META)).toEqual([]);
  });
});
