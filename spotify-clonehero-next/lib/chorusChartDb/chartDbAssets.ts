/**
 * The Chorus chart dump lives in R2 (the same bucket that serves the ONNX
 * models) rather than in the repo, and is refreshed on a schedule by
 * `.github/workflows/update-chart-db.yml`.
 *
 * Layout:
 *   charts/manifest.json                        mutable, no-cache
 *   charts/<version>/charts.json.gz             immutable, cached forever
 *
 * The manifest is the only mutable object and is written last, so a publish
 * that dies partway leaves clients on the previous dump. Reading the dump URL
 * and `lastRun` from one manifest snapshot also keeps them consistent: fetching
 * two mutable objects separately could pair a dump with a newer cutoff and
 * leave a permanent hole in that client's database.
 */

export const CHART_DB_ASSET_BASE_URL = 'https://assets.musiccharts.tools';
export const CHART_DB_KEY_PREFIX = 'charts';
export const CHART_DB_MANIFEST_KEY = `${CHART_DB_KEY_PREFIX}/manifest.json`;
export const CHART_DB_DUMP_FILE_NAME = 'charts.json.gz';

export type ChartDbManifest = {
  /** Identifies this dump; also its key prefix under `charts/`. */
  version: string;
  /** `modifiedAfter` cutoff a client resumes its own scanning from. */
  lastRun: string;
  totalSongs: number;
  /** Bucket key of the gzipped dump. */
  key: string;
  /** Size of the gzipped object, for progress reporting. */
  bytes: number;
  sha256: string;
};

export function chartDbAssetUrl(key: string): string {
  return `${CHART_DB_ASSET_BASE_URL}/${key}`;
}

export function chartDbDumpKey(version: string): string {
  return `${CHART_DB_KEY_PREFIX}/${version}/${CHART_DB_DUMP_FILE_NAME}`;
}

/**
 * A published dump is identified by the run's start time. Colons and dots are
 * not legal in every tool that touches object keys, so they're replaced the
 * same way the raw run directories do it.
 */
export function chartDbVersionFromDate(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

/** Throws rather than letting a malformed manifest produce `undefined` URLs. */
export function parseChartDbManifest(value: unknown): ChartDbManifest {
  if (typeof value !== 'object' || value == null) {
    throw new Error('Chart DB manifest is not an object');
  }

  const manifest = value as Partial<ChartDbManifest>;
  const missing = (
    ['version', 'lastRun', 'totalSongs', 'key', 'bytes', 'sha256'] as const
  ).filter(field => manifest[field] == null);

  if (missing.length > 0) {
    throw new Error(`Chart DB manifest is missing ${missing.join(', ')}`);
  }

  if (Number.isNaN(new Date(manifest.lastRun as string).getTime())) {
    throw new Error(
      `Chart DB manifest has an unparseable lastRun: ${manifest.lastRun}`,
    );
  }

  return manifest as ChartDbManifest;
}

export async function fetchChartDbManifest(
  fetchImpl: typeof fetch = fetch,
): Promise<ChartDbManifest> {
  const response = await fetchImpl(chartDbAssetUrl(CHART_DB_MANIFEST_KEY), {
    cache: 'no-cache',
  });

  if (!response.ok) {
    throw new Error(
      `Fetching the chart DB manifest failed with status ${response.status}`,
    );
  }

  return parseChartDbManifest(await response.json());
}

/**
 * The dump is stored gzipped with `Content-Encoding: gzip`, which `fetch`
 * decodes transparently. Node clients reading it through the S3 API do not get
 * that for free and must gunzip themselves.
 */
export async function fetchChartDbDump(
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<any[]> {
  const response = await fetchImpl(chartDbAssetUrl(key));

  if (!response.ok) {
    throw new Error(
      `Fetching the chart DB dump failed with status ${response.status}`,
    );
  }

  return await response.json();
}

export type ChartDbDump = {
  charts: any[];
  /** What the client should scan from to catch up with Chorus. */
  lastRun: string;
};

/**
 * The dump a client with no local data starts from.
 *
 * TODO: drop the bundled fallback (and `public/data/*`) once the scheduled
 * publish has run once. It exists only so this ships before the first upload.
 */
export async function loadChartDbDump(
  fetchImpl: typeof fetch = fetch,
): Promise<ChartDbDump> {
  try {
    const manifest = await fetchChartDbManifest(fetchImpl);
    return {
      charts: await fetchChartDbDump(manifest.key, fetchImpl),
      lastRun: manifest.lastRun,
    };
  } catch (error) {
    console.warn(
      'Could not load the published chart dump, falling back to the bundled copy:',
      error,
    );

    const [charts, metadata] = await Promise.all([
      fetchImpl('/data/charts.json').then(r => r.json()),
      fetchImpl('/data/metadata.json').then(r => r.json()),
    ]);

    return {charts, lastRun: metadata.lastRun};
  }
}
