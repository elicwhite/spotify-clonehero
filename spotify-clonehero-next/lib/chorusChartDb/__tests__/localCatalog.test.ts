/**
 * @jest-environment jsdom
 */

const manifest = {
  version: '2026-08-13T00-00-00-000Z',
  dataVersion: 6,
  lastRun: '2026-08-13T00:00:00.000Z',
  totalSongs: 1,
  contentSha256: 'digest',
};

function jsonResponse(body: unknown, ok = true) {
  return {ok, status: ok ? 200 : 404, json: async () => body} as Response;
}

/** The base is resolved once per module instance, so each case needs a fresh one. */
async function freshModule() {
  jest.resetModules();
  return import('../chartDbAssets');
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('prefers a catalog published to public/charts over R2', async () => {
  const {fetchChartDbManifest} = await freshModule();
  const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'HEAD' ? jsonResponse({}) : jsonResponse(manifest),
  );

  await fetchChartDbManifest(fetchImpl as unknown as typeof fetch);

  expect(fetchImpl.mock.calls[0][0]).toBe('/charts/manifest.json');
  // Same-origin, so the dev server serves it.
  expect(fetchImpl.mock.calls[1][0]).toBe('/charts/manifest.json');
});

it('falls back to R2 when nothing is published locally', async () => {
  const {fetchChartDbManifest} = await freshModule();
  const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'HEAD' ? jsonResponse({}, false) : jsonResponse(manifest),
  );

  await fetchChartDbManifest(fetchImpl as unknown as typeof fetch);

  expect(fetchImpl.mock.calls[1][0]).toBe(
    'https://assets.musiccharts.tools/charts/manifest.json',
  );
});

it('probes once, however many assets are fetched', async () => {
  const {fetchChartDbManifest} = await freshModule();
  const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'HEAD' ? jsonResponse({}, false) : jsonResponse(manifest),
  );
  const impl = fetchImpl as unknown as typeof fetch;

  await fetchChartDbManifest(impl);
  await fetchChartDbManifest(impl);

  const probes = fetchImpl.mock.calls.filter(
    ([, init]) => (init as RequestInit | undefined)?.method === 'HEAD',
  );
  expect(probes).toHaveLength(1);
});
