import fs from 'fs';
import path from 'path';
import {BetaAnalyticsDataClient} from '@google-analytics/data';

/**
 * Queries the GA4 Data API for the property behind G-LEE7EDJH14.
 *
 *   pnpm ga meta                          list custom dimensions/metrics
 *   pnpm ga pages --days 28               top pages by sessions
 *   pnpm ga events --days 28              event volume + users per event
 *   pnpm ga funnel --days 28              per-tool reach -> engage -> finish
 *   pnpm ga retention --days 28           new vs returning by landing page
 *   pnpm ga raw '<runReport json>'        arbitrary request, escape hatch
 *   pnpm ga raw --file request.json
 *
 * Report names may be combined — `pnpm ga pages events funnel` runs all three
 * in one process. Do that rather than repeating the command: 1Password serves
 * .env as a pipe that delivers its content once, so the second process starts
 * with no credentials until the environment is served again.
 *
 * Any report takes `--json` to dump the raw response instead of a table.
 *
 * Credentials come from the environment (see `requireEnv`), never from the
 * repo — the key file is a secret and .gitignore'd.
 *
 * IMPORTANT when interpreting anything this prints: gtag.js only loads for
 * visitors the proxy classified as outside the EEA/UK/CH, and never on
 * taste-data-private routes (see app/RegionAwareAnalytics.tsx). Every number
 * here is a subset of real traffic, biased toward US/rest-of-world, and
 * "sessions" is not "visits".
 */

const DAYS_DEFAULT = 28;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Set GA_PROPERTY_ID (the numeric GA4 property id, not ` +
        'the G- measurement id) and GOOGLE_APPLICATION_CREDENTIALS (path to the ' +
        'service-account JSON key) in the 1Password environment, then run via ' +
        '`pnpm ga`. 1Password serves .env as a pipe only while the app is ' +
        'serving that environment — if this keeps failing, check that it is.',
    );
  }
  return value;
}

// tsx does not load env files the way `next dev` does, so do it here. Only
// fills in vars that are not already set, so a real environment always wins and
// .env.local keeps precedence over .env, as in Next.js.
//
// .env is managed by the 1Password app, which serves it as a named pipe rather
// than a regular file. The pipe delivers its content once per open and only
// exists while the app is serving that environment, so read it exactly once
// here and never assume a second read will succeed.
function loadEnvFiles(): void {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(process.cwd(), name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue;
      process.env[key] = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
    }
  }
}

// Flags that consume the next argument, so it is not mistaken for a report
// name. `--json` takes no value and is not listed.
const VALUE_FLAGS = ['--days', '--file'];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

// argv entries that are neither a flag nor a flag's value.
function positionalArgs(): string[] {
  const argv = process.argv.slice(2);
  return argv.filter((entry, i) => {
    if (entry.startsWith('--')) return false;
    return !(i > 0 && VALUE_FLAGS.includes(argv[i - 1]));
  });
}

const days = Number(arg('days') ?? DAYS_DEFAULT);
const asJson = process.argv.includes('--json');
const dateRange = {startDate: `${days}daysAgo`, endDate: 'today'};

type Row = Record<string, string>;

function toRows(response: any): Row[] {
  const dimHeaders: string[] = (response.dimensionHeaders ?? []).map(
    (h: any) => h.name,
  );
  const metHeaders: string[] = (response.metricHeaders ?? []).map(
    (h: any) => h.name,
  );
  return (response.rows ?? []).map((row: any) => {
    const out: Row = {};
    dimHeaders.forEach((name, i) => (out[name] = row.dimensionValues[i].value));
    metHeaders.forEach((name, i) => (out[name] = row.metricValues[i].value));
    return out;
  });
}

function printTable(rows: Row[]): void {
  if (rows.length === 0) {
    console.log('(no rows)');
    return;
  }
  const cols = Object.keys(rows[0]);
  const width = Object.fromEntries(
    cols.map(c => [
      c,
      Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)),
    ]),
  );
  const line = (cells: string[]) =>
    cells.map((cell, i) => cell.padEnd(width[cols[i]])).join('  ');
  console.log(line(cols));
  console.log(cols.map(c => '-'.repeat(width[c])).join('  '));
  for (const row of rows)
    console.log(line(cols.map(c => String(row[c] ?? ''))));
  // No date range here: `raw` carries its own, which need not match --days.
  console.log(`\n${rows.length} rows`);
}

async function run(client: BetaAnalyticsDataClient, request: any) {
  const property = `properties/${requireEnv('GA_PROPERTY_ID')}`;
  const [response] = await client.runReport({property, ...request});
  if (asJson) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  printTable(toRows(response));
}

const REPORTS: Record<string, any> = {
  // What people land on and how deep they get. `screenPageViews` per session
  // is the cheapest signal of "did this page lead anywhere".
  pages: {
    dateRanges: [dateRange],
    dimensions: [{name: 'pagePath'}],
    metrics: [
      {name: 'sessions'},
      {name: 'totalUsers'},
      {name: 'userEngagementDuration'},
      {name: 'bounceRate'},
    ],
    orderBys: [{metric: {metricName: 'sessions'}, desc: true}],
    limit: 50,
  },

  // Every event name with volume and reach. The gap between eventCount and
  // totalUsers is the "one person hammering it" tell.
  events: {
    dateRanges: [dateRange],
    dimensions: [{name: 'eventName'}],
    metrics: [{name: 'eventCount'}, {name: 'totalUsers'}],
    orderBys: [{metric: {metricName: 'eventCount'}, desc: true}],
    limit: 100,
  },

  // Reach vs. engagement per tool: landing page crossed with the events fired
  // in the same session. This is the closest thing to a funnel available
  // without a proper step taxonomy, which is what we intend to add next.
  funnel: {
    dateRanges: [dateRange],
    dimensions: [{name: 'landingPage'}, {name: 'eventName'}],
    metrics: [{name: 'eventCount'}, {name: 'totalUsers'}],
    orderBys: [{metric: {metricName: 'totalUsers'}, desc: true}],
    limit: 200,
  },

  // Does anything bring people back? Split by entry point.
  retention: {
    dateRanges: [dateRange],
    dimensions: [{name: 'landingPage'}, {name: 'newVsReturning'}],
    metrics: [{name: 'totalUsers'}, {name: 'sessions'}],
    orderBys: [{metric: {metricName: 'totalUsers'}, desc: true}],
    limit: 100,
  },

  // Where the traffic comes from, per landing page — tells us which tools are
  // found via search vs. linked from somewhere.
  acquisition: {
    dateRanges: [dateRange],
    dimensions: [{name: 'landingPage'}, {name: 'sessionDefaultChannelGroup'}],
    metrics: [{name: 'sessions'}, {name: 'totalUsers'}],
    orderBys: [{metric: {metricName: 'sessions'}, desc: true}],
    limit: 100,
  },
};

async function main(): Promise<void> {
  loadEnvFiles();
  requireEnv('GOOGLE_APPLICATION_CREDENTIALS');
  const client = new BetaAnalyticsDataClient();
  const command = positionalArgs()[0];

  if (command === 'meta') {
    const [metadata] = await client.getMetadata({
      name: `properties/${requireEnv('GA_PROPERTY_ID')}/metadata`,
    });
    // Only the custom (event-scoped / user-scoped) entries matter here; the
    // ~200 built-ins are documented and just add noise.
    const custom = [
      ...(metadata.dimensions ?? []).map(d => ({
        kind: 'dimension',
        api: d.apiName ?? '',
        ui: d.uiName ?? '',
        custom: String(d.customDefinition ?? false),
      })),
      ...(metadata.metrics ?? []).map(m => ({
        kind: 'metric',
        api: m.apiName ?? '',
        ui: m.uiName ?? '',
        custom: String(m.customDefinition ?? false),
      })),
    ].filter(entry => entry.custom === 'true');
    printTable(custom as unknown as Row[]);
    console.log(
      custom.length === 0
        ? '\nNo custom dimensions registered. Event parameters sent by ' +
            'lib/analytics/track.ts are therefore NOT queryable — they are ' +
            'collected but unreportable until registered in GA4 admin.'
        : '',
    );
    return;
  }

  if (command === 'raw') {
    const file = arg('file');
    const body = file
      ? fs.readFileSync(file, 'utf8')
      : process.argv[3] === '--file'
        ? ''
        : process.argv[3];
    if (!body) throw new Error('raw needs inline JSON or --file <path>');
    await run(client, JSON.parse(body));
    return;
  }

  // Several report names may be given at once. The 1Password pipe that serves
  // .env delivers its content once per serve, so a second process gets nothing
  // — batching keeps a whole analysis pass inside one invocation.
  const names = positionalArgs();
  const unknown = names.filter(name => !REPORTS[name]);
  if (names.length === 0 || unknown.length > 0) {
    console.error(
      `Unknown report "${unknown.join(', ')}". ` +
        `Available: ${Object.keys(REPORTS).join(', ')}, meta, raw`,
    );
    process.exit(1);
  }

  for (const name of names) {
    console.log(`\n########## ${name.toUpperCase()} ##########\n`);
    await run(client, REPORTS[name]);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
