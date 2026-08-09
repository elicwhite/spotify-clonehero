import {ChartDbManifest, chartDbDumpKey} from './chartDbAssets';

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
