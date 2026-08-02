import {noteFlags, noteTypes} from '@eliwhite/scan-chart';
import type {ParsedChart} from '@/lib/preview/chorus-chart-processing';
import type {Note, Track} from '@/lib/preview/highway/types';

export const GUITAR_LANES = [
  'green',
  'red',
  'yellow',
  'blue',
  'orange',
] as const;

export type GuitarLane = (typeof GUITAR_LANES)[number];

export const GUITAR_LANE_BITS = [1, 2, 4, 8, 16] as const;

const LANE_NOTE_TYPES = [
  noteTypes.green,
  noteTypes.red,
  noteTypes.yellow,
  noteTypes.blue,
  noteTypes.orange,
] as const;

const BIT_COUNTS = Array.from(
  {length: 32},
  (_, mask) => mask.toString(2).split('1').length - 1,
);

export interface GuitarFeatureContext {
  ticks: number[];
  anchors: number[];
  expertMasks: number[];
  expertLengths: number[][];
  expertTechniques: number[][];
  expertNotesByTick: Map<number, Note[]>;
  expertNotesByTickLane: Map<string, Note>;
  baseFeatures: number[][];
  sectionFeatures: number[][];
  resolution: number;
}

/** Build the exact 40-column Expert/source-context rows from scan-chart data. */
export function buildGuitarFeatureContext(
  chart: ParsedChart,
  expertTrack: Track,
): GuitarFeatureContext {
  const resolution = Math.max(1, chart.resolution);
  const expertNotesByTick = new Map<number, Note[]>();
  const expertNotesByTickLane = new Map<string, Note>();

  for (const group of expertTrack.noteEventGroups) {
    const tick = group[0]?.tick;
    if (tick == null) continue;
    const notes = expertNotesByTick.get(tick) ?? [];
    notes.push(...group);
    expertNotesByTick.set(tick, notes);
    for (const note of group) {
      const lane = laneIndexForNoteType(note.type);
      if (lane !== null) {
        expertNotesByTickLane.set(`${tick}:${lane}`, note);
      }
    }
  }

  const ticks = [...expertNotesByTick.keys()].sort((a, b) => a - b);
  const anchors = sourceAnchors(chart, expertTrack, ticks);
  const maxTick = Math.max(
    1,
    ...[...expertNotesByTick.values()]
      .flat()
      .map(note => note.tick + Math.max(0, note.length)),
  );

  const expertMasks = ticks.map(tick =>
    maskForNotes(expertNotesByTick.get(tick) ?? []),
  );
  const expertLengths = ticks.map(tick =>
    GUITAR_LANES.map(
      (_, lane) => expertNotesByTickLane.get(`${tick}:${lane}`)?.length ?? 0,
    ),
  );
  const expertTechniques = ticks.map(tick =>
    GUITAR_LANES.map((_, lane) => {
      const note = expertNotesByTickLane.get(`${tick}:${lane}`);
      return note ? techniqueCode(note.flags) : 0;
    }),
  );

  const baseFeatures = anchors.map(tick =>
    baseFeatureRow({
      chart,
      expertTrack,
      expertNotesByTick,
      ticks,
      tick,
      resolution,
      maxTick,
    }),
  );
  const tickFeatures = ticks.map(tick =>
    baseFeatureRow({
      chart,
      expertTrack,
      expertNotesByTick,
      ticks,
      tick,
      resolution,
      maxTick,
    }),
  );

  return {
    ticks,
    anchors,
    expertMasks,
    expertLengths,
    expertTechniques,
    expertNotesByTick,
    expertNotesByTickLane,
    baseFeatures: tickFeatures,
    sectionFeatures: baseFeatures,
    resolution,
  };
}

export function featureMatrix(
  context: GuitarFeatureContext,
  tier: 'hard' | 'medium' | 'easy',
): Float32Array {
  const neighbors = neighborFeatures(context.expertMasks);
  const rows = context.baseFeatures.map((base, row) => {
    const neighbor = neighbors[row];
    if (tier !== 'easy') return [...base, ...neighbor];
    return [...base, ...neighbor, ...priorityFeatures(context, row)];
  });
  return Float32Array.from(rows.flat());
}

export function sectionFeatureTensor(
  context: GuitarFeatureContext,
): Float32Array {
  return Float32Array.from(context.sectionFeatures.flat());
}

export function maskForNotes(notes: readonly Note[]): number {
  let mask = 0;
  for (const note of notes) {
    const lane = laneIndexForNoteType(note.type);
    if (lane !== null) mask |= GUITAR_LANE_BITS[lane];
  }
  return mask;
}

export function laneIndexForNoteType(type: number): number | null {
  const lane = LANE_NOTE_TYPES.indexOf(
    type as (typeof LANE_NOTE_TYPES)[number],
  );
  return lane === -1 ? null : lane;
}

export function techniqueCode(flags: number): number {
  if (flags & noteFlags.tap) return 3;
  if (flags & noteFlags.hopo) return 2;
  if (flags & noteFlags.strum) return 1;
  return 0;
}

export function tickToMs(chart: ParsedChart, tick: number): number {
  const tempos = chart.tempos.length
    ? [...chart.tempos].sort((a, b) => a.tick - b.tick)
    : [{tick: 0, beatsPerMinute: 120, msTime: 0}];
  let tempo = tempos[0];
  for (const candidate of tempos) {
    if (candidate.tick > tick) break;
    tempo = candidate;
  }
  return (
    tempo.msTime +
    ((tick - tempo.tick) * 60000) /
      (Math.max(1, tempo.beatsPerMinute) * Math.max(1, chart.resolution))
  );
}

function sourceAnchors(
  chart: ParsedChart,
  expertTrack: Track,
  expertTicks: number[],
): number[] {
  const anchors = new Set(expertTicks);
  for (const section of [
    ...expertTrack.starPowerSections,
    ...expertTrack.rejectedStarPowerSections,
    ...expertTrack.soloSections,
    ...expertTrack.flexLanes,
  ]) {
    anchors.add(section.tick);
    anchors.add(section.tick + section.length);
  }
  for (const tempo of chart.tempos) anchors.add(tempo.tick);
  for (const meter of chart.timeSignatures) anchors.add(meter.tick);
  for (const section of chart.sections) anchors.add(section.tick);
  return [...anchors].sort((a, b) => a - b);
}

function baseFeatureRow(args: {
  chart: ParsedChart;
  expertTrack: Track;
  expertNotesByTick: Map<number, Note[]>;
  ticks: number[];
  tick: number;
  resolution: number;
  maxTick: number;
}): number[] {
  const {
    chart,
    expertTrack,
    expertNotesByTick,
    ticks,
    tick,
    resolution,
    maxTick,
  } = args;
  const notes = expertNotesByTick.get(tick) ?? [];
  const mask = maskForNotes(notes);
  const previousIndex = lowerBound(ticks, tick) - 1;
  const nextIndex = upperBound(ticks, tick);
  const previousTick = previousIndex >= 0 ? ticks[previousIndex] : tick;
  const nextTick = nextIndex < ticks.length ? ticks[nextIndex] : tick;
  const meter = meterAt(chart, tick);
  const beatTicks = (resolution * 4) / meter.denominator;
  const barTicks = beatTicks * meter.numerator;
  const phase =
    positiveModulo(tick - meter.tick, Math.max(beatTicks, 1)) /
    Math.max(beatTicks, 1);
  const barPhase =
    positiveModulo(tick - meter.tick, Math.max(barTicks, 1)) /
    Math.max(barTicks, 1);
  const laneIndices = notes
    .map(note => laneIndexForNoteType(note.type))
    .filter((lane): lane is number => lane !== null);
  const minLane = laneIndices.length ? Math.min(...laneIndices) : -1;
  const maxLane = laneIndices.length ? Math.max(...laneIndices) : -1;
  const localDensity = [
    resolution / 2,
    resolution,
    resolution * 2,
    resolution * 4,
  ].map(radius => {
    const lo = lowerBound(ticks, tick - radius);
    const hi = upperBound(ticks, tick + radius);
    return (hi - lo) / Math.max((radius / resolution) * 2, 1);
  });

  return [
    mask / 31,
    maskAt(expertNotesByTick, previousTick) / 31,
    maskAt(expertNotesByTick, nextTick) / 31,
    notes.length / 5,
    minLane >= 0 ? (maxLane - minLane) / 4 : 0,
    (minLane + 1) / 5,
    (maxLane + 1) / 5,
    (tick - previousTick) / resolution,
    (nextTick - tick) / resolution,
    tick / maxTick,
    tempoAt(chart, tick) / 200,
    meter.numerator / 16,
    meter.denominator / 16,
    phase,
    barPhase,
    (tick - meter.tick) / resolution,
    intervalContains(expertTrack.starPowerSections, tick) ? 1 : 0,
    intervalContains(expertTrack.rejectedStarPowerSections, tick) ? 1 : 0,
    intervalContains(expertTrack.soloSections, tick) ? 1 : 0,
    intervalContains(expertTrack.flexLanes, tick) ? 1 : 0,
    expertTrack.flexLanes.filter(
      section =>
        section.isDouble &&
        section.tick <= tick &&
        tick < section.tick + section.length,
    ).length,
    ...localDensity,
    ...GUITAR_LANES.flatMap((_, lane) => {
      const note = notes.find(
        candidate => laneIndexForNoteType(candidate.type) === lane,
      );
      return [
        note ? 1 : 0,
        note ? note.length / resolution : 0,
        note ? techniqueCode(note.flags) / 3 : 0,
      ];
    }),
  ];
}

function neighborFeatures(masks: number[]): number[][] {
  const previous = shift(masks, -1);
  const following = shift(masks, 1);
  const previous2 = shift(masks, -2);
  const following2 = shift(masks, 2);
  return masks.map((current, i) => {
    const p2 = previous2[i];
    const p = previous[i];
    const n = following[i];
    const n2 = following2[i];
    const pc = BIT_COUNTS[p];
    const cc = BIT_COUNTS[current];
    const nc = BIT_COUNTS[n];
    return [
      bitCount(p & current) / 5,
      bitCount(current & n) / 5,
      bitCount(p | current) / 5,
      bitCount(current | n) / 5,
      bitCount(p & current) / Math.max(bitCount(p | current), 1),
      bitCount(current & n) / Math.max(bitCount(current | n), 1),
      bitCount(p ^ current) / 5,
      bitCount(current ^ n) / 5,
      bitCount(current & ~p) / 5,
      bitCount(p & ~current) / 5,
      bitCount(n & ~current) / 5,
      bitCount(current & ~n) / 5,
      current === p ? 1 : 0,
      current === n ? 1 : 0,
      (cc - pc) / 5,
      (nc - cc) / 5,
      ((p2 !== p ? 1 : 0) +
        (p !== current ? 1 : 0) +
        (current !== n ? 1 : 0) +
        (n !== n2 ? 1 : 0)) /
        4,
      bitCount(p2 ^ current) / 5,
      bitCount(current ^ n2) / 5,
      p === n ? 1 : 0,
    ];
  });
}

function priorityFeatures(
  context: GuitarFeatureContext,
  row: number,
): number[] {
  const base = context.baseFeatures[row];
  const masks = context.expertMasks;
  const previousMasks = shift(masks, -1);
  const resolution = Math.max(1, context.resolution);
  const tolerance = 20 / resolution;
  const meterPosition = base[15];
  const numerator = Math.max(base[11] * 16, 1);
  const denominator = Math.max(base[12] * 16, 1);
  const barLength = (numerator * 4) / denominator;
  const remainder = positiveModulo(meterPosition, barLength);
  const barDistance = Math.min(remainder, barLength - remainder);
  const previousIoi = Math.max(base[7], 0);
  const nextIoi = Math.max(base[8], 0);
  const lengths = context.expertLengths[row].map(length => length / resolution);
  const sustainedLanes = lengths.filter(length => length > 0).length;
  const meanSustain =
    lengths.reduce((sum, length) => sum + length, 0) /
    Math.max(sustainedLanes, 1);
  const values = [
    base[16],
    sustainedLanes > 0 ? 1 : 0,
    sustainedLanes / 5,
    Math.max(...lengths),
    meanSustain,
    Math.min(barDistance, 4),
    barDistance <= tolerance ? 1 : 0,
    Math.log2(Math.max(previousIoi, 1 / 64)),
    Math.log2(Math.max(nextIoi, 1 / 64)),
    Math.min(previousIoi, nextIoi),
    Math.max(previousIoi, nextIoi),
    masks[row] === previousMasks[row] ? 1 : 0,
  ];
  for (const spacing of [0.25, 0.5, 1, 2]) {
    const phase = positiveModulo(meterPosition, spacing);
    const gridDistance = Math.min(phase, spacing - phase);
    const aligned = gridDistance <= tolerance;
    values.push(
      Math.min(gridDistance / spacing, 0.5),
      aligned ? 1 : 0,
      previousIoi + tolerance >= spacing ? 1 : 0,
      nextIoi + tolerance >= spacing ? 1 : 0,
      aligned || previousIoi + tolerance >= spacing ? 1 : 0,
      masks[row] === previousMasks[row] &&
        previousIoi + tolerance >= spacing / 2
        ? 1
        : 0,
    );
  }
  return values;
}

function shift(values: number[], offset: number): number[] {
  if (values.length === 0 || offset === 0) return [...values];
  const out = new Array<number>(values.length);
  if (offset < 0) {
    const width = Math.min(-offset, values.length);
    for (let i = 0; i < width; i++) out[i] = values[0];
    for (let i = width; i < values.length; i++) out[i] = values[i - width];
  } else {
    const width = Math.min(offset, values.length);
    for (let i = values.length - width; i < values.length; i++) {
      out[i] = values[values.length - 1];
    }
    for (let i = 0; i < values.length - width; i++) out[i] = values[i + width];
  }
  return out;
}

function maskAt(notesByTick: Map<number, Note[]>, tick: number): number {
  return maskForNotes(notesByTick.get(tick) ?? []);
}

function bitCount(value: number): number {
  return BIT_COUNTS[value & 31];
}

function intervalContains(
  sections: readonly {tick: number; length: number}[],
  tick: number,
): boolean {
  return sections.some(
    section => section.tick <= tick && tick < section.tick + section.length,
  );
}

function tempoAt(chart: ParsedChart, tick: number): number {
  const tempos = chart.tempos.length
    ? [...chart.tempos].sort((a, b) => a.tick - b.tick)
    : [{tick: 0, beatsPerMinute: 120}];
  let tempo = tempos[0];
  for (const candidate of tempos) {
    if (candidate.tick > tick) break;
    tempo = candidate;
  }
  return tempo.beatsPerMinute;
}

function meterAt(
  chart: ParsedChart,
  tick: number,
): {tick: number; numerator: number; denominator: number} {
  const meters = chart.timeSignatures.length
    ? [...chart.timeSignatures].sort((a, b) => a.tick - b.tick)
    : [{tick: 0, numerator: 4, denominator: 4}];
  let meter = meters[0];
  for (const candidate of meters) {
    if (candidate.tick > tick) break;
    meter = candidate;
  }
  return meter;
}

function lowerBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
