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

  const {chart, reasons} = selectChart([
    createChartFixture({
      charter: 'good',
      diff_drums: 8,
      uploadedAt: today,
      link: '2',
    }),
    createChartFixture({
      charter: 'good',
      diff_drums: 8,
      uploadedAt: yesterday,
      link: '1',
    }),
  ]);
  expect(chart!.link).toBe('2');
  expect(reasons).toEqual([]);
});

test('select more recent chart when both are from the same charter second', () => {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const {chart, reasons} = selectChart([
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
  expect(chart!.link).toBe('2');
  expect(reasons).toEqual(['Chart from same charter is newer']);
});

test('select the first chart if the charts are the same', () => {
  // As an implementation detail of chart comparison, we need the first one to be stable

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const chart1 = createChartFixture({
    charter: 'good',
    diff_drums: 8,
    uploadedAt: yesterday,
  });

  const chart2 = createChartFixture({
    charter: 'good',
    diff_drums: 8,
    uploadedAt: yesterday,
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
    uploadedAt: yesterday,
  });

  const chart2 = createChartFixture({
    charter: 'b',
    diff_drums: 8,
    uploadedAt: yesterday,
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
    uploadedAt: yesterday,
  });

  const chart2 = createChartFixture({
    charter: 'b',
    diff_drums: 8,
    diff_bass: 2,
    uploadedAt: yesterday,
  });

  const {chart, reasons} = selectChart([chart1, chart2]);
  expect(chart!.charter).toBe('b');
  expect(reasons).toEqual(['Better chart has more instruments or difficulty']);
});

test('fixture data', () => {
  // As an implementation detail of chart comparison, we need the first one to be stable

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const chart1 = createChartFixture({
    delay: 0,
    multiplier_note: 116,
    artist: 'A Day to Remember',
    name: 'All Signs Point to Lauderdale',
    album: 'What Separates Me from You',
    track: 7,
    album_track: 7,
    year: 2010,
    genre: 'Rock',
    pro_drums: true,
    kit_type: 1,
    diff_drums: 4,
    diff_drums_real: 4,
    diff_bass: 2,
    diff_bass_real: -1,
    diff_bass_real_22: -1,
    diff_rhythm: -1,
    diff_guitar: 3,
    diff_guitar_real: -1,
    diff_guitar_real_22: -1,
    diff_keys: 0,
    diff_keys_real: 1,
    diff_guitar_coop: -1,
    diff_vocals: 3,
    diff_vocals_harm: 3,
    diff_band: 3,
    preview_start_time: 55000,
    song_length: 197500,
    icon: 'rbn',
    charter: 'RhythmAuthors',
    uploadedAt: new Date(1641475207000),
  });

  const chart2 = createChartFixture({
    name: 'All Signs Point to Lauderdale',
    artist: 'A Day to Remember',
    album: 'What Separates Me from You',
    genre: 'Metal',
    year: '2010',
    md5: '2528523d47dfc01e65a62b1d91168ca7',
    charter: 'Hoph2o',
    song_length: 201400,
    diff_band: 3,
    diff_guitar: -1,
    diff_guitar_coop: -1,
    diff_rhythm: -1,
    diff_bass: -1,
    diff_drums: 3,
    diff_drums_real: 3,
    diff_keys: -1,
    diff_guitarghl: -1,
    diff_guitar_coop_ghl: -1,
    diff_rhythm_ghl: -1,
    diff_bassghl: -1,
    diff_vocals: -1,
    five_lane_drums: false,
    pro_drums: true,
    hasVideoBackground: false,
    uploadedAt: new Date(1700151425999),
    file: 'https://files.enchor.us/2a5f115ac95699f616a535560c73b3c9.sng',
  });

  const {chart, reasons} = selectChart([chart1, chart2]);
  expect(chart).toBe(chart1);
  expect(reasons).toEqual([]);
});
