import type * as Ort from 'onnxruntime-web';

export type GuitarReductionTier = 'hard' | 'medium' | 'easy';

export interface GuitarModelOutput {
  classes?: number[];
  kind: 'classifier' | 'regressor';
  lane?: number;
  section?: number;
}

export interface GuitarTierManifest {
  features_width: number;
  mask_features_width: number;
  section_features_width: number;
  mask_classes: number[];
  onnx: string;
  outputs: Record<string, GuitarModelOutput>;
}

export interface GuitarReductionManifest {
  artifact: string;
  decoder_constants: {
    lane_bits: Record<string, number>;
    lanes: string[];
    mask_cost: number[][];
    phrase_blend: number;
    phrase_min_occurrences: number;
    range_names: string[];
    sequence_pool_width: number;
    techniques: Record<string, number>;
  };
  pipeline: {
    feature_variant: string;
    mask_decoder: string;
    range_variant: string;
    sequence_pool_alpha: number;
    sequence_pool_variant: string;
    sustain_constraint: string;
    sustain_variant: string;
    technique_cleanup: string;
    technique_variant: string;
  };
  phrase_dictionary: {
    medium: {
      active: boolean;
      entries?: number;
      path?: string;
      version?: number;
    };
  };
  tiers: Record<GuitarReductionTier, GuitarTierManifest>;
}

export interface MediumPhraseDictionary {
  version: number;
  width: number;
  rhythm: boolean;
  normalized: boolean;
  entries: Array<{
    key: number[];
    occurrences: number;
    counts: number[][];
  }>;
}

export interface GuitarTierRun {
  rows: number;
  outputs: Record<string, {data: Float32Array; dims: readonly number[]}>;
}

export interface GuitarReductionRuntime {
  manifest: GuitarReductionManifest;
  mediumPhraseDictionary: MediumPhraseDictionary;
  runTier(
    tier: GuitarReductionTier,
    features: Float32Array,
    maskFeatures: Float32Array,
    sectionFeatures: Float32Array,
    rows: number,
    anchors: number,
  ): Promise<GuitarTierRun>;
}

const MODEL_ROOT =
  'https://assets.musiccharts.tools/models/guitar-reduction-v1';
const ORT_WASM_ROOT =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

let runtimePromise: Promise<GuitarReductionRuntime> | null = null;

export function loadGuitarReductionRuntime(
  onProgress?: (message: string) => void,
): Promise<GuitarReductionRuntime> {
  runtimePromise ??= createRuntime(onProgress).catch(error => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

async function createRuntime(
  onProgress?: (message: string) => void,
): Promise<GuitarReductionRuntime> {
  // The runtime is memoized and shared by every instrument that reduces
  // through these graphs, so its progress copy names no instrument.
  onProgress?.('Loading difficulty reduction manifest…');
  const [manifest, mediumPhraseDictionary] = await Promise.all([
    fetchJson<GuitarReductionManifest>(`${MODEL_ROOT}/manifest.json`),
    fetchJson<MediumPhraseDictionary>(
      `${MODEL_ROOT}/medium_phrase_dictionary.json`,
    ),
  ]);
  const ort = await import('onnxruntime-web');
  ort.env.wasm.wasmPaths = ORT_WASM_ROOT;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = 'error';

  const sessions = new Map<GuitarReductionTier, Ort.InferenceSession>();
  for (const tier of ['hard', 'medium', 'easy'] as const) {
    onProgress?.(`Loading ${tier} difficulty reduction model…`);
    sessions.set(
      tier,
      await createSession(ort, `${MODEL_ROOT}/${manifest.tiers[tier].onnx}`),
    );
  }

  return {
    manifest,
    mediumPhraseDictionary,
    async runTier(
      tier,
      features,
      maskFeatures,
      sectionFeatures,
      rows,
      anchors,
    ) {
      const meta = manifest.tiers[tier];
      const session = sessions.get(tier);
      if (!session) throw new Error(`Missing ${tier} reduction session`);
      const output = await session.run({
        features: new ort.Tensor('float32', features, [
          rows,
          meta.features_width,
        ]),
        mask_features: new ort.Tensor('float32', maskFeatures, [
          rows,
          meta.mask_features_width,
        ]),
        section_features: new ort.Tensor('float32', sectionFeatures, [
          anchors,
          meta.section_features_width,
        ]),
      });
      const outputs: GuitarTierRun['outputs'] = {};
      for (const [name, tensor] of Object.entries(output)) {
        outputs[name] = {
          data: Float32Array.from(tensor.data as Float32Array),
          dims: tensor.dims,
        };
        tensor.dispose();
      }
      return {rows, outputs};
    },
  };
}

async function createSession(
  ort: typeof import('onnxruntime-web'),
  url: string,
): Promise<Ort.InferenceSession> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Guitar reduction model request failed (${response.status})`,
    );
  }
  const model = new Uint8Array(await response.arrayBuffer());
  try {
    return await ort.InferenceSession.create(model, {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'all',
    });
  } catch (webGpuError) {
    console.warn(
      'WebGPU guitar reduction session failed; retrying with WASM',
      webGpuError,
    );
    return ort.InferenceSession.create(model, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {cache: 'force-cache'});
  if (!response.ok)
    throw new Error(
      `Guitar reduction asset request failed (${response.status})`,
    );
  return (await response.json()) as T;
}
