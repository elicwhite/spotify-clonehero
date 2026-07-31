import fs from 'node:fs';
import path from 'node:path';
import {
  GUITAR_DIFFICULTIES,
  parseGuitarReductionSnapshot,
  snapshotToChartText,
  type GuitarReductionSnapshot,
} from '../snapshot';

const fixturePath = path.join(
  process.cwd(),
  'public/data/guitar-difficulties/guitar-reduction-e101baa.json',
);

function loadFixture(): GuitarReductionSnapshot {
  return JSON.parse(
    fs.readFileSync(fixturePath, 'utf8'),
  ) as GuitarReductionSnapshot;
}

describe('guitar reduction frozen snapshot', () => {
  it('keeps the promoted provenance and all four tiers explicit', () => {
    const snapshot = loadFixture();

    expect(snapshot.snapshotId).toBe('guitar-reduction-e101baa');
    expect(snapshot.model.sourceCommit).toBe('e101baa');
    expect(snapshot.model.featureVariant).toBe('neighbor_priority_easy_v1');
    expect(snapshot.model.maskDecoder).toBe('expected_edit');
    expect(snapshot.validation.seeds.map(seed => seed.seed)).toEqual([
      1729, 2718,
    ]);
    expect(Object.keys(snapshot.tiers)).toEqual(GUITAR_DIFFICULTIES);
  });

  it('round-trips the fixture through scan-chart into renderable guitar tracks', () => {
    const snapshot = loadFixture();
    const parsed = parseGuitarReductionSnapshot(snapshot);

    expect(parsed.chart.resolution).toBe(snapshot.song.resolution);
    expect(
      parsed.chart.trackData.filter(t => t.instrument === 'guitar'),
    ).toHaveLength(4);
    for (const difficulty of GUITAR_DIFFICULTIES) {
      expect(parsed.tracks[difficulty].noteEventGroups.length).toBeGreaterThan(
        0,
      );
      expect(parsed.tracks[difficulty].instrument).toBe('guitar');
      expect(parsed.tracks[difficulty].difficulty).toBe(difficulty);
    }
    expect(snapshotToChartText(snapshot)).toContain('[ExpertSingle]');
  });
});
