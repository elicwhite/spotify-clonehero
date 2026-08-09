import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import {promisify} from 'util';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  CHART_DB_KEY_PREFIX,
  CHART_DB_MANIFEST_KEY,
  chartDbAssetUrl,
  chartDbDumpKey,
  chartDbVersionFromDate,
} from '../lib/chorusChartDb/chartDbAssets';
import {
  buildManifest,
  DUMP_CACHE_CONTROL,
  MANIFEST_CACHE_CONTROL,
  selectVersionsToPrune,
  VERSIONS_TO_KEEP,
} from '../lib/chorusChartDb/chartDbPublish';

/**
 * Publishes what `downloadDb.ts` wrote to the R2 bucket behind
 * assets.musiccharts.tools.
 *
 *   pnpm publish:db              upload, then prune old versions
 *   pnpm publish:db --dry-run    report what would happen, touch nothing
 *
 * The dump is uploaded to an immutable key and the manifest is written LAST, so
 * a failure part way through leaves clients on the previous dump rather than
 * pointing them at something half-written.
 */

const gzip = promisify(zlib.gzip);

/**
 * `Buffer` is a `Uint8Array` at runtime, but @types/node 20 declares it against
 * an older, untyped-backing-store `Uint8Array` than the TS 7 lib expects.
 */
function asBytes(buffer: Buffer): Uint8Array {
  return buffer as unknown as Uint8Array;
}

const CHART_FILE = path.join('.', 'public', 'data', 'charts.json');
const METADATA_FILE = path.join('.', 'public', 'data', 'metadata.json');

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * The R2 credentials live only in GitHub Actions secrets, so publishing is a CI
 * operation. `--dry-run` is the local path and never reads them.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Publishing runs in GitHub Actions, where the R2 secrets live — ` +
        'use `pnpm publish:db --dry-run` to check a dump locally.',
    );
  }
  return value;
}

function createClient(): S3Client {
  const accountId = requireEnv('R2_ACCOUNT_ID');

  return new S3Client({
    // R2's S3-compatible endpoint ignores the region, but the SDK demands one.
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    // Recent SDK versions attach a CRC32 checksum to every request by default,
    // which not every S3-compatible provider accepts. We verify integrity via
    // the manifest's sha256 instead.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
}

async function listDumpKeys(
  client: S3Client,
  bucket: string,
): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${CHART_DB_KEY_PREFIX}/`,
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of response.Contents ?? []) {
      if (object.Key) {
        keys.push(object.Key);
      }
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return keys;
}

async function run() {
  const charts = asBytes(fs.readFileSync(CHART_FILE));
  const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8')) as {
    lastRun: string;
    totalSongs: number;
  };

  if (!metadata.lastRun || typeof metadata.totalSongs !== 'number') {
    throw new Error(
      `${METADATA_FILE} is missing lastRun or totalSongs; re-run the download`,
    );
  }

  const version = chartDbVersionFromDate(new Date(metadata.lastRun));
  const key = chartDbDumpKey(version);

  const compressed = asBytes(
    await gzip(charts, {level: zlib.constants.Z_BEST_COMPRESSION}),
  );
  const sha256 = crypto.createHash('sha256').update(compressed).digest('hex');

  const manifest = buildManifest({
    version,
    lastRun: metadata.lastRun,
    totalSongs: metadata.totalSongs,
    bytes: compressed.byteLength,
    sha256,
  });

  console.log(
    `Publishing ${metadata.totalSongs.toLocaleString()} songs as ${version}: ` +
      `${(charts.byteLength / 1e6).toFixed(1)}MB raw, ${(compressed.byteLength / 1e6).toFixed(1)}MB gzipped`,
  );

  if (DRY_RUN) {
    console.log('--dry-run, not uploading. Manifest would be:');
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  const bucket = requireEnv('R2_BUCKET');
  const client = createClient();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: compressed,
      // Stored gzipped so the CDN never has to compress 71MB on the fly.
      // Browsers decode this transparently; the S3 API does not.
      ContentType: 'application/json',
      ContentEncoding: 'gzip',
      CacheControl: DUMP_CACHE_CONTROL,
    }),
  );
  console.log(`Uploaded ${chartDbAssetUrl(key)}`);

  // Written last: until this lands, clients keep using the previous dump.
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: CHART_DB_MANIFEST_KEY,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
      CacheControl: MANIFEST_CACHE_CONTROL,
    }),
  );
  console.log(`Updated ${chartDbAssetUrl(CHART_DB_MANIFEST_KEY)}`);

  const stale = selectVersionsToPrune(
    await listDumpKeys(client, bucket),
    version,
  );

  if (stale.length > 0) {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {Objects: stale.map(old => ({Key: chartDbDumpKey(old)}))},
      }),
    );
    console.log(
      `Pruned ${stale.length} dump(s) older than the newest ${VERSIONS_TO_KEEP}: ${stale.join(', ')}`,
    );
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
