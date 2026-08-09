import {
  CHART_DB_DUMP_FILE_NAME,
  CHART_DB_KEY_PREFIX,
  ChartDbManifest,
  chartDbDumpKey,
} from './chartDbAssets';

/**
 * Pure helpers for publishing a dump to R2. The S3 calls live in
 * `scripts/uploadChartDb.ts`; everything decidable without the network is here
 * so it can be tested.
 */

/** A year, so a client that cached a dump URL keeps resolving it. */
export const DUMP_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * The manifest is the pointer clients follow, so it must never be served from
 * cache after a publish. `no-cache` still allows revalidation.
 */
export const MANIFEST_CACHE_CONTROL = 'no-cache, must-revalidate';

/** Published dumps kept around, newest first, so a bad run can be rolled back. */
export const VERSIONS_TO_KEEP = 5;

export function buildManifest(input: {
  version: string;
  lastRun: string;
  totalSongs: number;
  bytes: number;
  sha256: string;
}): ChartDbManifest {
  return {
    version: input.version,
    lastRun: input.lastRun,
    totalSongs: input.totalSongs,
    key: chartDbDumpKey(input.version),
    bytes: input.bytes,
    sha256: input.sha256,
  };
}

/** The version segment of a dump key, or null if the key isn't a dump. */
export function versionFromDumpKey(key: string): string | null {
  const match = new RegExp(
    `^${CHART_DB_KEY_PREFIX}/([^/]+)/${CHART_DB_DUMP_FILE_NAME}$`,
  ).exec(key);
  return match ? match[1] : null;
}

/**
 * Which published versions to delete, given every dump key in the bucket.
 * Versions sort chronologically because they are ISO timestamps. The version
 * just published is always kept, even if a clock skew makes it sort early.
 */
export function selectVersionsToPrune(
  dumpKeys: string[],
  currentVersion: string,
  keep: number = VERSIONS_TO_KEEP,
): string[] {
  const versions = Array.from(
    new Set(
      dumpKeys
        .map(versionFromDumpKey)
        .filter((version): version is string => version != null),
    ),
  ).sort();

  return versions
    .filter(version => version !== currentVersion)
    .slice(0, Math.max(0, versions.length - keep));
}
