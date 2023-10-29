import {selectChart, ChartResponse} from '@/app/chartSelection';
import batcountry from './__fixtures__/batcountry.json';

function createChartFixture(vals: Object) {
  return {
    name: 'name',
    artist: 'artist',
    charter: 'charter',
    diff_drums: 4,
    diff_guitar: 4,
    uploadedAt: '2023-07-29T12:28:08.000Z',
    lastModified: '2023-07-30T12:28:08.000Z',
    link: 'url',
    ...vals,
  };
}

test('select Harmonix over Neversoft', () => {
  const selectedChart = selectChart([
    createChartFixture({
      charter: 'Harmonix',
    }),
    createChartFixture({
      charter: 'Neversoft',
    }),
    createChartFixture({
      charter: 'Friend',
    }),
  ]);
  expect(selectedChart.charter).toBe('Harmonix');
});

test('select Harmonix over rando', () => {
  const selectedChart = selectChart([
    createChartFixture({
      charter: 'rando',
    }),
    createChartFixture({
      charter: 'Harmonix',
    }),
    createChartFixture({
      charter: 'Friend',
    }),
  ]);
  expect(selectedChart.charter).toBe('Harmonix');
});

test('select Neversoft over rando', () => {
  const selectedChart = selectChart([
    createChartFixture({
      charter: 'rando',
    }),
    createChartFixture({
      charter: 'Neversoft',
    }),
  ]);
  expect(selectedChart.charter).toBe('Neversoft');
});

test('select drums over no drums when first', () => {
  const selectedChart = selectChart([
    createChartFixture({
      charter: 'good',
      diff_drums: 8,
    }),
    createChartFixture({
      charter: 'bad',
      diff_drums: null,
    }),
  ]);
  expect(selectedChart.charter).toBe('good');
});

test('select drums over no drums when second', () => {
  const selectedChart = selectChart([
    createChartFixture({
      charter: 'bad',
      diff_drums: null,
    }),
    createChartFixture({
      charter: 'good',
      diff_drums: 8,
    }),
  ]);
  expect(selectedChart.charter).toBe('good');
});

test('select more recent chart when both are from the same charter', () => {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const selectedChart = selectChart([
    createChartFixture({
      charter: 'good',
      diff_drums: 8,
      uploadedAt: yesterday,
      link: '1',
    }),
    createChartFixture({
      charter: 'good',
      diff_drums: 8,
      uploadedAt: today,
      link: '2',
    }),
  ]);
  expect(selectedChart.link).toBe('2');
});
