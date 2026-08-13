import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import {promisify} from 'util';
import {PutObjectCommand, S3Client} from '@aws-sdk/client-s3';
import {
  CHART_DB_KEY_PREFIX,
  CHART_DB_MANIFEST_KEY,
  CHART_DB_DATA_VERSION,
  chartDbAssetUrl,
  chartDbDumpKey,
  chartDbVersionFromDate,
} from '../lib/chorusChartDb/chartDbAssets';
import {
  assertPublishableDump,
  buildManifest,
  DUMP_CACHE_CONTROL,
  MANIFEST_CACHE_CONTROL,
} from '../lib/chorusChartDb/chartDbPublish';
import {toChorusChartDbRow} from '../lib/chorusChartDb/types';

/**
 * Publishes what `downloadDb.ts` wrote to the R2 bucket behind
 * assets.musiccharts.tools.
 *
 *   pnpm publish:db              upload
 *   pnpm publish:db --dry-run    report what would happen, touch nothing
 *   pnpm publish:db --local      write it into public/ for the dev server
 *
 * The dump is uploaded to an immutable key and the manifest is written LAST, so
 * a failure part way through leaves clients on the previous dump rather than
 * pointing them at something half-written.
 *
 * This only ever writes. Superseded dumps are expired by a bucket lifecycle
 * rule on the `charts/dumps/` prefix, so the credentials here need no delete
 * permission and can never remove a dump clients are still being pointed at.
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
 * Write the catalog into `public/` instead of R2, so `pnpm dev` serves it and
 * the browser exercises the real manifest, checksum and ingest against a dump
 * you built. A development build prefers this over R2 automatically; delete
 * `public/charts/` to go back to production data.
 */
const LOCAL = process.argv.includes('--local');
const LOCAL_DIR = path.join('.', 'public', CHART_DB_KEY_PREFIX);

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
    // the manifest's contentSha256 instead.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
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

  // A local catalog re-narrows its rows first, so a dump written under an
  // older contract can be served today without a five-hour crawl to rebuild
  // it. That is the same transformation an incremental run applies to its
  // seeds, so the result matches what CI would publish. The real publish path
  // stays strict: there, a stale row means the pipeline is wrong.
  const rows: unknown = LOCAL
    ? (JSON.parse(charts.toString()) as unknown[])
        .map(toChorusChartDbRow)
        .filter(row => row != null)
    : JSON.parse(charts.toString());
  const body = LOCAL ? asBytes(Buffer.from(JSON.stringify(rows))) : charts;

  // Every row is checked here, once, so clients never have to.
  assertPublishableDump(rows);

  const version = chartDbVersionFromDate(new Date(metadata.lastRun));
  const key = chartDbDumpKey(version);

  const compressed = asBytes(
    await gzip(body, {level: zlib.constants.Z_BEST_COMPRESSION}),
  );
  const contentSha256 = crypto.createHash('sha256').update(body).digest('hex');
  const manifest = buildManifest({
    version,
    dataVersion: CHART_DB_DATA_VERSION,
    lastRun: metadata.lastRun,
    totalSongs: metadata.totalSongs,
    contentSha256,
    compressedBytes: compressed.byteLength,
    compressedSha256: crypto
      .createHash('sha256')
      .update(compressed)
      .digest('hex'),
  });

  console.log(
    `Publishing ${metadata.totalSongs.toLocaleString()} songs as ${version}: ` +
      `${(body.byteLength / 1e6).toFixed(1)}MB raw, ${(compressed.byteLength / 1e6).toFixed(1)}MB gzipped`,
  );

  if (LOCAL) {
    // Written uncompressed under the .gz name the manifest points at. The dev
    // server serves it without Content-Encoding, so fetch hands back exactly
    // these bytes — which is what contentSha256 covers. Storing it gzipped
    // here would fail the checksum, not pass it.
    const dumpPath = path.join('.', 'public', key);
    fs.mkdirSync(path.dirname(dumpPath), {recursive: true});
    fs.writeFileSync(dumpPath, body);
    fs.mkdirSync(LOCAL_DIR, {recursive: true});
    fs.writeFileSync(
      path.join('.', 'public', CHART_DB_MANIFEST_KEY),
      JSON.stringify(manifest, null, 2),
    );
    console.log(`Wrote public/${CHART_DB_MANIFEST_KEY} and public/${key}`);
    console.log('Reload the dev server and it will prefer this over R2.');
    return;
  }

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
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
