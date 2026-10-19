import type {ChorusChartDbRow} from './types';

/**
 * The Chorus chart dump lives in R2 (the same bucket that serves the ONNX
 * models) rather than in the repo, and is refreshed on a schedule by
 * `.github/workflows/update-chart-db.yml`.
 *
 * Layout:
 *   charts/manifest.json                        mutable, no-cache
 *   charts/dumps/<version>/charts.json.gz       immutable, cached forever
 *
 * The manifest is the only mutable object and is written last, so a publish
 * that dies partway leaves clients on the previous dump. Reading the dump URL
 * and `lastRun` from one manifest snapshot also keeps them consistent: fetching
 * two mutable objects separately could pair a dump with a newer cutoff and
 * leave a permanent hole in that client's database.
 *
 * Superseded dumps are reaped by a bucket lifecycle rule rather than by this
 * code, so the publishing credentials never need delete permission.
 */

export const CHART_DB_ASSET_BASE_URL = 'https://assets.musiccharts.tools';
export const CHART_DB_KEY_PREFIX = 'charts';
export const CHART_DB_MANIFEST_KEY = `${CHART_DB_KEY_PREFIX}/manifest.json`;
/**
 * Dumps sit under their own prefix so the lifecycle rule that expires them can
 * be scoped to exactly them — never the manifest, never the models sharing
 * this bucket.
 */
export const CHART_DB_DUMP_PREFIX = `${CHART_DB_KEY_PREFIX}/dumps`;
export const CHART_DB_DUMP_FILE_NAME = 'charts.json.gz';
/**
 * Bumped whenever a client's stored catalog must be thrown away and re-ingested
 * — a new row shape, a new derived column, or contents that cannot be healed
 * incrementally. `/api/data` advertises it and every published manifest carries
 * it, so a client only ever ingests the dump generation it was built against.
 * Ordinary daily crawls do not touch it: those are picked up from
 * `manifest.lastRun` and the client's own incremental scan.
 */
export const CHART_DB_DATA_VERSION = 6;

export type ChartDbManifest = {
  /** Identifies this dump; also its key prefix under `charts/`. */
  version: string;
  /** Catalog generation advertised by `/api/data`. */
  dataVersion: number;
  /** `modifiedAfter` cutoff a client resumes its own scanning from. */
  lastRun: string;
  /** Not verified — `contentSha256` already proves the dump byte for byte.
   *  Carried so the manifest is legible to a human opening it. */
  totalSongs: number;
  /** SHA-256 of the JSON bytes after transparent CDN decompression. */
  contentSha256: string;
};

export function chartDbAssetUrl(key: string): string {
  return `${CHART_DB_ASSET_BASE_URL}/${key}`;
}

/**
 * A dev server serving `public/charts/` takes precedence over R2, so
 * `pnpm publish:db --local` is the whole setup: publish, reload, and the
 * browser exercises the real manifest, checksum and ingest against a catalog
 * you built. Delete `public/charts/` and it goes back to production data.
 *
 * The probe costs one HEAD request, once, and only in a development build in a
 * browser — the first condition is statically false in a production bundle, so
 * none of this survives the build.
 */
let localCatalogBase: Promise<string> | undefined;

async function resolveAssetBase(fetchImpl: typeof fetch): Promise<string> {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') {
    return CHART_DB_ASSET_BASE_URL;
  }
  localCatalogBase ??= (async () => {
    try {
      const response = await fetchImpl(`/${CHART_DB_MANIFEST_KEY}`, {
        method: 'HEAD',
      });
      if (response.ok) {
        console.log('Using the catalog published to public/charts/');
        return '';
      }
    } catch {
      // No dev server route for it; production data is the right answer.
    }
    return CHART_DB_ASSET_BASE_URL;
  })();
  return localCatalogBase;
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

/**
 * The manifest is the one thing here written by a different process at a
 * different time than the code reading it, so its shape is worth checking.
 * Only two fields can fail quietly, though: a missing `dataVersion` would skip
 * the generation check, and an unparseable `lastRun` becomes the client's scan
 * cutoff and silently leaves a hole in its catalog. A bad `version` 404s and a
 * bad `contentSha256` fails the checksum, both loudly enough on their own.
 */
export function parseChartDbManifest(value: unknown): ChartDbManifest {
  if (typeof value !== 'object' || value == null) {
    throw new Error('Chart DB manifest is not an object');
  }
  const manifest = value as ChartDbManifest;

  if (!Number.isInteger(manifest.dataVersion)) {
    throw new Error('Chart DB manifest has no data version');
  }
  if (Number.isNaN(Date.parse(manifest.lastRun))) {
    throw new Error(
      `Chart DB manifest has an unparseable lastRun: ${manifest.lastRun}`,
    );
  }

  return manifest;
}

export async function fetchChartDbManifest(
  fetchImpl: typeof fetch = fetch,
): Promise<ChartDbManifest> {
  const base = await resolveAssetBase(fetchImpl);
  const response = await fetchImpl(`${base}/${CHART_DB_MANIFEST_KEY}`, {
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
  expectedContentSha256: string,
): Promise<ChorusChartDbRow[]> {
  const response = await fetchImpl(
    `${await resolveAssetBase(fetchImpl)}/${key}`,
  );

  if (!response.ok) {
    throw new Error(
      `Fetching the chart DB dump failed with status ${response.status}`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = await sha256Hex(bytes);
  if (digest !== expectedContentSha256) {
    throw new Error('Chart DB dump checksum does not match its manifest');
  }
  const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (!Array.isArray(value)) {
    throw new Error('Chart DB dump is not an array');
  }
  // Not validated row by row. The checksum above proves these are exactly the
  // bytes CI published, and CI validated every row before publishing them
  // (`assertPublishableDump`). Re-checking here would only catch a bug in our
  // own publisher — in the worst possible place to catch it.
  return value as ChorusChartDbRow[];
}

export type ChartDbDump = {
  charts: ChorusChartDbRow[];
  /** What the client should scan from to catch up with Chorus. */
  lastRun: string;
};

/**
 * The dump a client with no local data starts from. The caller passes the
 * generation `/api/data` advertised, so a manifest published by a newer or
 * older deploy is refused rather than half-ingested.
 */
export async function loadChartDbDump(
  expectedDataVersion: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ChartDbDump> {
  const manifest = await fetchChartDbManifest(fetchImpl);

  if (manifest.dataVersion !== expectedDataVersion) {
    throw new Error(
      `Chart DB manifest has data version ${manifest.dataVersion}; expected ${expectedDataVersion}`,
    );
  }

  const charts = await fetchChartDbDump(
    chartDbDumpKey(manifest.version),
    fetchImpl,
    manifest.contentSha256,
  );

  return {
    charts,
    lastRun: manifest.lastRun,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
