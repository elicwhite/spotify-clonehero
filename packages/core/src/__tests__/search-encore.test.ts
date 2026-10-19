import {ENCORE_MAX_RETRIES, fetchAdvanced} from '../search-encore';
import {isChorusUnavailableError} from '../chorus-errors';

const mockFetch = jest.fn();

function response(status: number) {
  return {ok: status >= 200 && status < 300, status, statusText: 'x'};
}

/** Runs `promise` to settlement while draining the backoff timers. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(
    value => ({ok: true as const, value}),
    error => ({ok: false as const, error}),
  );

  let result: {ok: true; value: T} | {ok: false; error: unknown} | undefined;
  settled.then(r => {
    result = r;
  });

  while (result === undefined) {
    await jest.advanceTimersByTimeAsync(60_000);
  }

  if (result.ok) return result.value;
  throw result.error;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('fetchAdvanced', () => {
  it('returns the first successful response without retrying', async () => {
    mockFetch.mockResolvedValue(response(200));

    await expect(settle(fetchAdvanced({}))).resolves.toMatchObject({
      status: 200,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries a 500 and returns the eventual success', async () => {
    mockFetch
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(503))
      .mockResolvedValue(response(200));

    await expect(settle(fetchAdvanced({}))).resolves.toMatchObject({
      status: 200,
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('gives up with a Chorus unavailable error after the retry budget', async () => {
    mockFetch.mockResolvedValue(response(500));

    const error = await settle(fetchAdvanced({})).then(
      () => null,
      (e: unknown) => e,
    );

    expect(isChorusUnavailableError(error)).toBe(true);
    expect((error as Error).message).toBe(
      'Failed to fetch charts from Chorus, try again later',
    );
    expect(mockFetch).toHaveBeenCalledTimes(ENCORE_MAX_RETRIES + 1);
  });

  it('retries network failures too', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(response(200));

    await expect(settle(fetchAdvanced({}))).resolves.toMatchObject({
      status: 200,
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('leaves rate limits and client errors to the caller', async () => {
    mockFetch.mockResolvedValue(response(429));

    await expect(settle(fetchAdvanced({}))).resolves.toMatchObject({
      status: 429,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially between attempts', async () => {
    mockFetch.mockResolvedValue(response(500));
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    await settle(fetchAdvanced({})).catch(() => {});

    expect(setTimeoutSpy.mock.calls.map(call => call[1])).toEqual([
      1000, 2000, 4000,
    ]);
  });
});
