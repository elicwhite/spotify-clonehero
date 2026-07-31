/**
 * Download-resilience tests for getCachedModel: a stalled or dropped
 * connection must resume with an HTTP Range request instead of hanging
 * forever (every lyric-aligning tool froze on a mid-stream wav2vec2
 * download stall), and permanent HTTP failures must fail fast.
 *
 * `navigator` is stubbed out for the suite so getCachedModel always falls
 * through to the plain download path — exactly the code under test. (Some
 * runtimes provide a working OPFS; letting it cache would make every test
 * after the first read from cache instead of downloading.)
 */

import {getCachedModel} from '@/lib/lyrics-align/model-cache';

const MB = 1_000_000;
const URL = 'https://example.com/model.onnx';

/** Deterministic bytes that pass the model prefix sniff. */
function modelBytes(size: number): Uint8Array {
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i++) buf[i] = (i * 7 + 13) % 251;
  buf[0] = 0x08; // protobuf-ish; not '<', '{', '[', whitespace, or 'v'
  return buf;
}

type Chunk = Uint8Array | 'error' | 'hang';

interface ResponseSpec {
  status?: number;
  headers?: Record<string, string>;
  chunks: Chunk[];
}

function makeResponse(spec: ResponseSpec, signal?: AbortSignal): Response {
  let i = 0;
  const status = spec.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k: string) => spec.headers?.[k.toLowerCase()] ?? null,
    },
    body: {
      getReader() {
        return {
          read(): Promise<{done: boolean; value: Uint8Array | undefined}> {
            const c = spec.chunks[i++];
            if (c === undefined) {
              return Promise.resolve({done: true, value: undefined});
            }
            if (c === 'error') {
              return Promise.reject(new Error('network dropped'));
            }
            if (c === 'hang') {
              return new Promise((_resolve, reject) => {
                signal?.addEventListener('abort', () =>
                  reject(new Error('The operation was aborted')),
                );
              });
            }
            return Promise.resolve({done: false, value: c});
          },
        };
      },
    },
  } as unknown as Response;
}

/** Install a fetch mock serving `specs` in call order (last spec repeats).
 *  Returns the recorded calls' Range headers. */
function mockFetch(specs: ResponseSpec[]): {range: string | null}[] {
  const calls: {range: string | null}[] = [];
  global.fetch = jest.fn(
    async (_url: RequestInfo | globalThis.URL, opts?: RequestInit) => {
      const headers = (opts?.headers ?? {}) as Record<string, string>;
      calls.push({range: headers['Range'] ?? null});
      const spec = specs[Math.min(calls.length - 1, specs.length - 1)];
      return makeResponse(spec, opts?.signal ?? undefined);
    },
  ) as unknown as typeof fetch;
  return calls;
}

function bytesEqual(a: ArrayBuffer, b: Uint8Array): boolean {
  const av = new Uint8Array(a);
  if (av.length !== b.length) return false;
  for (let i = 0; i < av.length; i++) {
    if (av[i] !== b[i]) return false;
  }
  return true;
}

const originalFetch = global.fetch;
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  'navigator',
);
let warnSpy: jest.SpyInstance;

beforeAll(() => {
  // No OPFS: force the download path even on runtimes that provide
  // navigator.storage.getDirectory.
  Object.defineProperty(globalThis, 'navigator', {
    value: {},
    configurable: true,
    writable: true,
  });
});

afterAll(() => {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
  } else {
    delete (globalThis as {navigator?: unknown}).navigator;
  }
});

beforeEach(() => {
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  global.fetch = originalFetch;
  warnSpy.mockRestore();
  jest.useRealTimers();
});

describe('getCachedModel download resilience', () => {
  test('resumes with a Range request after a mid-stream network error', async () => {
    const full = modelBytes(3 * MB);
    const calls = mockFetch([
      {
        headers: {'content-length': String(3 * MB)},
        chunks: [full.slice(0, MB), 'error'],
      },
      {
        status: 206,
        headers: {'content-range': `bytes ${MB}-${3 * MB - 1}/${3 * MB}`},
        chunks: [full.slice(MB)],
      },
    ]);

    const result = await getCachedModel(URL, 'k', () => {}, 2 * MB);

    expect(calls).toHaveLength(2);
    expect(calls[0].range).toBeNull();
    expect(calls[1].range).toBe(`bytes=${MB}-`);
    expect(bytesEqual(result, full)).toBe(true);
  });

  test('resumes when the stream ends cleanly but short of content-length', async () => {
    const full = modelBytes(3 * MB);
    const calls = mockFetch([
      {
        headers: {'content-length': String(3 * MB)},
        chunks: [full.slice(0, MB)], // clean done, but only 1/3 MB
      },
      {
        status: 206,
        headers: {'content-range': `bytes ${MB}-${3 * MB - 1}/${3 * MB}`},
        chunks: [full.slice(MB)],
      },
    ]);

    const result = await getCachedModel(URL, 'k', () => {}, 2 * MB);

    expect(calls[1].range).toBe(`bytes=${MB}-`);
    expect(bytesEqual(result, full)).toBe(true);
  });

  test('restarts from scratch when the server ignores the Range request', async () => {
    const full = modelBytes(3 * MB);
    const calls = mockFetch([
      {
        headers: {'content-length': String(3 * MB)},
        chunks: [full.slice(0, MB), 'error'],
      },
      {
        status: 200, // full file again, Range ignored
        headers: {'content-length': String(3 * MB)},
        chunks: [full],
      },
    ]);

    const result = await getCachedModel(URL, 'k', () => {}, 2 * MB);

    expect(calls).toHaveLength(2);
    expect(result.byteLength).toBe(3 * MB);
    expect(bytesEqual(result, full)).toBe(true);
  });

  test('aborts a stalled stream via the watchdog and resumes', async () => {
    jest.useFakeTimers();
    const full = modelBytes(3 * MB);
    const calls = mockFetch([
      {
        headers: {'content-length': String(3 * MB)},
        chunks: [full.slice(0, MB), 'hang'], // stream goes silent
      },
      {
        status: 206,
        headers: {'content-range': `bytes ${MB}-${3 * MB - 1}/${3 * MB}`},
        chunks: [full.slice(MB)],
      },
    ]);

    const promise = getCachedModel(URL, 'k', () => {}, 2 * MB);
    await jest.advanceTimersByTimeAsync(31_000);
    const result = await promise;

    expect(calls[1].range).toBe(`bytes=${MB}-`);
    expect(bytesEqual(result, full)).toBe(true);
  });

  test('gives up with a clear error after repeated stalls', async () => {
    const full = modelBytes(3 * MB);
    const calls = mockFetch([
      {
        headers: {'content-length': String(3 * MB)},
        chunks: [full.slice(0, MB), 'error'],
      },
      {
        status: 206,
        headers: {'content-range': `bytes ${MB}-${3 * MB - 1}/${3 * MB}`},
        chunks: ['error'],
      },
    ]);

    await expect(getCachedModel(URL, 'k', () => {}, 2 * MB)).rejects.toThrow(
      /kept stalling.*1 of 3 MB/,
    );
    expect(calls).toHaveLength(4); // MAX_ATTEMPTS
  });

  test('fails fast on a permanent HTTP error without retrying', async () => {
    const calls = mockFetch([{status: 404, chunks: []}]);

    await expect(getCachedModel(URL, 'k', () => {}, MB)).rejects.toThrow(
      /HTTP 404/,
    );
    expect(calls).toHaveLength(1);
  });

  test('reports structured progress, throttled to one message per MB', async () => {
    const full = modelBytes(3 * MB);
    mockFetch([
      {
        headers: {'content-length': String(3 * MB)},
        chunks: [full.slice(0, MB), full.slice(MB, 2 * MB), full.slice(2 * MB)],
      },
    ]);

    const progress: {
      msg: string;
      info?: {loadedBytes: number; totalBytes: number};
    }[] = [];
    await getCachedModel(
      URL,
      'k',
      (msg, info) => progress.push({msg, ...(info ? {info} : {})}),
      2 * MB,
    );

    const withInfo = progress.filter(p => p.info);
    expect(withInfo.map(p => p.msg)).toEqual([
      'Downloading model 1/3 MB (33%)',
      'Downloading model 2/3 MB (67%)',
      'Downloading model 3/3 MB (100%)',
    ]);
    expect(withInfo[2].info).toEqual({
      loadedBytes: 3 * MB,
      totalBytes: 3 * MB,
    });
  });
});
