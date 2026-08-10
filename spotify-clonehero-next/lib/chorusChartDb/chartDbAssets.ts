/**
 * The Chorus chart dump lives in R2 (the same bucket that serves the ONNX
 * models) rather than in the repo, and is refreshed on a schedule by
 * `.github/workflows/update-chart-db.yml`.
 *
 * Layout:
 *   public/data/manifest.json                   committed to the repo; served
 *                                               by the Next.js app at
 *                                               /data/manifest.json
 *   charts/dumps/<version>/charts.json.gz       immutable, cached forever
 *
 * The manifest is committed to the repo by the CI after each successful
 * publish, so the R2 bucket policy never needs delete or overwrite permission.
 * Reading the dump URL and `lastRun` from one manifest snapshot also keeps
 * them consistent.
 *
 * Superseded dumps are reaped by a bucket lifecycle rule on the
 * charts/dumps/ prefix; the publishing credentials never need delete
 * permission.
 */

export const CHART_DB_ASSET_BASE_URL = 'https://assets.musiccharts.tools';
export const CHART_DB_KEY_PREFIX = 'charts';
/**
 * The URL path (relative to the Next.js app) where the manifest is served.
 * Clients in browser context use this; the CI scripts read the file directly
 * from `public/data/manifest.json` instead.
 */
export const CHART_DB_MANIFEST_URL_PATH = '/data/manifest.json';
/**
 * On-disk path (relative to the Next.js project root) where the manifest is
 * written by the publish script and committed to the repo.
 */
export const CHART_DB_MANIFEST_FILE = 'public/data/manifest.json';
/**
 * Dumps sit under their own prefix so the lifecycle rule that expires them can
 * be scoped to exactly them — never the manifest, never the models sharing
 * this bucket.
 */
export const CHART_DB_DUMP_PREFIX = `${CHART_DB_KEY_PREFIX}/dumps`;
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
  return `${CHART_DB_DUMP_PREFIX}/${version}/${CHART_DB_DUMP_FILE_NAME}`;
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
  const response = await fetchImpl(CHART_DB_MANIFEST_URL_PATH, {
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

/** The dump a client with no local data starts from. */
export async function loadChartDbDump(
  fetchImpl: typeof fetch = fetch,
): Promise<ChartDbDump> {
  const manifest = await fetchChartDbManifest(fetchImpl);

  return {
    charts: await fetchChartDbDump(manifest.key, fetchImpl),
    lastRun: manifest.lastRun,
  };
}
