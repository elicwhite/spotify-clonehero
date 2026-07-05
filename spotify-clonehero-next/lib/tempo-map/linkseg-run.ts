// LinkSeg section-labeling stage: run the in-browser byte-exact port (mel front-end in JS,
// dense-tensor ONNX model via onnxruntime-web) and decode functional sections.
//
// Validated byte-exact against the Python DGL model end-to-end (dense==DGL <6e-6; python-ort
// decodes 40/40 songs identically; ort-web WASM+WebGPU decode identically in-browser; full
// JS-mel chain reproduces the cached sections exactly). See analysis/linkseg_eval/port in the
// drum-to-chart repo for the validation ladder.

import type * as OrtNS from 'onnxruntime-web';
import {getCachedModel} from '@/lib/lyrics-align/model-cache';
import {buildLinkSegWindows} from './linkseg-windows';
import {melForWindows, LINKSEG_N_MELS, LINKSEG_MEL_FRAMES} from './linkseg-mel';
import {linksegDecode, LINKSEG_LABELS} from './linkseg-decode';
import type {LinkSegSections} from './types';

// Hosted on R2 like the other models; the local public/models copy is a dev fallback.
const LINKSEG_MODEL_URL = 'https://assets.musiccharts.tools/models/linkseg_7c.onnx';
const LINKSEG_CACHE_KEY = 'linkseg_7c_v1.onnx';
const LINKSEG_MIN_BYTES = 1_000_000; // real size ~1.5 MB
const LINKSEG_DEV_URL = '/models/linkseg_7c.onnx';

// Recall-favoring operating point (msa-adoption-analysis): tau=0 -> ~66% boundary recall, mild
// benign over-segmentation (extra markers snap to bar-lines). Config constant so UX can tune it.
export const LINKSEG_TAU = 0;

// Minimum beats for a meaningful graph (build_linkseg_cache errors below this).
const MIN_BEATS = 4;

// 7-class functional labels -> product-facing section names.
const LABEL_NAMES: Record<string, string> = {
  silence: 'Silence',
  verse: 'Verse',
  chorus: 'Chorus',
  intro: 'Intro',
  outro: 'Outro',
  inst: 'Instrumental',
  bridge: 'Bridge',
};

export async function loadLinkSegSession(
  ort: typeof OrtNS,
  onProgress?: (msg: string) => void,
): Promise<OrtNS.InferenceSession> {
  let bytes: ArrayBuffer;
  try {
    bytes = await getCachedModel(
      LINKSEG_MODEL_URL,
      LINKSEG_CACHE_KEY,
      m => onProgress?.(m),
      LINKSEG_MIN_BYTES,
      'section labeler',
    );
  } catch (e) {
    // Dev fallback: same-origin public/models (gitignored, never deploys).
    const r = await fetch(new URL(LINKSEG_DEV_URL, self.location.origin));
    if (!r.ok) throw e;
    bytes = await r.arrayBuffer();
  }
  // WebGPU computes this model in fp32 and tracks Python tightly (unlike Beat This!, which drifts
  // in fp16 -> wasm-only); WebGPU is also 4-11x faster. Both decode identically, so auto-fallback
  // to wasm is safe.
  return ort.InferenceSession.create(new Uint8Array(bytes), {
    executionProviders: ['webgpu', 'wasm'],
    graphOptimizationLevel: 'all',
  });
}

/** Map raw 7-class labels to product names and drop boundaries between identically-labeled
 * segments (benign over-segmentation from tau=0). Returns S+1 times / S labels. */
function mapAndMerge(raw: LinkSegSections): LinkSegSections {
  const names = raw.labels.map(l => LABEL_NAMES[l] ?? l);
  const times: number[] = [raw.times[0]];
  const labels: string[] = [];
  for (let i = 0; i < names.length; i++) {
    if (labels.length > 0 && names[i] === labels[labels.length - 1]) {
      // merge into previous segment: extend by moving its right edge forward
      times[times.length - 1] = raw.times[i + 1];
    } else {
      labels.push(names[i]);
      times.push(raw.times[i + 1]);
    }
  }
  return {times, labels};
}

/**
 * Run LinkSeg on the full-mix 22.05k audio + Beat This! beats, returning functional sections.
 * Returns null when there are too few beats to build a graph.
 */
export async function runLinkSegSections(opts: {
  session: OrtNS.InferenceSession;
  ortTensor: typeof OrtNS.Tensor;
  beatTimes: number[];
  wave22k: Float32Array;
  duration: number;
}): Promise<LinkSegSections | null> {
  const {session, ortTensor, beatTimes, wave22k, duration} = opts;
  if (beatTimes.length < MIN_BEATS) return null;

  const {beatTimes: processedBeats, windows} = buildLinkSegWindows(beatTimes, wave22k);
  if (windows.length < MIN_BEATS) return null;

  const mel = melForWindows(windows);
  const melT = new ortTensor('float32', mel, [
    windows.length,
    1,
    LINKSEG_N_MELS,
    LINKSEG_MEL_FRAMES,
  ]);
  const out = await session.run({mel: melT});
  const bound = out['bound'].data as Float32Array;
  const label = out['label'].data as Float32Array;

  const raw = linksegDecode(
    bound,
    label,
    processedBeats,
    duration,
    Object.keys(LINKSEG_LABELS).length,
    8,
    8,
    LINKSEG_TAU,
  );
  return mapAndMerge(raw);
}
