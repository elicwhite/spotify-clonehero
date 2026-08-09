import fetchNewCharts from '../fetchNewCharts';

const mockFetchAdvanced = jest.fn();

jest.mock('../../search-encore', () => ({
  fetchAdvanced: (...args: unknown[]) => mockFetchAdvanced(...args),
}));

type TestChart = {
  chartId: number;
  groupId: number;
  name: string;
  modifiedTime: string;
};

function chart(overrides: Partial<TestChart> & {chartId: number}): TestChart {
  return {
    groupId: overrides.chartId,
    name: `song-${overrides.chartId}`,
    modifiedTime: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function okResponse(data: TestChart[], found = data.length) {
  return {
    ok: true,
    status: 200,
    json: async () => ({found, data}),
  };
}

function respondWith(pages: TestChart[][]) {
  for (const page of pages) {
    mockFetchAdvanced.mockResolvedValueOnce(okResponse(page));
  }
  mockFetchAdvanced.mockResolvedValue(okResponse([]));
}

beforeEach(() => {
  mockFetchAdvanced.mockReset();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('fetchNewCharts', () => {
  it('pages until the API stops returning charts', async () => {
    respondWith([
      [chart({chartId: 1}), chart({chartId: 2})],
      [chart({chartId: 3})],
    ]);

    const {charts} = await fetchNewCharts(new Date(0), 1, () => {});

    expect(charts.map(c => c.name)).toEqual(['song-1', 'song-2', 'song-3']);
    expect(mockFetchAdvanced).toHaveBeenCalledTimes(3);
    expect(mockFetchAdvanced.mock.calls[1][0]).toMatchObject({chartIdAfter: 2});
    expect(mockFetchAdvanced.mock.calls[2][0]).toMatchObject({chartIdAfter: 3});
  });

  it('keeps paging when a page only contains updates to known songs', async () => {
    respondWith([
      [
        chart({
          chartId: 10,
          groupId: 7,
          modifiedTime: '2026-01-01T00:00:00.000Z',
        }),
      ],
      // Same song, newer upload: no new songs, but there is another page after.
      [
        chart({
          chartId: 20,
          groupId: 7,
          modifiedTime: '2026-02-01T00:00:00.000Z',
        }),
      ],
      [chart({chartId: 30, groupId: 8})],
    ]);

    const {charts} = await fetchNewCharts(new Date(0), 1, () => {});

    expect(charts).toHaveLength(2);
    expect(charts.find(c => c.groupId === 7).modifiedTime).toBe(
      '2026-02-01T00:00:00.000Z',
    );
  });

  it('stops instead of looping when the chart id cursor stops advancing', async () => {
    mockFetchAdvanced.mockResolvedValue(
      okResponse([chart({chartId: 5, groupId: 5})]),
    );

    await fetchNewCharts(new Date(0), 5, () => {});

    expect(mockFetchAdvanced).toHaveBeenCalledTimes(1);
  });

  it('reports the highest chart id covered by each response', async () => {
    respondWith([
      [chart({chartId: 4}), chart({chartId: 9})],
      [chart({chartId: 11})],
    ]);

    const seen: number[] = [];
    await fetchNewCharts(new Date(0), 1, (_json, stats) => {
      seen.push(stats.lastChartId);
    });

    expect(seen).toEqual([9, 11, 11]);
  });

  it('merges seeded charts from an interrupted run into the result', async () => {
    respondWith([[chart({chartId: 5, groupId: 5})]]);

    const {charts, metadata} = await fetchNewCharts(new Date(0), 4, () => {}, {
      seedCharts: [
        {groupId: 1, name: 'song-1', modifiedTime: '2026-01-01T00:00:00.000Z'},
        {groupId: 2, name: 'song-2', modifiedTime: '2026-01-01T00:00:00.000Z'},
      ],
    });

    expect(charts.map(c => c.groupId).sort()).toEqual([1, 2, 5]);
    expect(metadata.totalSongs).toBe(3);
    expect(mockFetchAdvanced.mock.calls[0][0]).toMatchObject({chartIdAfter: 4});
  });

  it('lets a seeded chart be replaced by a newer upload of the same song', async () => {
    respondWith([
      [
        chart({
          chartId: 5,
          groupId: 1,
          modifiedTime: '2026-03-01T00:00:00.000Z',
        }),
      ],
    ]);

    const {charts, metadata} = await fetchNewCharts(new Date(0), 4, () => {}, {
      seedCharts: [
        {groupId: 1, name: 'stale', modifiedTime: '2026-01-01T00:00:00.000Z'},
      ],
    });

    expect(charts).toHaveLength(1);
    expect(charts[0].name).toBe('song-5');
    // The song was already counted by the interrupted run.
    expect(metadata.totalSongs).toBe(1);
  });

  it('keeps the original run start time when resuming', async () => {
    respondWith([[]]);

    const {metadata} = await fetchNewCharts(new Date(0), 1, () => {}, {
      runStartTime: new Date('2026-05-05T00:00:00.000Z'),
    });

    expect(metadata.lastRun).toBe('2026-05-05T00:00:00.000Z');
  });

  it('throws when the API answers with a client error', async () => {
    mockFetchAdvanced.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
    });

    await expect(fetchNewCharts(new Date(0), 1, () => {})).rejects.toThrow(
      'status 400',
    );
  });
});
