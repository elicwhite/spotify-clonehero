import fs from 'node:fs';
import path from 'node:path';
import {readChart} from '@/lib/chart-edit';
import {buildGuitarFeatureContext, featureMatrix} from '../features';
import {snapshotToChartText, type GuitarReductionSnapshot} from '../snapshot';

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

describe('live guitar reduction feature contract', () => {
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
});
