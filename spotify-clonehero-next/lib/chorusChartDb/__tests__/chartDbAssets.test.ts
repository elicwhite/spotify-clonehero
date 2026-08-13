import {
  CHART_DB_DUMP_PREFIX,
  CHART_DB_MANIFEST_KEY,
  ChartDbManifest,
  chartDbAssetUrl,
  chartDbDumpKey,
  chartDbVersionFromDate,
  fetchChartDbManifest,
  loadChartDbDump,
  parseChartDbManifest,
} from '../chartDbAssets';
import {assertPublishableDump, buildManifest} from '../chartDbPublish';
import crypto from 'crypto';

const manifest: ChartDbManifest = {
  version: '2026-08-09T17-14-53-098Z',
  dataVersion: 6,
  lastRun: '2026-08-09T17:14:53.098Z',
  totalSongs: 94609,
  contentSha256: 'content-abc123',
};

function jsonResponse(body: unknown, ok = true) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    arrayBuffer: async () => bytes.buffer,
  } as Response;
}

function contentSha256(body: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
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

  it('builds absolute URLs on the assets host', () => {
    expect(chartDbAssetUrl(CHART_DB_MANIFEST_KEY)).toBe(
      'https://assets.musiccharts.tools/charts/manifest.json',
    );
  });

  it('round-trips a built manifest through the parser', () => {
    const built = buildManifest({
      version: manifest.version,
      dataVersion: manifest.dataVersion,
      lastRun: manifest.lastRun,
      totalSongs: manifest.totalSongs,
      contentSha256: manifest.contentSha256,
    });

    expect(built).toEqual(manifest);
    expect(parseChartDbManifest(built)).toEqual(manifest);
  });

  it.each([
    ['not an object', 'null', null],
    ['no data version', 'dataVersion', {...manifest, dataVersion: undefined}],
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
    const charts = [
      {
        md5: 'chart',
        name: 'Song',
        artist: 'Artist',
        charter: 'Charter',
        modifiedTime: '2026-01-01T00:00:00.000Z',
        groupId: 1,
        year: '2023',
      },
    ];
    const fetchImpl = jest.fn(async (url: string) =>
      url.endsWith('manifest.json')
        ? jsonResponse({
            ...manifest,
            totalSongs: charts.length,
            contentSha256: contentSha256(charts),
          })
        : jsonResponse(charts),
    );

    const dump = await loadChartDbDump(6, fetchImpl as unknown as typeof fetch);

    // Returned as published. The checksum proved these are CI's bytes and CI
    // validated them, so the client does no per-row work.
    expect(dump).toEqual({charts, lastRun: manifest.lastRun});
    expect(fetchImpl.mock.calls[1][0]).toBe(
      chartDbAssetUrl(chartDbDumpKey(manifest.version)),
    );
  });

  it('propagates a failure rather than seeding from nothing', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('offline');
    });

    // A client that silently started from an empty dump would record a scan
    // session claiming it was current, and never backfill the catalog.
    await expect(
      loadChartDbDump(6, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('offline');
  });

  it('returns rows exactly as published, without re-checking them', async () => {
    // The checksum already proved these are the bytes CI validated, so a row
    // shape this client does not recognise is CI's problem to have caught —
    // see assertPublishableDump. Re-parsing 94,000 rows in every browser only
    // moves that failure somewhere it cannot be fixed.
    const charts = [
      {md5: 'a', name: 'Song', artist: 42, groupId: -1, year: 'Unknown Year'},
    ];
    const fetchImpl = jest.fn(async (url: string) =>
      url.endsWith('manifest.json')
        ? jsonResponse({...manifest, contentSha256: contentSha256(charts)})
        : jsonResponse(charts),
    );

    const dump = await loadChartDbDump(6, fetchImpl as unknown as typeof fetch);

    expect(dump.charts).toEqual(charts);
  });

  it('rejects a dump whose bytes do not match the manifest checksum', async () => {
    const fetchImpl = jest.fn(async (url: string) =>
      url.endsWith('manifest.json')
        ? jsonResponse({...manifest, contentSha256: 'not-the-digest'})
        : jsonResponse([{md5: 'a'}]),
    );

    await expect(
      loadChartDbDump(6, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('checksum');
  });

  it('rejects a manifest whose contents version does not match the API', async () => {
    const fetchImpl = jest.fn(async (url: string) =>
      url.endsWith('manifest.json')
        ? jsonResponse({...manifest, dataVersion: 5})
        : jsonResponse([]),
    );

    await expect(
      loadChartDbDump(7, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('expected 7');
  });
});

describe('lifecycle-rule safety', () => {
  it('keeps dumps under a prefix that excludes the manifest', () => {
    // The bucket rule that expires old dumps is scoped to CHART_DB_DUMP_PREFIX.
    // If the manifest (or anything else in this shared bucket) ever fell under
    // it, the pointer would be deleted out from under every new visitor.
    expect(chartDbDumpKey('any-version').startsWith(CHART_DB_DUMP_PREFIX)).toBe(
      true,
    );
    expect(CHART_DB_MANIFEST_KEY.startsWith(CHART_DB_DUMP_PREFIX)).toBe(false);
    expect('models/beat_this.onnx'.startsWith(CHART_DB_DUMP_PREFIX)).toBe(
      false,
    );
  });
});

describe('assertPublishableDump', () => {
  const row = {
    md5: 'chart',
    name: 'Song',
    artist: 'Artist',
    charter: 'Charter',
    modifiedTime: '2026-01-01T00:00:00.000Z',
    groupId: -1,
  };

  it('accepts a well-formed dump', () => {
    expect(() =>
      assertPublishableDump([row, {...row, md5: 'b'}]),
    ).not.toThrow();
  });

  it.each([
    ['a missing md5', {...row, md5: undefined}],
    ['a non-string artist', {...row, artist: 42}],
    ['an unparseable modifiedTime', {...row, modifiedTime: 'whenever'}],
    ['no groupId', {...row, groupId: undefined}],
    [
      'a free-text year filterKeys should have dropped',
      {...row, year: '1969 (September 26)'},
    ],
    ['a non-numeric intensity', {...row, diff_drums: 'hard'}],
  ])('refuses to publish a dump with %s', (_label, bad) => {
    expect(() => assertPublishableDump([row, bad])).toThrow();
  });

  it('names the offending row so a failed publish is diagnosable', () => {
    expect(() => assertPublishableDump([row, row, {...row, md5: 7}])).toThrow(
      'row 2',
    );
  });
});
