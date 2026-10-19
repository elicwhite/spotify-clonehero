import fs from 'fs';
import path from 'path';
import vm from 'vm';

// The worklet is a vendored, pre-transpiled AudioWorklet script (ES5 style,
// no imports/exports) meant to run inside an AudioWorkletGlobalScope. We
// load it into a vm sandbox that stubs just enough of that global scope
// (AudioWorkletProcessor, registerProcessor, sampleRate, CustomEvent) to
// drive its `process()` method directly in Node for testing.

const WORKLET_PATH = path.join(
  process.cwd(),
  'public',
  'soundtouch-worklet.js',
);

type Ctor = new () => {
  port: {onmessage: ((event: {data: unknown}) => void) | null};
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, number[]>,
  ): boolean;
};

function loadWorklet(sampleRate: number): Ctor {
  let captured: Ctor | undefined;

  class AudioWorkletProcessor {
    port: {
      onmessage: ((event: {data: unknown}) => void) | null;
      postMessage: () => void;
    };
    constructor() {
      this.port = {
        onmessage: null,
        postMessage() {},
      };
    }
  }

  const sandbox: Record<string, unknown> = {
    AudioWorkletProcessor,
    registerProcessor: (_name: string, cls: Ctor) => {
      captured = cls;
    },
    sampleRate,
    CustomEvent: class CustomEvent {},
    console,
  };
  sandbox['globalThis'] = sandbox;

  const context = vm.createContext(sandbox);
  const code = fs.readFileSync(WORKLET_PATH, 'utf8');
  vm.runInContext(code, context, {filename: WORKLET_PATH});

  if (!captured) {
    throw new Error('registerProcessor was never called by the worklet');
  }
  return captured;
}

// Deterministic LCG so the test signal never depends on Math.random().
function makeLcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff - 0.5;
  };
}

/**
 * Music-like deterministic test signal: two sine partials (fundamental +
 * harmonic) plus broadband noise, with a short percussive transient burst
 * every 0.5s so cross-correlation has real structure to lock onto.
 */
function buildTestSignal(sampleRate: number, durationSeconds: number) {
  const lcg = makeLcg(0xc0ffee);
  const n = Math.floor(sampleRate * durationSeconds);
  const x = new Float32Array(n);
  // The transient-burst-only component (env(t)*noise), isolated from the
  // periodic tonal content. Used as a matched-filter template: the 98/196Hz
  // sines are stationary and periodic, so correlating against the raw
  // signal is ambiguous (any shift by a multiple of the sine period scores
  // similarly); this aperiodic component is not, so it unambiguously
  // pinpoints where a given burst ends up after time-stretching.
  const burstOnly = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const beat = t % 0.5;
    const env = beat < 0.04 ? Math.exp(-beat * 80) * 0.8 : 0;
    const ambientNoise = 0.05 * lcg();
    const burstSample = env * lcg();
    burstOnly[i] = burstSample;
    x[i] =
      0.25 * Math.sin(2 * Math.PI * 98 * t) +
      0.12 * Math.sin(2 * Math.PI * 196 * t + 0.5) +
      ambientNoise +
      burstSample;
  }
  return {x, burstOnly};
}

const QUANTUM = 128;
const SAMPLE_RATE = 48000;

function makeParams(
  rate: number,
  tempo: number,
  pitch: number,
  pitchSemitones: number,
) {
  return {
    rate: [rate],
    tempo: [tempo],
    pitch: [pitch],
    pitchSemitones: [pitchSemitones],
  };
}

function normalizedCrossCorrelation(
  a: Float32Array,
  aOffset: number,
  b: Float32Array,
  bOffset: number,
  length: number,
): number {
  let corr = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    const av = a[aOffset + i] ?? 0;
    const bv = b[bOffset + i] ?? 0;
    corr += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const denom = Math.sqrt(normA * normB);
  return denom < 1e-9 ? 0 : corr / denom;
}

/** Feeds `input` through a fresh worklet instance in 128-frame quanta. */
function runWorklet(
  Worklet: Ctor,
  input: Float32Array,
  params: Record<string, number[]>,
  opts?: {
    clearAfterFrame?: number;
    onAfterProcess?: (frameIndex: number, instance: InstanceType<Ctor>) => void;
  },
) {
  const instance = new Worklet();
  const output = new Float32Array(input.length);
  const outputR = new Float32Array(input.length);
  let clearSent = false;

  for (let start = 0; start < input.length; start += QUANTUM) {
    const len = Math.min(QUANTUM, input.length - start);
    const inL = new Float32Array(QUANTUM);
    const inR = new Float32Array(QUANTUM);
    for (let i = 0; i < len; i++) {
      inL[i] = input[start + i];
      inR[i] = input[start + i];
    }
    const outL = new Float32Array(QUANTUM);
    const outR = new Float32Array(QUANTUM);

    if (
      opts?.clearAfterFrame !== undefined &&
      !clearSent &&
      start >= opts.clearAfterFrame
    ) {
      clearSent = true;
      instance.port.onmessage?.({data: {type: 'clear'}});
    }

    instance.process([[inL, inR]], [[outL, outR]], params);

    for (let i = 0; i < len; i++) {
      output[start + i] = outL[i];
      outputR[start + i] = outR[i];
    }
    opts?.onAfterProcess?.(start, instance);
  }

  return {left: output, right: outputR, instance};
}

/**
 * Feeds `input` through a fresh worklet instance at a fixed `rate=1`, tempo
 * possibly != 1, producing `desiredOutputSamples` of *collected* output.
 *
 * `AudioWorkletProcessor.process()` always pairs exactly one input quantum
 * with one output quantum per call. But `Stretch`'s own consume:produce
 * ratio is `tempo:1` (see `Stretch.process()`'s `nominalSkip`), not `1:1` —
 * so at tempo > 1 the algorithm needs *more* input per output than a
 * strict 1:1 push-driven feed can supply, and it will run the input FIFO
 * dry, forcing permanent silence-padding on a large fraction of output
 * regardless of the algorithm's correctness (confirmed by instrumenting
 * `_pipe.inputBuffer`/`outputBuffer` while feeding at a literal 1:1 rate).
 * This mismatch is exactly why production (`lib/preview/audioManager.ts`,
 * "Option B") never runs the worklet at `rate=1` for `tempo != 1`; it
 * changes playback speed at the source instead, feeding `rate=1/tempo` so
 * the transposer and stretch stages' throughputs cancel out to 1:1.
 *
 * To test `Stretch`'s alignment behavior in isolation at a fixed `rate=1`
 * (as this suite is asked to), we emulate adequate read-ahead the same way
 * a pull-based caller (using `inputChunkSize`/`outputChunkSize`) would:
 * for tempo > 1, interleave extra "priming" calls that feed real input but
 * whose output is discarded, keeping the internal FIFOs topped up so the
 * *official*, collected output stream never underruns.
 */
function runWorkletWithReadAhead(
  Worklet: Ctor,
  input: Float32Array,
  tempo: number,
  desiredOutputSamples: number,
) {
  const instance = new Worklet();
  const params = makeParams(1, tempo, 1, 0);
  const output = new Float32Array(desiredOutputSamples);
  let inPos = 0;
  let outPos = 0;
  let primingDebt = 0;

  function feedOnce(collect: boolean) {
    const inL = new Float32Array(QUANTUM);
    const inR = new Float32Array(QUANTUM);
    for (let i = 0; i < QUANTUM && inPos + i < input.length; i++) {
      inL[i] = input[inPos + i];
      inR[i] = input[inPos + i];
    }
    inPos += QUANTUM;
    const outL = new Float32Array(QUANTUM);
    const outR = new Float32Array(QUANTUM);
    instance.process([[inL, inR]], [[outL, outR]], params);
    if (collect) {
      for (let i = 0; i < QUANTUM && outPos + i < output.length; i++) {
        output[outPos + i] = outL[i];
      }
      outPos += QUANTUM;
    }
  }

  // Cap total input reads generously so a bug can't spin this forever.
  const maxInputReads = input.length * 4;
  while (outPos < desiredOutputSamples && inPos < maxInputReads) {
    if (tempo > 1) {
      primingDebt += tempo - 1;
      while (primingDebt >= 1) {
        feedOnce(false);
        primingDebt -= 1;
      }
    }
    feedOnce(true);
  }

  return output;
}

describe('soundtouch-worklet.js', () => {
  test('neutral params produce exact bit-transparent pass-through', () => {
    const Worklet = loadWorklet(SAMPLE_RATE);
    const {x: input} = buildTestSignal(SAMPLE_RATE, 1);
    const {left} = runWorklet(Worklet, input, makeParams(1, 1, 1, 0));

    for (let i = 0; i < input.length; i++) {
      expect(left[i]).toBe(input[i]);
    }
  });

  describe('stretch alignment stability', () => {
    const cases: Array<{tempo: number; label: string}> = [
      {tempo: 0.8, label: 'tempo 0.8 (slower)'},
      {tempo: 1.25, label: 'tempo 1.25 (faster)'},
    ];

    for (const {tempo, label} of cases) {
      test(label, () => {
        const Worklet = loadWorklet(SAMPLE_RATE);
        const durationSeconds = 10;
        const {x: input, burstOnly} = buildTestSignal(
          SAMPLE_RATE,
          durationSeconds,
        );
        const output = runWorkletWithReadAhead(
          Worklet,
          input,
          tempo,
          input.length,
        );

        // The 98/196Hz tonal content is strictly periodic (~490-sample
        // period at 48kHz), so naive block cross-correlation against the
        // raw input/output is ambiguous: shifting a candidate by any
        // multiple of that period reproduces a near-identical score. That
        // ambiguity is a property of this *signal*, not of the stretch
        // algorithm. Instead, use each beat's known, aperiodic burst-only
        // waveform (isolated at generation time, before mixing with the
        // sines) as a matched-filter template and correlate it directly
        // against the output: this pinpoints where that unique burst ended
        // up, independent of the surrounding tonal content, and checks it
        // against where the tempo mapping predicts it should land.
        const beatIntervalSamples = 0.5 * SAMPLE_RATE;
        const templateLength = 2400; // covers the ~1920-sample burst decay
        const searchRadius = 10000;
        const skipStart = 2 * SAMPLE_RATE;
        // The burst is a small, noise-like component mixed under much
        // louder stationary tones, so even a correct match tops out well
        // below the 1.0 a full-signal match would reach. Beats where the
        // best candidate doesn't clear this floor are too ambiguous to
        // trust and are excluded from the jump-stability measurement below
        // (mirroring the original ">0.85 on a clean signal" idea, just
        // recalibrated to what this template's SNR can actually achieve).
        const confidenceThreshold = 0.1;

        const alignmentErrorsSamples: number[] = [];
        const confidentAlignmentErrorsSamples: number[] = [];
        let totalBeats = 0;

        for (
          let inBeatPos = 0;
          inBeatPos + templateLength < input.length;
          inBeatPos += beatIntervalSamples
        ) {
          const expectedOutPos = Math.round(inBeatPos / tempo);
          if (
            expectedOutPos < skipStart ||
            expectedOutPos + searchRadius + templateLength >= output.length ||
            expectedOutPos - searchRadius < 0
          ) {
            continue;
          }
          totalBeats++;

          const template = burstOnly.subarray(
            inBeatPos,
            inBeatPos + templateLength,
          );
          let bestCorr = -Infinity;
          let bestPos = expectedOutPos;
          for (let delta = -searchRadius; delta <= searchRadius; delta += 1) {
            const candidatePos = expectedOutPos + delta;
            const corr = normalizedCrossCorrelation(
              output,
              candidatePos,
              template,
              0,
              templateLength,
            );
            if (corr > bestCorr) {
              bestCorr = corr;
              bestPos = candidatePos;
            }
          }

          const errorSamples = bestPos - expectedOutPos;
          alignmentErrorsSamples.push(errorSamples);
          if (bestCorr > confidenceThreshold) {
            confidentAlignmentErrorsSamples.push(errorSamples);
          }
          if (process.env['DEBUG_ALIGN']) {
            // eslint-disable-next-line no-console
            console.log(
              JSON.stringify({
                inBeatPos,
                expectedOutPos,
                bestPos,
                bestCorr,
                errorSamples,
              }),
            );
          }
        }

        expect(totalBeats).toBeGreaterThan(5);

        // A healthy majority of beats should find a confident match.
        expect(
          confidentAlignmentErrorsSamples.length / totalBeats,
        ).toBeGreaterThan(0.7);

        // Block-to-block change in alignment error should stay small and
        // bounded, i.e. the timeline should progress smoothly rather than
        // teleporting from one beat to the next.
        let maxJumpSamples = 0;
        for (let i = 1; i < confidentAlignmentErrorsSamples.length; i++) {
          const jump = Math.abs(
            confidentAlignmentErrorsSamples[i] -
              confidentAlignmentErrorsSamples[i - 1],
          );
          maxJumpSamples = Math.max(maxJumpSamples, jump);
        }
        const maxJumpMs = (maxJumpSamples / SAMPLE_RATE) * 1000;

        if (process.env['DEBUG_ALIGN']) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify({
              alignmentErrorsSamples,
              confidentAlignmentErrorsSamples,
              maxJumpMs,
            }),
          );
        }

        // Before the cross-correlation normalization fix, timeline jumps of
        // 200-300ms were routinely observed at these tempos. After the fix
        // jumps should be dramatically tighter; require comfortably under
        // that with margin, and never more than 30ms.
        expect(maxJumpMs).toBeLessThanOrEqual(30);
      });
    }
  });

  test("'clear' message drops queued audio and restores immediate pass-through", () => {
    const Worklet = loadWorklet(SAMPLE_RATE);
    const instance = new Worklet();

    // Feed several seconds of non-neutral (stretched) audio to fill the
    // internal FIFOs with queued pre-seek audio.
    const {x: primeInput} = buildTestSignal(SAMPLE_RATE, 2);
    const stretchParams = makeParams(1, 0.8, 1, 0);
    for (let start = 0; start < primeInput.length; start += QUANTUM) {
      const inL = new Float32Array(QUANTUM);
      const inR = new Float32Array(QUANTUM);
      for (let i = 0; i < QUANTUM && start + i < primeInput.length; i++) {
        inL[i] = primeInput[start + i];
        inR[i] = primeInput[start + i];
      }
      const outL = new Float32Array(QUANTUM);
      const outR = new Float32Array(QUANTUM);
      instance.process([[inL, inR]], [[outL, outR]], stretchParams);
    }

    const pipe = (
      instance as unknown as {
        _pipe: {
          inputBuffer: {frameCount: number};
          outputBuffer: {frameCount: number};
        };
      }
    )._pipe;

    // Sanity check: after feeding stretched audio, the pipe has buffered
    // data pending (otherwise the 'clear' assertion below would be
    // vacuous).
    expect(
      pipe.inputBuffer.frameCount > 0 || pipe.outputBuffer.frameCount > 0,
    ).toBe(true);

    expect(instance.port.onmessage).toBeTruthy();
    instance.port.onmessage!({data: {type: 'clear'}});

    expect(pipe.inputBuffer.frameCount).toBe(0);
    expect(pipe.outputBuffer.frameCount).toBe(0);

    // A malformed message must be a no-op and not throw.
    expect(() => instance.port.onmessage!({data: null})).not.toThrow();
    expect(() =>
      instance.port.onmessage!({data: {type: 'not-clear'}}),
    ).not.toThrow();

    // With FIFOs empty, neutral-param processing should immediately be a
    // direct pass-through again.
    const inL = new Float32Array(QUANTUM);
    const inR = new Float32Array(QUANTUM);
    for (let i = 0; i < QUANTUM; i++) {
      inL[i] = Math.sin(i * 0.1);
      inR[i] = Math.sin(i * 0.1);
    }
    const outL = new Float32Array(QUANTUM);
    const outR = new Float32Array(QUANTUM);
    instance.process([[inL, inR]], [[outL, outR]], makeParams(1, 1, 1, 0));

    for (let i = 0; i < QUANTUM; i++) {
      expect(outL[i]).toBe(inL[i]);
      expect(outR[i]).toBe(inR[i]);
    }
  });

  test('underrun: early quanta before the pipeline primes are silent, never NaN', () => {
    const Worklet = loadWorklet(SAMPLE_RATE);
    const {x: input} = buildTestSignal(SAMPLE_RATE, 1);
    const instance = new Worklet();
    const stretchParams = makeParams(1, 0.8, 1, 0);

    const firstInL = new Float32Array(QUANTUM);
    const firstInR = new Float32Array(QUANTUM);
    for (let i = 0; i < QUANTUM; i++) {
      firstInL[i] = input[i];
      firstInR[i] = input[i];
    }
    const firstOutL = new Float32Array(QUANTUM);
    const firstOutR = new Float32Array(QUANTUM);
    instance.process(
      [[firstInL, firstInR]],
      [[firstOutL, firstOutR]],
      stretchParams,
    );

    // First quantum: pipeline has not produced any output yet, so it must
    // be all zeros (not stale/garbage buffer contents).
    for (let i = 0; i < QUANTUM; i++) {
      expect(firstOutL[i]).toBe(0);
      expect(firstOutR[i]).toBe(0);
    }

    // Continue feeding through the ~110ms priming window (sequence +
    // seekwindow + overlap) and assert no NaNs ever appear in the output.
    const primeFrames = Math.ceil(SAMPLE_RATE * 0.15); // ~150ms, comfortable margin
    for (let start = QUANTUM; start < primeFrames; start += QUANTUM) {
      const inL = new Float32Array(QUANTUM);
      const inR = new Float32Array(QUANTUM);
      for (let i = 0; i < QUANTUM && start + i < input.length; i++) {
        inL[i] = input[start + i];
        inR[i] = input[start + i];
      }
      const outL = new Float32Array(QUANTUM);
      const outR = new Float32Array(QUANTUM);
      instance.process([[inL, inR]], [[outL, outR]], stretchParams);

      for (let i = 0; i < QUANTUM; i++) {
        expect(Number.isNaN(outL[i])).toBe(false);
        expect(Number.isNaN(outR[i])).toBe(false);
      }
    }
  });
});
