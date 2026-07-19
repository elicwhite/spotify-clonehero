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
import type {LinkSegSections} from '@/lib/tempo-map/types';

// Hosted on R2 like the other models; the local public/models copy is a dev fallback.
const LINKSEG_MODEL_URL =
  'https://assets.musiccharts.tools/models/linkseg_7c.onnx';
const LINKSEG_CACHE_KEY = 'linkseg_7c_v1.onnx';
const LINKSEG_MIN_BYTES = 1_000_000; // real size ~1.5 MB
const LINKSEG_DEV_URL = '/models/linkseg_7c.onnx';

// Recall-favoring operating point (msa-adoption-analysis): tau=0 -> ~66% boundary recall, mild
// benign over-segmentation (extra markers snap to bar-lines). Config constant so UX can tune it.
export const LINKSEG_TAU = 0;

// Minimum beats for a meaningful graph (build_linkseg_cache errors below this).
const MIN_BEATS = 4;

// 7-class functional labels -> product-facing section names. `silence` has no direct product
// name: it's relabeled/merged away in mapAndMerge before this map is applied to it, so it's
// never looked up here.
const LABEL_NAMES: Record<string, string> = {
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

/** Map raw 7-class labels to product names, resolve `silence` (never a product-facing name —
 * leading silence becomes "Intro", any other silence is absorbed into the preceding segment),
 * and drop boundaries between identically-labeled segments (benign over-segmentation from
 * tau=0). Returns S+1 times / S labels. Exported for unit testing. */
export function mapAndMerge(raw: LinkSegSections): LinkSegSections {
  type Seg = {name: string; start: number; end: number};
  const segs: Seg[] = [];
  for (let i = 0; i < raw.labels.length; i++) {
    const label = raw.labels[i];
    const start = raw.times[i];
    const end = raw.times[i + 1];
    if (label === 'silence') {
      if (segs.length === 0) {
        // Leading silence (or a wholly-silent song) reads as "Intro" rather than nothing.
        segs.push({name: 'Intro', start, end});
      } else {
        // Absorb into the preceding segment: no marker, no label, for this silence.
        segs[segs.length - 1].end = end;
      }
    } else {
      segs.push({name: LABEL_NAMES[label] ?? label, start, end});
    }
  }

  const times: number[] = segs.length > 0 ? [segs[0].start] : [raw.times[0]];
  const labels: string[] = [];
  for (const seg of segs) {
    if (labels.length > 0 && seg.name === labels[labels.length - 1]) {
      // merge into previous segment: extend by moving its right edge forward
      times[times.length - 1] = seg.end;
    } else {
      labels.push(seg.name);
      times.push(seg.end);
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

  const {beatTimes: processedBeats, windows} = buildLinkSegWindows(
    beatTimes,
    wave22k,
  );
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
