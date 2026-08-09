import {
  CHART_DB_MANIFEST_KEY,
  ChartDbManifest,
  chartDbAssetUrl,
  chartDbDumpKey,
  chartDbVersionFromDate,
  fetchChartDbManifest,
  loadChartDbDump,
  parseChartDbManifest,
} from '../chartDbAssets';
import {
  buildManifest,
  selectVersionsToPrune,
  versionFromDumpKey,
} from '../chartDbPublish';

const manifest: ChartDbManifest = {
  version: '2026-08-09T17-14-53-098Z',
  lastRun: '2026-08-09T17:14:53.098Z',
  totalSongs: 94609,
  key: 'charts/2026-08-09T17-14-53-098Z/charts.json.gz',
  bytes: 8950156,
  sha256: 'abc123',
};

function jsonResponse(body: unknown, ok = true) {
  return {ok, status: ok ? 200 : 500, json: async () => body} as Response;
}

describe('chart DB asset addressing', () => {
  it('derives an immutable dump key from a version', () => {
    expect(chartDbDumpKey('2026-08-09T17-14-53-098Z')).toBe(
      'charts/2026-08-09T17-14-53-098Z/charts.json.gz',
    );
  });

  it('makes versions safe for object keys and chronologically sortable', () => {
    const earlier = chartDbVersionFromDate(
      new Date('2026-08-09T17:14:53.098Z'),
    );
    const later = chartDbVersionFromDate(new Date('2026-08-10T01:00:00.000Z'));

    expect(earlier).toBe('2026-08-09T17-14-53-098Z');
    expect(earlier).not.toContain(':');
    expect(earlier < later).toBe(true);
  });

  it('builds absolute URLs on the assets host', () => {
    expect(chartDbAssetUrl(CHART_DB_MANIFEST_KEY)).toBe(
      'https://assets.musiccharts.tools/charts/manifest.json',
    );
  });

  it('round-trips a built manifest through the parser', () => {
    const built = buildManifest({
      version: manifest.version,
      lastRun: manifest.lastRun,
      totalSongs: manifest.totalSongs,
      bytes: manifest.bytes,
      sha256: manifest.sha256,
    });

    expect(built).toEqual(manifest);
    expect(parseChartDbManifest(built)).toEqual(manifest);
  });

  it.each([
    ['not an object', 'null', null],
    ['a missing key', 'key', {...manifest, key: undefined}],
    ['an unparseable lastRun', 'lastRun', {...manifest, lastRun: 'whenever'}],
  ])('rejects a manifest with %s', (_label, _field, value) => {
    expect(() => parseChartDbManifest(value)).toThrow();
  });
});

describe('fetchChartDbManifest', () => {
  it('bypasses the cache so a publish is seen immediately', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(manifest));

    await fetchChartDbManifest(fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://assets.musiccharts.tools/charts/manifest.json',
      {cache: 'no-cache'},
    );
  });

  it('throws on a non-ok response rather than parsing an error page', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({}, false));

    await expect(
      fetchChartDbManifest(fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('status 500');
  });
});

describe('loadChartDbDump', () => {
  it('pairs the dump and cutoff from a single manifest read', async () => {
    const charts = [{groupId: 1}];
    const fetchImpl = jest.fn(async (url: string) =>
      url.endsWith('manifest.json')
        ? jsonResponse(manifest)
        : jsonResponse(charts),
    );

    const dump = await loadChartDbDump(fetchImpl as unknown as typeof fetch);

    expect(dump).toEqual({charts, lastRun: manifest.lastRun});
    expect(fetchImpl.mock.calls[1][0]).toBe(chartDbAssetUrl(manifest.key));
  });

  it('falls back to the bundled copy when the manifest is unreachable', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.startsWith('https://')) throw new TypeError('offline');
      return jsonResponse(
        url === '/data/charts.json'
          ? [{groupId: 2}]
          : {lastRun: '2026-01-01T00:00:00.000Z'},
      );
    });

    const dump = await loadChartDbDump(fetchImpl as unknown as typeof fetch);

    expect(dump).toEqual({
      charts: [{groupId: 2}],
      lastRun: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('selectVersionsToPrune', () => {
  const keys = (...versions: string[]) => versions.map(chartDbDumpKey);

  it('keeps the newest versions and deletes the rest', () => {
    expect(
      selectVersionsToPrune(keys('v1', 'v2', 'v3', 'v4', 'v5', 'v6'), 'v6', 3),
    ).toEqual(['v1', 'v2', 'v3']);
  });

  it('never deletes the version just published', () => {
    expect(selectVersionsToPrune(keys('v1', 'v2', 'v3'), 'v1', 1)).toEqual([
      'v2',
      'v3',
    ]);
  });

  it('deletes nothing when under the retention count', () => {
    expect(selectVersionsToPrune(keys('v1', 'v2'), 'v2', 5)).toEqual([]);
  });

  it('ignores objects that are not dumps, including the manifest', () => {
    expect(
      selectVersionsToPrune(
        [...keys('v1', 'v2'), CHART_DB_MANIFEST_KEY, 'charts/v3/notes.json'],
        'v2',
        1,
      ),
    ).toEqual(['v1']);
    expect(versionFromDumpKey(CHART_DB_MANIFEST_KEY)).toBeNull();
  });
});
