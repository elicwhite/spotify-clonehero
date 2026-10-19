import {ChartDbManifest, chartDbDumpKey} from './chartDbAssets';
import {
  ENCORE_BOOLEAN_FIELDS,
  INI_BOOLEAN_FIELDS,
  INI_NUMBER_FIELDS,
  type ChorusChartDbRow,
} from './types';

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

/**
 * Fields the previous release's parser requires and this one ignores.
 *
 * That parser rejects a manifest missing any of them, and it is still what
 * runs in every browser until the next deploy sticks. Publishing without them
 * means a Next.js rollback — or a chart publish that lands while the deploy
 * fails — leaves every client unable to read the catalog at all, recoverable
 * only by restoring the old manifest by hand with R2 credentials.
 *
 * Three fields buy a rollback that needs no coordination. Delete them once the
 * release that stopped reading them can no longer be rolled back to.
 */
type LegacyManifestFields = {
  /** Derived from `version` now. */
  key: string;
  /** Never read. */
  bytes: number;
  /**
   * Hash of the gzipped object, which the old parser required present but
   * never verified — Cloudflare recompresses in transit, so it never could.
   * `contentSha256` replaced it for that reason.
   */
  sha256: string;
};

export function buildManifest(input: {
  version: string;
  dataVersion: number;
  lastRun: string;
  totalSongs: number;
  contentSha256: string;
  compressedBytes: number;
  compressedSha256: string;
}): ChartDbManifest & LegacyManifestFields {
  const {compressedBytes, compressedSha256, ...manifest} = input;
  return {
    ...manifest,
    key: chartDbDumpKey(input.version),
    bytes: compressedBytes,
    sha256: compressedSha256,
  };
}

/**
 * The exhaustive row check, run once here rather than in every browser.
 *
 * Clients verify the dump's checksum and then trust its shape, so this is the
 * only thing standing between a malformed row and 100,000 broken catalogs.
 * A failure fails the publish; the previous dump stays live and nobody
 * notices. Throwing is right *here* for the same reason it is wrong there.
 */
export function assertPublishableDump(
  rows: unknown,
): asserts rows is ChorusChartDbRow[] {
  if (!Array.isArray(rows)) throw new Error('Dump is not an array');
  rows.forEach((value, index) => {
    const where = `row ${index}`;
    if (typeof value !== 'object' || value == null) {
      throw new Error(`${where} is not an object`);
    }
    const row = value as Record<string, unknown>;
    for (const field of ['md5', 'name', 'artist', 'charter', 'modifiedTime']) {
      if (typeof row[field] !== 'string' || row[field] === '') {
        throw new Error(`${where} has no ${field}`);
      }
    }
    if (Number.isNaN(Date.parse(row['modifiedTime'] as string))) {
      throw new Error(`${where} has an unparseable modifiedTime`);
    }
    if (typeof row['groupId'] !== 'number') {
      throw new Error(`${where} has no groupId`);
    }
    if (row['year'] != null && !Number.isInteger(row['year'])) {
      throw new Error(`${where} has a non-integer year: ${row['year']}`);
    }
    for (const field of INI_NUMBER_FIELDS) {
      const v = row[field];
      if (v != null && (typeof v !== 'number' || !Number.isFinite(v))) {
        throw new Error(`${where} has an invalid ${field}`);
      }
    }
    for (const field of [...INI_BOOLEAN_FIELDS, ...ENCORE_BOOLEAN_FIELDS]) {
      if (row[field] != null && typeof row[field] !== 'boolean') {
        throw new Error(`${where} has an invalid ${field}`);
      }
    }
  });
}
