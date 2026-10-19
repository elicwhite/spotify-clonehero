import {noteFlags, noteTypes} from '@eliwhite/scan-chart';
import type {ParsedChart} from '@/lib/preview/chorus-chart-processing';
import type {Note, Track} from '@/lib/preview/highway/types';
import {
  buildGuitarFeatureContext,
  featureMatrix,
  GUITAR_LANE_BITS,
  GUITAR_LANES,
  laneIndexForNoteType,
  sectionFeatureTensor,
  tickToMs,
  type GuitarFeatureContext,
} from './features';
import {
  loadGuitarReductionRuntime,
  type GuitarReductionRuntime,
  type GuitarReductionTier,
  type GuitarTierManifest,
  type GuitarTierRun,
} from './onnx';
import {GUITAR_DIFFICULTIES, type GuitarDifficulty} from './snapshot';

export type ReducedGuitarDifficulty = Exclude<GuitarDifficulty, 'expert'>;
export type ReducedGuitarTracks = Record<GuitarDifficulty, Track>;

export interface GuitarReductionProgress {
  message: string;
}

export interface GuitarReductionOptions {
  /** Instrument name for user-facing progress copy. The reduction graphs are
   *  instrument agnostic — bass runs the identical models — so the label is
   *  presentation only and never reaches the ONNX layer. Defaults to
   *  `'guitar'`. */
  instrumentLabel?: string;
}

const REDUCED_DIFFICULTIES: ReducedGuitarDifficulty[] = [
  'hard',
  'medium',
  'easy',
];

/**
 * Run the promoted e101baa guitar reducer in the browser.
 *
 * Feature construction and decoding intentionally live beside the ONNX
 * session wrapper. The model only supplies learned probabilities; all chart
 * semantics and serialization remain deterministic JavaScript.
 */
export async function reduceGuitarDifficulties(
  chart: ParsedChart,
  expertTrack: Track,
  onProgress?: (progress: GuitarReductionProgress) => void,
  options?: GuitarReductionOptions,
): Promise<ReducedGuitarTracks> {
  const instrumentLabel = options?.instrumentLabel ?? 'guitar';
  const context = buildGuitarFeatureContext(chart, expertTrack);
  if (context.ticks.length === 0) {
    throw new Error(
      `The Expert ${instrumentLabel} track does not contain any notes.`,
    );
  }

  const runtime = await loadGuitarReductionRuntime(message =>
    onProgress?.({message}),
  );
  const sectionFeatures = sectionFeatureTensor(context);
  // ORT-WASM has a single global runtime heap. Running the three sessions in
  // parallel can race that heap on larger local charts (surfacing as
  // "Session already started" or "memory access out of bounds"). Keep the
  // deterministic tier order and run one graph at a time.
  const runs: Array<readonly [ReducedGuitarDifficulty, GuitarTierRun]> = [];
  for (const tier of REDUCED_DIFFICULTIES) {
    onProgress?.({message: `Reducing ${instrumentLabel} to ${tier}…`});
    const features = featureMatrix(context, tier);
    runs.push([
      tier,
      await runtime.runTier(
        tier,
        features,
        features,
        sectionFeatures,
        context.ticks.length,
        context.anchors.length,
      ),
    ]);
  }

  const tracks = {} as ReducedGuitarTracks;
  tracks.expert = expertTrack;
  for (const [tier, run] of runs) {
    tracks[tier] = decodeTier(chart, expertTrack, context, runtime, tier, run);
  }
  return tracks;
}

function decodeTier(
  chart: ParsedChart,
  expertTrack: Track,
  context: GuitarFeatureContext,
  runtime: GuitarReductionRuntime,
  tier: GuitarReductionTier,
  run: GuitarTierRun,
): Track {
  const meta = runtime.manifest.tiers[tier];
  const probability = expandMaskProbabilities(run, meta, context.ticks.length);
  poolRepeatedPhrases(
    probability,
    context.expertMasks,
    context.ticks,
    context.resolution,
    runtime.manifest.decoder_constants.sequence_pool_width,
    runtime.manifest.pipeline.sequence_pool_alpha,
  );
  if (tier === 'medium' && runtime.mediumPhraseDictionary) {
    applyPhraseDictionary(
      probability,
      context.expertMasks,
      context.ticks,
      context.resolution,
      runtime.mediumPhraseDictionary,
      runtime.manifest.decoder_constants.phrase_min_occurrences,
      runtime.manifest.decoder_constants.phrase_blend,
    );
  }

  const masks = probability.map(row =>
    decodeExpectedMask(row, runtime.manifest.decoder_constants.mask_cost),
  );
  const techniques = decodeTechniques(
    run,
    meta,
    masks,
    context.ticks.length,
    runtime.manifest.decoder_constants.techniques,
    tier,
  );
  const sustains = decodeSustains(
    run,
    meta,
    tier,
    masks,
    context.ticks,
    context.resolution,
    context.ticks.length,
  );
  const sections = decodeSections(run, meta, context.anchors.length);

  return toTrack(
    chart,
    expertTrack,
    context,
    tier,
    masks,
    techniques,
    sustains,
    sections,
  );
}

function expandMaskProbabilities(
  run: GuitarTierRun,
  meta: GuitarTierManifest,
  rows: number,
): number[][] {
  const output = run.outputs['mask_probs'];
  if (!output) throw new Error('Guitar reduction model omitted mask_probs');
  const classes = meta.outputs['mask_probs'].classes ?? meta.mask_classes;
  const width = tensorWidth(output, classes.length);
  const probability = Array.from({length: rows}, () =>
    Array<number>(32).fill(0),
  );
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < classes.length; column++) {
      probability[row][classes[column]] =
        output.data[row * width + column] ?? 0;
    }
  }
  return probability;
}

function decodeTechniques(
  run: GuitarTierRun,
  meta: GuitarTierManifest,
  masks: number[],
  rows: number,
  techniqueCodes: Record<string, number>,
  tier: GuitarReductionTier,
): number[][] {
  const techniques = Array.from({length: rows}, () =>
    Array<number>(GUITAR_LANES.length).fill(techniqueCodes['strum'] ?? 1),
  );
  for (let lane = 0; lane < GUITAR_LANES.length; lane++) {
    const name = `technique_${lane}_probs`;
    const output = run.outputs[name];
    const spec = meta.outputs[name];
    if (!output || !spec?.classes) continue;
    for (let row = 0; row < rows; row++) {
      techniques[row][lane] = decodeClass(output, spec.classes, row);
    }
  }

  const sharedName = 'shared_technique_probs';
  const sharedOutput = run.outputs[sharedName];
  const sharedSpec = meta.outputs[sharedName];
  if (sharedOutput && sharedSpec?.classes) {
    for (let row = 0; row < rows; row++) {
      if (bitCount(masks[row]) > 1) {
        const code = decodeClass(sharedOutput, sharedSpec.classes, row);
        techniques[row].fill(code);
      }
    }
  }

  if (tier === 'medium' || tier === 'easy') {
    for (let row = 0; row < rows; row++) {
      if (masks[row] !== 0) techniques[row].fill(techniqueCodes['strum'] ?? 1);
    }
  } else {
    const activeRows = masks
      .map((mask, row) => (mask !== 0 ? row : -1))
      .filter(row => row >= 0);
    for (let i = 1; i < activeRows.length; i++) {
      const previous = activeRows[i - 1];
      const current = activeRows[i];
      if (highestLane(masks[previous]) !== highestLane(masks[current])) {
        continue;
      }
      for (let lane = 0; lane < GUITAR_LANES.length; lane++) {
        if (
          masks[current] & GUITAR_LANE_BITS[lane] &&
          techniques[current][lane] === (techniqueCodes['hopo'] ?? 2)
        ) {
          techniques[current][lane] = techniqueCodes['strum'] ?? 1;
        }
      }
    }
  }
  return techniques;
}

function decodeSustains(
  run: GuitarTierRun,
  meta: GuitarTierManifest,
  tier: GuitarReductionTier,
  masks: number[],
  ticks: number[],
  resolution: number,
  rows: number,
): number[][] {
  const sustains = Array.from({length: rows}, () =>
    Array<number>(GUITAR_LANES.length).fill(0),
  );
  const maxLog = Math.log1p(64 * 480);
  for (let lane = 0; lane < GUITAR_LANES.length; lane++) {
    const lengthOutput = run.outputs[`sustain_log_${lane}`];
    const presenceName = `sustain_presence_${lane}_probs`;
    const presenceOutput = run.outputs[presenceName];
    const presenceSpec = meta.outputs[presenceName];
    for (let row = 0; row < rows; row++) {
      const logLength = Math.max(
        0,
        Math.min(maxLog, lengthOutput ? rowValue(lengthOutput, row) : 0),
      );
      let length = Math.round(Math.expm1(logLength));
      if (
        presenceOutput &&
        presenceSpec?.classes &&
        decodeClass(presenceOutput, presenceSpec.classes, row) !== 1
      ) {
        length = 0;
      }
      sustains[row][lane] = length;
    }
  }

  for (let lane = 0; lane < GUITAR_LANES.length; lane++) {
    const activeRows = masks
      .map((mask, row) => (mask & GUITAR_LANE_BITS[lane] ? row : -1))
      .filter(row => row >= 0);
    for (let i = 0; i + 1 < activeRows.length; i++) {
      const left = activeRows[i];
      const right = activeRows[i + 1];
      sustains[left][lane] = Math.min(
        sustains[left][lane],
        Math.max(0, ticks[right] - ticks[left]),
      );
    }
  }
  if (tier === 'medium' || tier === 'easy') {
    const activeRows = masks
      .map((mask, row) => (mask !== 0 ? row : -1))
      .filter(row => row >= 0);
    for (let i = 0; i + 1 < activeRows.length; i++) {
      const left = activeRows[i];
      const right = activeRows[i + 1];
      const room = Math.max(0, ticks[right] - ticks[left] - resolution);
      for (let lane = 0; lane < GUITAR_LANES.length; lane++) {
        if (masks[left] & GUITAR_LANE_BITS[lane]) {
          sustains[left][lane] = Math.min(sustains[left][lane], room);
        }
      }
    }
  }
  return sustains;
}

function decodeSections(
  run: GuitarTierRun,
  meta: GuitarTierManifest,
  anchors: number,
): boolean[][] {
  return Array.from({length: anchors}, (_, row) =>
    Array.from({length: 5}, (_, section) => {
      const name = `section_${section}_probs`;
      const output = run.outputs[name];
      const spec = meta.outputs[name];
      return Boolean(
        output && spec?.classes && decodeClass(output, spec.classes, row) === 1,
      );
    }),
  );
}

function toTrack(
  chart: ParsedChart,
  expertTrack: Track,
  context: GuitarFeatureContext,
  tier: GuitarReductionTier,
  masks: number[],
  techniques: number[][],
  sustains: number[][],
  sections: boolean[][],
): Track {
  const noteEventGroups = context.ticks.flatMap((tick, row) => {
    const sourceNotes = context.expertNotesByTick.get(tick) ?? [];
    const group: Note[] = [];
    for (let lane = 0; lane < GUITAR_LANES.length; lane++) {
      if (!(masks[row] & GUITAR_LANE_BITS[lane])) continue;
      const source = sourceNotes.find(
        note => laneIndexForNoteType(note.type) === lane,
      );
      const length = Math.max(0, sustains[row][lane]);
      const msTime = source?.msTime ?? tickToMs(chart, tick);
      group.push({
        ...(source ?? {
          tick,
          length: 0,
          msTime,
          msLength: 0,
          flags: 0,
          type: noteTypes.green,
        }),
        tick,
        length,
        msTime,
        msLength: Math.max(0, tickToMs(chart, tick + length) - msTime),
        type: laneNoteType(lane),
        flags: withTechnique(source?.flags ?? 0, techniques[row][lane]),
      });
    }
    return group.length ? [group] : [];
  });

  return {
    ...expertTrack,
    difficulty: tier,
    noteEventGroups,
    starPowerSections: decodeRanges(
      chart,
      context.anchors,
      sections.map(row => row[0]),
    ),
    rejectedStarPowerSections: decodeRanges(
      chart,
      context.anchors,
      sections.map(row => row[1]),
    ),
    soloSections: decodeRanges(
      chart,
      context.anchors,
      sections.map(row => row[2]),
    ),
    flexLanes: decodeFlexRanges(
      chart,
      context.anchors,
      sections.map(row => row[3]),
      sections.map(row => row[4]),
    ),
    drumFreestyleSections: expertTrack.drumFreestyleSections.map(section => ({
      ...section,
    })),
    textEvents: expertTrack.textEvents.map(event => ({...event})),
    versusPhrases: expertTrack.versusPhrases.map(phrase => ({...phrase})),
    animations: expertTrack.animations.map(animation => ({...animation})),
    unrecognizedMidiEvents: [...expertTrack.unrecognizedMidiEvents],
  };
}

function decodeRanges(
  chart: ParsedChart,
  anchors: number[],
  positive: boolean[],
): Track['starPowerSections'] {
  return decodeBooleanIntervals(anchors, positive, chart.resolution).map(
    ({tick, length}) => ({
      tick,
      length,
      msTime: tickToMs(chart, tick),
      msLength: Math.max(
        0,
        tickToMs(chart, tick + length) - tickToMs(chart, tick),
      ),
    }),
  );
}

function decodeFlexRanges(
  chart: ParsedChart,
  anchors: number[],
  positive: boolean[],
  doubles: boolean[],
): Track['flexLanes'] {
  return decodeBooleanIntervals(anchors, positive, chart.resolution).map(
    ({tick, length, start}) => ({
      tick,
      length,
      isDouble: doubles[start] ?? false,
      msTime: tickToMs(chart, tick),
      msLength: Math.max(
        0,
        tickToMs(chart, tick + length) - tickToMs(chart, tick),
      ),
    }),
  );
}

function decodeBooleanIntervals(
  anchors: number[],
  positive: boolean[],
  resolution: number,
): Array<{tick: number; length: number; start: number}> {
  const intervals: Array<{tick: number; length: number; start: number}> = [];
  let start: number | null = null;
  for (let i = 0; i < positive.length; i++) {
    if (positive[i] && start === null) start = i;
    if (start !== null && (!positive[i] || i === positive.length - 1)) {
      const endIndex = !positive[i] ? i : i + 1;
      const end =
        endIndex < anchors.length ? anchors[endIndex] : anchors[i] + resolution;
      const tick = anchors[start];
      if (end > tick) intervals.push({tick, length: end - tick, start});
      start = null;
    }
  }
  return intervals;
}

function decodeClass(
  output: {data: Float32Array; dims: readonly number[]},
  classes: number[],
  row: number,
): number {
  const width = tensorWidth(output, classes.length);
  let bestIndex = 0;
  let bestProbability = Number.NEGATIVE_INFINITY;
  for (let column = 0; column < classes.length; column++) {
    const probability = output.data[row * width + column] ?? 0;
    if (probability > bestProbability) {
      bestProbability = probability;
      bestIndex = column;
    }
  }
  return classes[bestIndex] ?? 0;
}

function decodeExpectedMask(probability: number[], cost: number[][]): number {
  let best = 0;
  let bestRisk = Number.POSITIVE_INFINITY;
  for (let candidate = 0; candidate < 32; candidate++) {
    let risk = 0;
    for (let target = 0; target < 32; target++) {
      risk += probability[target] * cost[candidate][target];
    }
    if (risk < bestRisk) {
      bestRisk = risk;
      best = candidate;
    }
  }
  return best;
}

function rowValue(
  output: {data: Float32Array; dims: readonly number[]},
  row: number,
): number {
  return output.data[row * tensorWidth(output, 1)] ?? 0;
}

function tensorWidth(
  output: {dims: readonly number[]},
  fallback: number,
): number {
  return output.dims.length >= 2 ? (output.dims.at(-1) ?? fallback) : 1;
}

function poolRepeatedPhrases(
  probability: number[][],
  expertMasks: number[],
  ticks: number[],
  resolution: number,
  width: number,
  alpha: number,
): void {
  if (width <= 0 || ticks.length < width) return;
  const quantizedIoi = [0];
  for (let i = 1; i < ticks.length; i++) {
    quantizedIoi.push(
      roundHalfEven(((ticks[i] - ticks[i - 1]) / resolution) * 16),
    );
  }
  const groups = new Map<string, number[]>();
  for (let start = 0; start <= ticks.length - width; start++) {
    const key = phraseKey(expertMasks, quantizedIoi, start, width, true);
    groups.set(key, [...(groups.get(key) ?? []), start]);
  }
  const suggestions = new Map<number, number[][]>();
  for (const starts of groups.values()) {
    const usable: number[] = [];
    for (const start of starts) {
      if (usable.every(previous => Math.abs(start - previous) >= width)) {
        usable.push(start);
      }
    }
    if (usable.length < 2) continue;
    for (let offset = 0; offset < width; offset++) {
      const mean = Array.from(
        {length: 32},
        (_, target) =>
          usable.reduce(
            (sum, start) => sum + probability[start + offset][target],
            0,
          ) / usable.length,
      );
      for (const start of usable) {
        suggestions.set(start + offset, [
          ...(suggestions.get(start + offset) ?? []),
          mean,
        ]);
      }
    }
  }
  for (const [row, values] of suggestions) {
    const pooled = Array.from(
      {length: 32},
      (_, target) =>
        values.reduce((sum, value) => sum + value[target], 0) / values.length,
    );
    for (let target = 0; target < 32; target++) {
      probability[row][target] =
        (1 - alpha) * probability[row][target] + alpha * pooled[target];
    }
  }
}

function applyPhraseDictionary(
  probability: number[][],
  expertMasks: number[],
  ticks: number[],
  resolution: number,
  dictionary: {
    width: number;
    rhythm: boolean;
    entries: Array<{key: number[]; occurrences: number; counts: number[][]}>;
  },
  minimumOccurrences: number,
  blend: number,
): void {
  const quantizedIoi = [0];
  for (let i = 1; i < ticks.length; i++) {
    quantizedIoi.push(
      roundHalfEven(((ticks[i] - ticks[i - 1]) / resolution) * 16),
    );
  }
  const entries = new Map(
    dictionary.entries.map(entry => [entry.key.join(','), entry]),
  );
  const sums = Array.from({length: probability.length}, () =>
    Array<number>(32).fill(0),
  );
  const suggestions = Array<number>(probability.length).fill(0);
  for (let start = 0; start <= ticks.length - dictionary.width; start++) {
    const key = phraseKey(
      expertMasks,
      quantizedIoi,
      start,
      dictionary.width,
      dictionary.rhythm,
    );
    const entry = entries.get(key);
    if (!entry || entry.occurrences < minimumOccurrences) continue;
    for (let offset = 0; offset < dictionary.width; offset++) {
      const counts = entry.counts[offset];
      const total = Math.max(
        1,
        counts.reduce((sum, count) => sum + count, 0),
      );
      for (let target = 0; target < 32; target++) {
        sums[start + offset][target] += counts[target] / total;
      }
      suggestions[start + offset]++;
    }
  }
  for (let row = 0; row < probability.length; row++) {
    if (!suggestions[row]) continue;
    for (let target = 0; target < 32; target++) {
      const phrase = sums[row][target] / suggestions[row];
      probability[row][target] =
        (1 - blend) * probability[row][target] + blend * phrase;
    }
  }
}

function phraseKey(
  masks: number[],
  quantizedIoi: number[],
  start: number,
  width: number,
  rhythm: boolean,
): string {
  const key = masks.slice(start, start + width);
  if (rhythm) key.push(...quantizedIoi.slice(start + 1, start + width));
  return key.join(',');
}

function toTrackTechniqueFlag(code: number): number {
  if (code === 2) return noteFlags.hopo;
  if (code === 3) return noteFlags.tap;
  return noteFlags.strum;
}

function withTechnique(flags: number, code: number): number {
  const techniqueFlags = noteFlags.strum | noteFlags.hopo | noteFlags.tap;
  return (flags & ~techniqueFlags) | toTrackTechniqueFlag(code);
}

function laneNoteType(lane: number): Note['type'] {
  return [
    noteTypes.green,
    noteTypes.red,
    noteTypes.yellow,
    noteTypes.blue,
    noteTypes.orange,
  ][lane] as Note['type'];
}

function bitCount(value: number): number {
  let count = 0;
  for (let bit = value & 31; bit; bit &= bit - 1) count++;
  return count;
}

function highestLane(mask: number): number {
  return mask ? 31 - Math.clz32(mask & 31) : -1;
}

function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction < 0.5) return floor;
  if (fraction > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export {GUITAR_DIFFICULTIES};
