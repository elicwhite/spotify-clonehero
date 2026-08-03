/**
 * Client-side contract for `runDifficultyGeneration` (plan 0074 Design D):
 * handshake/message protocol, progress forwarding, result, error, and
 * cancellation, via the injectable `createWorker` seam and a `FakeWorker`
 * standing in for `difficulty-worker.ts` (mirrors
 * `lib/tempo-map/__tests__/pipeline-client-cancel.test.ts`'s convention).
 * Also covers the bass spot-check gate: bass rejects synchronously with
 * `UnsupportedInstrumentError` and never spawns a worker.
 */

import {
  runDifficultyGeneration,
  UnsupportedInstrumentError,
  defaultCreateWorker,
  type DifficultyGenerationInput,
} from '../difficulty-client';
import type {
  DifficultyWorkerMessage,
  DifficultyWorkerRequest,
  DrumDifficultyTiers,
} from '../difficulty-protocol';
import type {OursSongInput} from '@/lib/drum-difficulty/ours/featurize';

class FakeWorker {
  onmessage: ((e: {data: DifficultyWorkerMessage}) => void) | null = null;
  onerror: ((e: {message?: string}) => void) | null = null;
  posted: DifficultyWorkerRequest[] = [];
  terminated = false;

  postMessage(msg: DifficultyWorkerRequest) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }

  emit(msg: DifficultyWorkerMessage) {
    this.onmessage?.({data: msg});
  }
}

const DRUMS_SONG_INPUT: OursSongInput = {
  notes: [],
  tempos: [{ms: 0, bpm: 120}],
  timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
  sections: [],
  resolution: 192,
};

function drumsInput(): DifficultyGenerationInput {
  return {instrument: 'drums', input: DRUMS_SONG_INPUT};
}

function drumTiers(): DrumDifficultyTiers {
  return {kind: 'drums', hard: [], medium: [], easy: []};
}

describe('runDifficultyGeneration', () => {
  it('posts a drums run request on the correct wire shape', async () => {
    let fake: FakeWorker;
    const promise = runDifficultyGeneration(drumsInput(), {
      createWorker: () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
    });

    fake!.emit({type: 'result', tiers: drumTiers()});
    await promise;

    expect(fake!.posted).toEqual([
      {type: 'run', instrument: 'drums', input: DRUMS_SONG_INPUT},
    ]);
  });

  it('forwards progress events to onProgress', async () => {
    let fake: FakeWorker;
    const seen: Array<{percent: number; detail?: string | undefined}> = [];
    const promise = runDifficultyGeneration(
      drumsInput(),
      {
        createWorker: () => {
          fake = new FakeWorker();
          return fake as unknown as Worker;
        },
      },
      p => seen.push(p),
    );

    fake!.emit({type: 'progress', percent: 0, detail: 'Loading models'});
    fake!.emit({type: 'progress', percent: 0.5});
    fake!.emit({type: 'result', tiers: drumTiers()});
    await promise;

    expect(seen).toEqual([
      {percent: 0, detail: 'Loading models'},
      {percent: 0.5, detail: undefined},
    ]);
  });

  it('resolves with the result tiers and terminates the worker', async () => {
    let fake: FakeWorker;
    const tiers = drumTiers();
    const promise = runDifficultyGeneration(drumsInput(), {
      createWorker: () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
    });

    fake!.emit({type: 'result', tiers});
    await expect(promise).resolves.toEqual({tiers});
    expect(fake!.terminated).toBe(true);
  });

  it('rejects with the worker error message and terminates the worker', async () => {
    let fake: FakeWorker;
    const promise = runDifficultyGeneration(drumsInput(), {
      createWorker: () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
    });

    fake!.emit({type: 'error', message: 'boom'});
    await expect(promise).rejects.toThrow('boom');
    expect(fake!.terminated).toBe(true);
  });

  it('rejects with AbortError and never spawns a worker when pre-aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let spawned = false;

    const promise = runDifficultyGeneration(drumsInput(), {
      createWorker: () => {
        spawned = true;
        return new FakeWorker() as unknown as Worker;
      },
      signal: controller.signal,
    });

    await expect(promise).rejects.toMatchObject({name: 'AbortError'});
    expect(spawned).toBe(false);
  });

  it('terminates the worker and rejects with AbortError when aborted mid-run', async () => {
    let fake: FakeWorker;
    const controller = new AbortController();

    const promise = runDifficultyGeneration(drumsInput(), {
      createWorker: () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
      signal: controller.signal,
    });

    fake!.emit({type: 'progress', percent: 0.2});
    controller.abort();

    await expect(promise).rejects.toMatchObject({name: 'AbortError'});
    expect(fake!.terminated).toBe(true);
  });

  it('removes the abort listener on settle (no leak, no post-settle throw)', async () => {
    let fake: FakeWorker;
    const controller = new AbortController();
    const removeSpy = jest.spyOn(controller.signal, 'removeEventListener');
    const tiers = drumTiers();

    const promise = runDifficultyGeneration(drumsInput(), {
      createWorker: () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
      signal: controller.signal,
    });

    fake!.emit({type: 'result', tiers});
    await promise;

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(() => controller.abort()).not.toThrow();
    expect(fake!.terminated).toBe(true);
  });

  it('defaults createWorker to the real difficulty-worker.ts when omitted', () => {
    expect(typeof defaultCreateWorker).toBe('function');
  });

  describe('guitar', () => {
    it('posts a guitar run request carrying the chart and the Expert track', async () => {
      let fake: FakeWorker;
      const chart = {resolution: 192} as never;
      const expertTrack = {difficulty: 'expert'} as never;
      const tiers = {
        kind: 'guitar',
        hard: {} as never,
        medium: {} as never,
        easy: {} as never,
      } as const;

      const promise = runDifficultyGeneration(
        {instrument: 'guitar', chart, expertTrack},
        {
          createWorker: () => {
            fake = new FakeWorker();
            return fake as unknown as Worker;
          },
        },
      );

      fake!.emit({type: 'result', tiers});
      await expect(promise).resolves.toEqual({tiers});
      expect(fake!.posted).toEqual([
        {type: 'run', instrument: 'guitar', chart, expertTrack},
      ]);
      expect(fake!.terminated).toBe(true);
    });
  });

  describe('bass (spot-check gate: ships disabled)', () => {
    it('rejects synchronously with UnsupportedInstrumentError and never spawns a worker', async () => {
      let spawned = false;
      const createWorker = () => {
        spawned = true;
        return new FakeWorker() as unknown as Worker;
      };

      await expect(
        runDifficultyGeneration(
          {
            instrument: 'bass',
            chart: {} as never,
            expertTrack: {} as never,
          },
          {createWorker},
        ),
      ).rejects.toBeInstanceOf(UnsupportedInstrumentError);
      expect(spawned).toBe(false);
    });

    it('rejects bass even when the signal is already aborted (input validation, not cancellation)', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        runDifficultyGeneration(
          {instrument: 'bass', chart: {} as never, expertTrack: {} as never},
          {signal: controller.signal},
        ),
      ).rejects.toBeInstanceOf(UnsupportedInstrumentError);
    });
  });
});
