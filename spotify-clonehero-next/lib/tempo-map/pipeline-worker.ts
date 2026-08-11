/**
 * Web worker running the full tempo-mapping pipeline:
 *
 *   stereo PCM (any rate)
 *     ├─ S1  bs-roformer fp16 (WebGPU) → drum stem 44.1k stereo
 *     │       ├─ S3  Beat This! (WASM fp32) on drum-stem mono mixdown
 *     │       └─ S2b spectral-flux drum-onset offset
 *     ├─ S2  Beat This! (WASM fp32) on full mix
 *     └─ S4  beatsToSynctrack
 *
 * Fidelity decisions inherited from the proven POC:
 *   - libsoxr WASM for all resampling (Web Audio's resampler is too lossy).
 *   - Beat This! runs on the wasm EP — the WebGPU EP silently computes this
 *     transformer in fp16 and drifts logits ~1 unit vs Python.
 *   - bs-roformer stays on WebGPU (fp16 stem drift is accepted).
 */

import * as ort from 'onnxruntime-web';
import {getCachedModel} from '@/lib/lyrics-align/model-cache';
import {
  BEAT_THIS_CACHE_KEY,
  BEAT_THIS_MIN_BYTES,
  BEAT_THIS_MODEL_URL,
  ROFORMER_CACHE_KEY,
  ROFORMER_MIN_BYTES,
  ROFORMER_MODEL_URL,
} from './models';
import {resampleSoxr, initSoxr} from './resampler-soxr';
import {separateDrumStem} from './stem-separation';
import {
  computeLogMel,
  resampleToBeatThis,
  BEAT_THIS_SAMPLE_RATE,
} from './beat-this-mel';
import {runBeatThisOnnx} from './beat-this-onnx';
import {runPostprocessor} from './beat-this-pp';
import {computeDrumOnsetOffsetMs} from './drum-onset';
import {
  loadStem,
  storeStem,
  stereoStemToMono,
  type StereoStem,
} from '@/lib/audio-pipeline/stem-cache';
import {uniqueBuffers} from '@/lib/workers/transfer';
import {beatsToSynctrack, PL_LSQ_TOL_MS_DEFAULT} from './converter';
import {computeMeterStats} from './meter-confidence';
import {
  loadLinkSegSession,
  runLinkSegSections,
} from '@/lib/section-names/linkseg-run';
import type {
  LinkSegSections,
  PipelineProgress,
  PipelineRunRequest,
  PipelineWorkerMessage,
  Synctrack,
} from './types';

const ORT_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

const SEPARATION_SAMPLE_RATE = 44100;

function post(msg: PipelineWorkerMessage, transfer?: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, {transfer: transfer ?? []});
}

function progress(p: PipelineProgress) {
  post({type: 'progress', ...p});
}

/** Parse "Downloading <label> 123/336 MB (37%)" log lines from
 * getCachedModel into structured progress. */
function downloadProgressAdapter(stage: PipelineProgress['stage']) {
  return (msg: string) => {
    const m = msg.match(/(\d+)\/(\d+) MB \((\d+)%\)/);
    if (m) {
      progress({
        stage,
        percent: parseInt(m[3], 10) / 100,
        detail: `${m[1]} / ${m[2]} MB`,
      });
    } else {
      progress({stage, detail: msg});
    }
  };
}

// --- stages ---------------------------------------------------------------

/** Resample the request's PCM to the rate the separator and both beat passes
 *  work at. Returns the request's own buffers untouched when it already is. */
async function resampleToSeparationRate(
  req: PipelineRunRequest,
): Promise<{left: Float32Array; right: Float32Array}> {
  if (req.sampleRate === SEPARATION_SAMPLE_RATE) {
    return {left: req.left, right: req.right};
  }
  const [left, right] = await Promise.all([
    resampleSoxr(req.left, req.sampleRate, SEPARATION_SAMPLE_RATE),
    resampleSoxr(req.right, req.sampleRate, SEPARATION_SAMPLE_RATE),
  ]);
  return {left, right};
}

function monoMixdown(left: Float32Array, right: Float32Array): Float32Array {
  const mono = new Float32Array(left.length);
  for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) * 0.5;
  return mono;
}

/**
 * S1: the drum stem, from whichever source has one — supplied by the caller,
 * the OPFS cache, or a fresh BS-Roformer separation. Planar stereo
 * throughout: CRNN transcription (drum-transcription/pipeline/tempo-track.ts)
 * consumes the stereo stem from the result, so every source must surface it.
 * Only the tempo-map path calls this; LinkSeg needs nothing from the drums.
 */
async function obtainDrumStem(
  req: PipelineRunRequest,
  left: Float32Array,
  right: Float32Array,
): Promise<StereoStem> {
  const N = left.length;
  if (
    req.drumStemStereo &&
    Math.min(
      req.drumStemStereo.left.length,
      req.drumStemStereo.right.length,
    ) === N
  ) {
    // Caller already separated the drums (drum-transcription pipeline):
    // skip BS-Roformer entirely. Seed the OPFS cache so a later standalone
    // /tempo run on the same file also cache-hits.
    progress({
      stage: 'separate',
      percent: 1,
      detail: 'Reused drums from transcription',
    });
    if (req.fingerprint)
      await storeStem(req.fingerprint, 'drums', req.drumStemStereo);
    return req.drumStemStereo;
  }

  if (req.fingerprint) {
    const cached = await loadStem(req.fingerprint, 'drums');
    if (cached) {
      progress({
        stage: 'separate',
        percent: 1,
        detail: 'Reused drums from a previous run',
      });
      return cached;
    }
  }

  progress({stage: 'download-separation-model'});
  const roformerBytes = await getCachedModel(
    ROFORMER_MODEL_URL,
    ROFORMER_CACHE_KEY,
    downloadProgressAdapter('download-separation-model'),
    ROFORMER_MIN_BYTES,
    'drum separator',
  );
  progress({stage: 'download-separation-model', percent: 1});

  const roformerSession = await ort.InferenceSession.create(
    new Uint8Array(roformerBytes),
    {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'disabled',
    },
  );

  progress({stage: 'separate', percent: 0});
  let separated: StereoStem;
  try {
    separated = await separateDrumStem({
      ort,
      left,
      right,
      session: roformerSession,
      output: 'stereo',
      onProgress: ({segment, totalSegments, etaSec}) => {
        progress({
          stage: 'separate',
          percent: segment / totalSegments,
          etaSeconds: etaSec,
        });
      },
    });
  } finally {
    await roformerSession.release();
  }
  if (req.fingerprint) await storeStem(req.fingerprint, 'drums', separated);
  return separated;
}

/** One Beat This! pass over a mono signal: resample, mel, ONNX, DBN
 *  postprocessor. */
async function runBeatThisPass(
  session: ort.InferenceSession,
  monoPcm: Float32Array,
  sr: number,
  stage: 'beats-fullmix' | 'beats-drums',
) {
  progress({stage, percent: 0});
  const mono22k = await resampleToBeatThis(monoPcm, sr);
  const {mel, T} = computeLogMel(mono22k);
  const {beatLogits, downbeatLogits} = await runBeatThisOnnx({
    ort,
    session,
    mel,
    T,
    onChunk: (done, total) => progress({stage, percent: done / total}),
  });
  const audioSeconds = mono22k.length / BEAT_THIS_SAMPLE_RATE;
  const fps = T / audioSeconds;
  const pp = runPostprocessor({beatLogits, downbeatLogits, fps});
  return {pp, beatLogits, fps, mono22k, audioSeconds};
}

type BeatPass = Awaited<ReturnType<typeof runBeatThisPass>>;

/** Download/create the Beat This! session, run `fn` against it, release it.
 *  Both the full-mix and drum-stem passes share one session. */
async function withBeatThisSession<T>(
  fn: (session: ort.InferenceSession) => Promise<T>,
): Promise<T> {
  progress({stage: 'download-beat-model'});
  const beatThisBytes = await getCachedModel(
    BEAT_THIS_MODEL_URL,
    BEAT_THIS_CACHE_KEY,
    downloadProgressAdapter('download-beat-model'),
    BEAT_THIS_MIN_BYTES,
    'beat tracker',
  );
  progress({stage: 'download-beat-model', percent: 1});
  const session = await ort.InferenceSession.create(
    new Uint8Array(beatThisBytes),
    {executionProviders: ['wasm'], graphOptimizationLevel: 'all'},
  );
  try {
    return await fn(session);
  } finally {
    await session.release();
  }
}

/** S3b: LinkSeg functional section labels, from a beat grid and the 22.05 kHz
 *  full mix. The beats normally come from the full-mix Beat This! pass, but
 *  LinkSeg is robust to its beat source, so a caller with a grid of its own
 *  (the chart's tempo map) supplies them instead. Section labeling is a
 *  nice-to-have; a failure yields null rather than failing the whole run. */
async function labelSections(input: {
  beatTimes: number[];
  mono22k: Float32Array;
  audioSeconds: number;
}): Promise<LinkSegSections | null> {
  try {
    progress({stage: 'sections', percent: 0});
    const linksegSession = await loadLinkSegSession(ort, m =>
      progress({stage: 'sections', detail: m}),
    );
    try {
      const sections = await runLinkSegSections({
        session: linksegSession,
        ortTensor: ort.Tensor,
        beatTimes: input.beatTimes,
        wave22k: input.mono22k,
        duration: input.audioSeconds,
      });
      progress({stage: 'sections', percent: 1});
      return sections;
    } finally {
      await linksegSession.release();
    }
  } catch (err) {
    console.warn(
      'LinkSeg section labeling failed; continuing without labels:',
      err,
    );
    return null;
  }
}

/** S2b + S4: the drum-onset offset and the beats → synctrack converter. */
function buildTempoMap(
  fm: BeatPass,
  ds: BeatPass,
  drumStem: Float32Array,
): {synctrack: Synctrack; drumOnsetOffsetMs: number | null} {
  progress({stage: 'convert'});
  const drumOnsetOffsetMs = computeDrumOnsetOffsetMs({
    drumStemPcm: drumStem,
    sr: SEPARATION_SAMPLE_RATE,
    ppFmBeatsSec: fm.pp.beats,
  });

  // ds median IOI (consumed by OCTAVE_FIX)
  let dsIoiMs: number | null = null;
  if (ds.pp.beats.length >= 4) {
    const iois: number[] = [];
    for (let i = 1; i < ds.pp.beats.length; i++) {
      iois.push((ds.pp.beats[i] - ds.pp.beats[i - 1]) * 1000);
    }
    iois.sort((a, b) => a - b);
    dsIoiMs = iois[Math.floor(iois.length / 2)];
  }

  const synctrack = beatsToSynctrack({
    beats: fm.pp.beats,
    downbeats: fm.pp.downbeats,
    beatLogits: fm.beatLogits,
    fps: fm.fps,
    drumStemPpIoiMs: dsIoiMs,
    drumOnsetOffsetMs,
    drumPpBeatsSec: ds.pp.beats,
    // PL_LSQ (banked drum-to-chart keep 83d432d, 2026-07-02): sparse
    // jitter-averaged tempo maps — ~6x fewer tempo events AND better
    // alignment than the per-beat map. Golden fixtures pin the per-beat
    // behavior, so this is opt-in here rather than a converter default.
    plLsqTolMs: PL_LSQ_TOL_MS_DEFAULT,
  });
  if (!synctrack) {
    throw new Error(
      "Couldn't detect enough beats in this audio to build a tempo map.",
    );
  }
  return {synctrack, drumOnsetOffsetMs};
}

// --- pipeline ------------------------------------------------------------

/** The LinkSeg inputs a completed beat pass carries. */
function beatPassSectionInput(fm: BeatPass) {
  return {
    beatTimes: fm.pp.beats,
    mono22k: fm.mono22k,
    audioSeconds: fm.audioSeconds,
  };
}

/** A sections-only run: full-mix beats, then LinkSeg. No separation, no
 *  drum-stem beat pass, no converter — and no grid in the result.
 *
 * A caller that already has a beat grid (the chart's own tempo map) supplies
 * it, and then the run skips the beat model download and the beat pass too:
 * all that remains is the 22.05 kHz mono mix LinkSeg's mel windows read. */
async function runSections(req: PipelineRunRequest) {
  if (req.beatTimes && req.beatTimes.length > 0) {
    const mono22k = await resampleToBeatThis(
      monoMixdown(req.left, req.right),
      req.sampleRate,
    );
    post({
      type: 'result',
      result: {
        kind: 'sections',
        sections: await labelSections({
          beatTimes: req.beatTimes,
          mono22k,
          audioSeconds: mono22k.length / BEAT_THIS_SAMPLE_RATE,
        }),
        fullMixBeatCount: req.beatTimes.length,
        // Supplied beats carry no downbeats, so there is no meter to measure.
        meterStats: null,
      },
    });
    return;
  }

  const {left, right} = await resampleToSeparationRate(req);
  const fm = await withBeatThisSession(session =>
    runBeatThisPass(
      session,
      monoMixdown(left, right),
      SEPARATION_SAMPLE_RATE,
      'beats-fullmix',
    ),
  );
  post({
    type: 'result',
    result: {
      kind: 'sections',
      sections: await labelSections(beatPassSectionInput(fm)),
      fullMixBeatCount: fm.pp.beats.length,
      meterStats: computeMeterStats(fm.pp.beats, fm.pp.downbeats),
    },
  });
}

/** A tempo-map run, optionally also labeling sections off the same full-mix
 *  beat pass. */
async function runTempoMap(req: PipelineRunRequest, withSections: boolean) {
  const {left, right} = await resampleToSeparationRate(req);
  const drumStemStereo = await obtainDrumStem(req, left, right);
  const drumStem = stereoStemToMono(drumStemStereo);

  const {fm, ds} = await withBeatThisSession(async session => ({
    fm: await runBeatThisPass(
      session,
      monoMixdown(left, right),
      SEPARATION_SAMPLE_RATE,
      'beats-fullmix',
    ),
    ds: await runBeatThisPass(
      session,
      drumStem,
      SEPARATION_SAMPLE_RATE,
      'beats-drums',
    ),
  }));

  const sections = withSections
    ? await labelSections(beatPassSectionInput(fm))
    : null;
  const {synctrack, drumOnsetOffsetMs} = buildTempoMap(fm, ds, drumStem);

  post(
    {
      type: 'result',
      result: {
        kind: 'tempo-map',
        synctrack,
        sections,
        drumOnsetOffsetMs,
        fullMixBeatCount: fm.pp.beats.length,
        drumStemBeatCount: ds.pp.beats.length,
        meterStats: computeMeterStats(fm.pp.beats, fm.pp.downbeats),
        drumStemStereo,
      },
    },
    // A cache-hit stem's channels are two views over ONE packed buffer, and
    // `uniqueBuffers` is what keeps it out of the transfer list twice.
    uniqueBuffers(drumStemStereo.left, drumStemStereo.right),
  );
}

async function run(req: PipelineRunRequest) {
  ort.env.wasm.wasmPaths = ORT_WASM_CDN;
  // Multi-threading would require nested pthread workers, which fails inside
  // a bundled web worker; same constraint as the Demucs worker.
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = 'error';

  void initSoxr();

  if (req.kind === 'sections') return runSections(req);
  return runTempoMap(req, req.kind === 'tempo-map+sections');
}

self.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as PipelineRunRequest;
  if (msg.type === 'run') {
    run(msg).catch(err => {
      post({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }
});
