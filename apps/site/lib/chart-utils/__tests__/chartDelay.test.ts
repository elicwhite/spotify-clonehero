import {parseChartFile} from '@eliwhite/scan-chart';
import {readChart} from '@/lib/chart-edit';
import {applyIniDelay, getChartDelayMs} from '../chartDelay';

describe('getChartDelayMs', () => {
  it('returns 0 when metadata is undefined', () => {
    expect(getChartDelayMs(undefined)).toBe(0);
  });

  it('returns 0 when metadata has no delay or chart_offset', () => {
    expect(getChartDelayMs({})).toBe(0);
  });

  it('returns positive delay in ms', () => {
    expect(getChartDelayMs({delay: 2000})).toBe(2000);
  });

  it('returns negative delay in ms', () => {
    expect(getChartDelayMs({delay: -500})).toBe(-500);
  });

  it('falls back to chart_offset, which is already in ms', () => {
    expect(getChartDelayMs({chart_offset: 1500})).toBe(1500);
  });

  it('falls back to negative chart_offset', () => {
    expect(getChartDelayMs({chart_offset: -500})).toBe(-500);
  });

  it('delay takes precedence over chart_offset', () => {
    expect(getChartDelayMs({delay: 3000, chart_offset: 1000})).toBe(3000);
  });

  it('uses chart_offset when delay is 0', () => {
    expect(getChartDelayMs({delay: 0, chart_offset: 2000})).toBe(2000);
  });

  it('returns 0 when delay is 0 and chart_offset is undefined', () => {
    expect(getChartDelayMs({delay: 0})).toBe(0);
  });

  it('returns 0 when chart_offset is 0', () => {
    expect(getChartDelayMs({chart_offset: 0})).toBe(0);
  });

  it('reads a .chart [Song] Offset in seconds as ms', () => {
    const chart = [
      '[Song]',
      '{',
      '  Resolution = 192',
      '  Offset = -2',
      '}',
      '[SyncTrack]',
      '{',
      '  0 = TS 4',
      '  0 = B 120000',
      '}',
      '[ExpertSingle]',
      '{',
      '  0 = N 0 0',
      '}',
    ].join('\n');
    const doc = readChart([
      {fileName: 'notes.chart', data: new TextEncoder().encode(chart)},
    ]);

    expect(getChartDelayMs(doc.parsedChart.metadata)).toBe(-2000);
  });
});

describe('applyIniDelay', () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  const chartBytes = encode(
    [
      '[Song]',
      '{',
      '  Resolution = 192',
      '  Offset = -2',
      '}',
      '[SyncTrack]',
      '{',
      '  0 = TS 4',
      '  0 = B 120000',
      '}',
      '[ExpertSingle]',
      '{',
      '  0 = N 0 0',
      '}',
    ].join('\n'),
  );
  const modifiers = {
    song_length: 0,
    hopo_frequency: 0,
    eighthnote_hopo: false,
    multiplier_note: 0,
    sustain_cutoff_threshold: -1,
    chord_snap_threshold: 0,
    five_lane_drums: false,
    pro_drums: false,
  };
  const folder = (ini: string | null) => [
    {fileName: 'notes.chart', data: chartBytes},
    ...(ini === null ? [] : [{fileName: 'song.ini', data: encode(ini)}]),
  ];
  /** The delay a page gets from `parseChartFile` plus the folder's song.ini. */
  const pageDelayMs = (ini: string | null) =>
    getChartDelayMs(
      applyIniDelay(parseChartFile(chartBytes, 'chart', modifiers), folder(ini))
        .metadata,
    );

  it('applies the song.ini delay that parseChartFile cannot see', () => {
    expect(pageDelayMs('[song]\nname = T\ndelay = 300\n')).toBe(300);
  });

  it('matches the delay the chart editor reads from the same files', () => {
    const ini = '[song]\nname = T\ndelay = 300\n';
    const editorMs = getChartDelayMs(
      readChart(folder(ini)).parsedChart.metadata,
    );

    expect(pageDelayMs(ini)).toBe(editorMs);
  });

  it('keeps the .chart Offset when song.ini has no delay', () => {
    expect(pageDelayMs('[song]\nname = T\n')).toBe(-2000);
    expect(pageDelayMs(null)).toBe(-2000);
  });

  it('falls back to the .chart Offset when song.ini delay is 0', () => {
    expect(pageDelayMs('[song]\nname = T\ndelay = 0\n')).toBe(-2000);
  });
});
