import {selectChart, ChartInfo} from '../';

function createChartFixture<T extends Partial<ChartInfo>>(vals: T): ChartInfo {
  return {
    name: 'name',
    artist: 'artist',
    charter: 'charter',
    diff_drums: 4,
    diff_guitar: 4,
    modifiedTime: '2023-07-29T12:28:08.000Z',
    file: 'url',
    ...vals,
  };
}

test('select Harmonix over Neversoft', () => {
  const {chart, reasons} = selectChart([
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
  expect(chart!.charter).toBe('Harmonix');
  expect(reasons).toEqual([]);
});

test('select Harmonix over Neversoft 2nd', () => {
  const {chart, reasons} = selectChart([
    createChartFixture({
      charter: 'Neversoft',
    }),
    createChartFixture({
      charter: 'Harmonix',
    }),
    createChartFixture({
      charter: 'Friend',
    }),
  ]);
  expect(chart!.charter).toBe('Harmonix');
  expect(reasons).toEqual(['Better chart is from Harmonix']);
});

test('select Harmonix over rando', () => {
  const {chart, reasons} = selectChart([
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
  expect(chart!.charter).toBe('Harmonix');
  expect(reasons).toEqual([
    'Better chart is from Harmonix',
    'Better chart is from official game',
  ]);
});

test('select Neversoft over rando', () => {
  const {chart, reasons} = selectChart([
    createChartFixture({
      charter: 'rando',
    }),
    createChartFixture({
      charter: 'Neversoft',
    }),
  ]);
  expect(chart!.charter).toBe('Neversoft');
  expect(reasons).toEqual(['Better chart is from official game']);
});

test('select Harmonix over chart with more instruments', () => {
  const {chart, reasons} = selectChart([
    createChartFixture({
      charter: 'rando',
    }),
    createChartFixture({
      charter: 'Harmonix',
    }),
    createChartFixture({
      charter: 'Friend',
      diff_bass: 4,
      diff_keys: 4,
    }),
  ]);
  expect(chart!.charter).toBe('Harmonix');
  expect(reasons).toEqual([
    'Better chart is from Harmonix',
    'Better chart is from official game',
  ]);
});

test('select drums over no drums when first', () => {
  const {chart, reasons} = selectChart([
    createChartFixture({
      charter: 'good',
      diff_drums: 8,
    }),
    createChartFixture({
      charter: 'bad',
      diff_drums: null,
    }),
  ]);
  expect(chart!.charter).toBe('good');
  expect(reasons).toEqual([]);
});

test('select drums over no drums when first', () => {
  const {chart, reasons} = selectChart([
    createChartFixture({
      charter: 'good',
      diff_drums: 8,
    }),
    createChartFixture({
      charter: 'bad',
      diff_drums: -1,
    }),
  ]);
  expect(chart!.charter).toBe('good');
  expect(reasons).toEqual([]);
});

test('select drums over no drums when second', () => {
  const {chart, reasons} = selectChart([
    createChartFixture({
      charter: 'bad',
      diff_drums: null,
    }),
    createChartFixture({
      charter: 'good',
      diff_drums: 8,
    }),
  ]);
  expect(chart!.charter).toBe('good');
  expect(reasons).toEqual(["Better chart has drums, current chart doesn't"]);
});

test('select drums over no drums when second', () => {
  const {chart, reasons} = selectChart([
    createChartFixture({
      charter: 'bad',
      diff_drums: -1,
    }),
    createChartFixture({
      charter: 'good',
      diff_drums: 8,
    }),
  ]);
  expect(chart!.charter).toBe('good');
  expect(reasons).toEqual(["Better chart has drums, current chart doesn't"]);
});

test('select just drums over just guitar first', () => {
  const {chart, reasons} = selectChart([
    createChartFixture({
      charter: 'drums',
      diff_drums: 3,
      diff_guitar: -1,
    }),
    createChartFixture({
      charter: 'guitar',
      diff_drums: -1,
      diff_guitar: 3,
    }),
  ]);
  expect(chart!.charter).toBe('drums');
  expect(reasons).toEqual([]);
});

test('select just drums over just guitar first', () => {
  const {chart, reasons} = selectChart([
    createChartFixture({
      charter: 'guitar',
      diff_drums: -1,
      diff_guitar: 3,
    }),
    createChartFixture({
      charter: 'drums',
      diff_drums: 3,
      diff_guitar: -1,
    }),
  ]);
  expect(chart!.charter).toBe('drums');
  expect(reasons).toEqual(["Better chart has drums, current chart doesn't"]);
});

test('select more recent chart when both are from the same charter first', () => {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const chart1 = createChartFixture({
    charter: 'good',
    diff_drums: 8,
    modifiedTime: today.toISOString(),
    link: '2',
  });

  const chart2 = createChartFixture({
    charter: 'good',
    diff_drums: 8,
    modifiedTime: yesterday.toISOString(),
    link: '1',
  });
  const {chart, reasons} = selectChart([chart1, chart2]);
  expect(chart).toBe(chart1);
  expect(reasons).toEqual([]);
});

test('select more recent chart when both are from the same charter second', () => {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const chart1 = createChartFixture({
    charter: 'good',
    diff_drums: 8,
    modifiedTime: yesterday.toISOString(),
  });

  const chart2 = createChartFixture({
    charter: 'good',
    diff_drums: 8,
    modifiedTime: today.toISOString(),
  });

  const {chart, reasons} = selectChart([chart1, chart2]);
  expect(chart).toBe(chart2);
  expect(reasons).toEqual(['Chart from same charter is newer']);
});

test('select the first chart if the charts are the same', () => {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const chart1 = createChartFixture({
    charter: 'good',
    diff_drums: 8,
    modifiedTime: yesterday.toISOString(),
  });

  const chart2 = createChartFixture({
    charter: 'good',
    diff_drums: 8,
    modifiedTime: yesterday.toISOString(),
  });

  const {chart, reasons} = selectChart([chart1, chart2]);
  expect(chart).toBe(chart1);
  expect(reasons).toEqual([]);
});

test('select the first chart with more instruments if all else equal', () => {
  // As an implementation detail of chart comparison, we need the first one to be stable

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const chart1 = createChartFixture({
    charter: 'a',
    diff_drums: 8,
    diff_bass: 2,
    modifiedTime: yesterday.toISOString(),
  });

  const chart2 = createChartFixture({
    charter: 'b',
    diff_drums: 8,
    modifiedTime: yesterday.toISOString(),
  });

  const {chart, reasons} = selectChart([chart1, chart2]);
  expect(chart!.charter).toBe('a');
  expect(reasons).toEqual([]);
});

test('select the second chart with more instruments if all else equal', () => {
  // As an implementation detail of chart comparison, we need the first one to be stable

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const chart1 = createChartFixture({
    charter: 'a',
    diff_drums: 8,
    modifiedTime: yesterday.toISOString(),
  });

  const chart2 = createChartFixture({
    charter: 'b',
    diff_drums: 8,
    diff_bass: 2,
    modifiedTime: yesterday.toISOString(),
  });

  const {chart, reasons} = selectChart([chart1, chart2]);
  expect(chart!.charter).toBe('b');
  expect(reasons).toEqual(['Better chart has more instruments or difficulty']);
});

test('return first chart if only one chart', () => {
  const today = new Date();

  const chart1 = createChartFixture({
    charter: 'a',
    diff_drums: 8,
    modifiedTime: today.toISOString(),
  });

  const {chart, reasons} = selectChart([chart1]);
  expect(chart).toBe(chart1);
  expect(reasons).toEqual([]);
});

test('do not pick a newer chart from within a second', () => {
  const today = new Date();
  const todayLessThanASecond = new Date(today);
  todayLessThanASecond.setUTCMilliseconds(today.getUTCMilliseconds() + 999);

  const chart1 = createChartFixture({
    modifiedTime: today.toISOString(),
  });

  const chart2 = createChartFixture({
    modifiedTime: todayLessThanASecond.toISOString(),
  });

  const {chart, reasons} = selectChart([chart1, chart2]);
  expect(chart).toBe(chart1);
  expect(reasons).toEqual([]);
});

test('pick a newer chart over a second', () => {
  const today = new Date();
  const todayLessThanASecond = new Date(today);
  todayLessThanASecond.setUTCMilliseconds(today.getUTCMilliseconds() + 1001);

  const chart1 = createChartFixture({
    modifiedTime: today.toISOString(),
  });

  const chart2 = createChartFixture({
    modifiedTime: todayLessThanASecond.toISOString(),
  });

  const {chart, reasons} = selectChart([chart1, chart2]);
  expect(chart).toBe(chart2);
  expect(reasons).toEqual(['Chart from same charter is newer']);
});
