import fs from 'node:fs';
import path from 'node:path';
import {readChart, writeChartFileAs} from '@/lib/chart-edit';
import {assembleChartFiles} from '@/lib/chart-export';
import type {Track} from '@/lib/preview/highway/types';
import {buildGuitarFeatureContext, featureMatrix} from '../features';
import {mergeGuitarTiersIntoChart} from '../exportChart';
import {
  GUITAR_DIFFICULTIES,
  snapshotToChartText,
  type GuitarReductionSnapshot,
} from '../snapshot';

const snapshotPath = path.join(
  process.cwd(),
  'public/data/guitar-difficulties/guitar-reduction-e101baa.json',
);

function sourceChartDoc() {
  const snapshot = JSON.parse(
    fs.readFileSync(snapshotPath, 'utf8'),
  ) as GuitarReductionSnapshot;
  return readChart([
    {
      fileName: 'notes.chart',
      data: new TextEncoder().encode(snapshotToChartText(snapshot)),
    },
  ]);
}

function fixtureTracks(expert: Track) {
  return Object.fromEntries(
    GUITAR_DIFFICULTIES.map(difficulty => [
      difficulty,
      difficulty === 'expert'
        ? expert
        : {
            ...expert,
            difficulty,
            noteEventGroups: expert.noteEventGroups.map(group =>
              group.map(note => ({...note})),
            ),
          },
    ]),
  ) as Record<(typeof GUITAR_DIFFICULTIES)[number], Track>;
}

describe('live guitar reduction feature contract and export', () => {
  it('builds the documented 40/60/96-column feature tensors', () => {
    const chartDoc = sourceChartDoc();
    const expert = chartDoc.parsedChart.trackData.find(
      track => track.instrument === 'guitar' && track.difficulty === 'expert',
    );
    expect(expert).toBeDefined();

    const context = buildGuitarFeatureContext(chartDoc.parsedChart, expert!);

    expect(context.baseFeatures[0]).toHaveLength(40);
    expect(context.sectionFeatures[0]).toHaveLength(40);
    expect(featureMatrix(context, 'hard')).toHaveLength(
      context.ticks.length * 60,
    );
    expect(featureMatrix(context, 'medium')).toHaveLength(
      context.ticks.length * 60,
    );
    expect(featureMatrix(context, 'easy')).toHaveLength(
      context.ticks.length * 96,
    );
  });

  it('writes generated guitar tiers in the source chart format', () => {
    const chartDoc = sourceChartDoc();
    const expert = chartDoc.parsedChart.trackData.find(
      track => track.instrument === 'guitar' && track.difficulty === 'expert',
    );
    const merged = mergeGuitarTiersIntoChart(chartDoc, fixtureTracks(expert!));
    const chartFiles = assembleChartFiles({chartDoc: merged});
    const chartFile = chartFiles.find(file => file.fileName === 'notes.chart');

    expect(chartFile).toBeDefined();
    expect(
      readChart(chartFiles).parsedChart.trackData.filter(
        track => track.instrument === 'guitar',
      ),
    ).toHaveLength(4);

    const midFile = writeChartFileAs(chartDoc, 'mid');
    const midDoc = readChart([midFile]);
    const midExpert = midDoc.parsedChart.trackData.find(
      track => track.instrument === 'guitar' && track.difficulty === 'expert',
    );
    const midFiles = assembleChartFiles({
      chartDoc: mergeGuitarTiersIntoChart(midDoc, fixtureTracks(midExpert!)),
    });

    expect(midFiles.some(file => file.fileName === 'notes.mid')).toBe(true);
    expect(
      readChart(midFiles).parsedChart.trackData.filter(
        track => track.instrument === 'guitar',
      ),
    ).toHaveLength(4);
  });
});
