import {
  CHART_DB_DUMP_PREFIX,
  CHART_DB_MANIFEST_URL_PATH,
  ChartDbManifest,
  chartDbAssetUrl,
  chartDbDumpKey,
  chartDbVersionFromDate,
  fetchChartDbManifest,
  loadChartDbDump,
  parseChartDbManifest,
} from '../chartDbAssets';
import {buildManifest} from '../chartDbPublish';

const manifest: ChartDbManifest = {
  version: '2026-08-09T17-14-53-098Z',
  lastRun: '2026-08-09T17:14:53.098Z',
  totalSongs: 94609,
  key: 'charts/dumps/2026-08-09T17-14-53-098Z/charts.json.gz',
  bytes: 8950156,
  sha256: 'abc123',
};

function jsonResponse(body: unknown, ok = true) {
  return {ok, status: ok ? 200 : 500, json: async () => body} as Response;
}

describe('chart DB asset addressing', () => {
  it('derives an immutable dump key from a version', () => {
    expect(chartDbDumpKey('2026-08-09T17-14-53-098Z')).toBe(
      'charts/dumps/2026-08-09T17-14-53-098Z/charts.json.gz',
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

  it('serves the manifest from the Next.js app, not from R2', () => {
    expect(CHART_DB_MANIFEST_URL_PATH).toBe('/data/manifest.json');
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

    expect(fetchImpl).toHaveBeenCalledWith('/data/manifest.json', {
      cache: 'no-cache',
    });
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
      url.endsWith('/data/manifest.json')
        ? jsonResponse(manifest)
        : jsonResponse(charts),
    );

    const dump = await loadChartDbDump(fetchImpl as unknown as typeof fetch);

    expect(dump).toEqual({charts, lastRun: manifest.lastRun});
    expect(fetchImpl.mock.calls[1][0]).toBe(chartDbAssetUrl(manifest.key));
  });

  it('propagates a failure rather than seeding from nothing', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('offline');
    });

    // A client that silently started from an empty dump would record a scan
    // session claiming it was current, and never backfill the catalog.
    await expect(
      loadChartDbDump(fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('offline');
  });
});

describe('lifecycle-rule safety', () => {
  it('keeps dumps under a prefix that excludes models and other bucket objects', () => {
    // The bucket rule that expires old dumps is scoped to CHART_DB_DUMP_PREFIX.
    // Nothing else in the shared bucket should fall under it.
    expect(chartDbDumpKey('any-version').startsWith(CHART_DB_DUMP_PREFIX)).toBe(
      true,
    );
    expect('models/beat_this.onnx'.startsWith(CHART_DB_DUMP_PREFIX)).toBe(
      false,
    );
  });
});
