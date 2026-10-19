import {parseChartFile} from '@eliwhite/scan-chart';
import type {ParsedChart} from '@/lib/preview/chorus-chart-processing';
import type {Track} from '@/lib/preview/highway/types';

export const GUITAR_DIFFICULTIES = [
  'expert',
  'hard',
  'medium',
  'easy',
] as const;

export type GuitarDifficulty = (typeof GUITAR_DIFFICULTIES)[number];

const LANE_TO_CHART_INDEX = {
  green: 0,
  red: 1,
  yellow: 2,
  blue: 3,
  orange: 4,
} as const;

type GuitarLane = keyof typeof LANE_TO_CHART_INDEX;

export interface GuitarSnapshotNote {
  tick: number;
  lane: GuitarLane;
  length: number;
  technique?: 'strum' | 'hopo' | 'tap';
}

export interface GuitarSnapshotRange {
  tick: number;
  length: number;
  is_double?: boolean;
}

export interface GuitarSnapshotTier {
  notes: GuitarSnapshotNote[];
  star_power: GuitarSnapshotRange[];
  rejected_star_power: GuitarSnapshotRange[];
  solo_sections: GuitarSnapshotRange[];
  flex_lanes: GuitarSnapshotRange[];
}

export interface GuitarReductionSnapshot {
  artifactVersion: 1;
  snapshotId: string;
  status: 'frozen-preview';
  artifactKind: 'precomputed-preview-output';
  frozenAt: string;
  model: {
    sourceCommit: string;
    featureVariant: string;
    targetVersion: string;
    featureVersion: string;
    maskDecoder: 'expected_edit';
    maskDecoderDescription: string;
    technique: 'chord_shared';
    techniqueCleanup: 'onyx_same_high';
    sustain: 'two_stage';
    sustainConstraint: 'onyx_gap';
    range: 'learned';
    hyperparameters: {
      estimator: 'HistGradientBoostingClassifier';
      iterations: number;
      learningRate: number;
      leafNodes: number;
      minSamplesLeaf: number;
      l2Regularization: number;
    };
    runtimeModelEmbedded: false;
    exportNote: string;
  };
  parser: {
    package: '@eliwhite/scan-chart';
    packageVersion: string;
    sourceSchemaVersion: string;
    sourceScanChartVersion: string;
    productContract: 'parseChartFile';
  };
  validation: {
    screenPromoted: true;
    seeds: {seed: 1729 | 2718; pooledChartEditRate: number}[];
  };
  provenance: {
    sourceWorkstream: string;
    sourcePayload: string;
    sourcePayloadSha256: string;
    confirmationPayload: string;
    confirmationPayloadSha256: string;
    expertFixture: string;
    expertFixtureSha256: string;
    exportScript: string;
  };
  song: {
    songId: string;
    artist: string;
    title: string;
    resolution: number;
    tempoBpm: number;
    window: {startTick: number; endTick: number};
  };
  tiers: Record<GuitarDifficulty, GuitarSnapshotTier>;
}

export interface ParsedGuitarReductionSnapshot {
  snapshot: GuitarReductionSnapshot;
  chart: ParsedChart;
  tracks: Record<GuitarDifficulty, Track>;
}

function escapeChartString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function rangeLines(ranges: GuitarSnapshotRange[]): string[] {
  return ranges.map(range => `  ${range.tick} = S 2 ${range.length}`);
}

function tierSection(
  difficulty: GuitarDifficulty,
  tier: GuitarSnapshotTier,
): string {
  const sectionName = `${difficulty[0].toUpperCase()}${difficulty.slice(1)}Single`;
  const notes = tier.notes.map(note => {
    const lane = LANE_TO_CHART_INDEX[note.lane];
    return `  ${note.tick} = N ${lane} ${note.length}`;
  });

  return [
    `[${sectionName}]`,
    '{',
    ...notes,
    ...rangeLines(tier.star_power),
    '}',
  ].join('\n');
}

/**
 * Reconstruct the representative chart fixture as canonical .chart text.
 * The frozen artifact stays compact and JS-consumable while the renderer
 * receives the exact ParsedChart/Track shape used by live chart loading.
 */
export function snapshotToChartText(snapshot: GuitarReductionSnapshot): string {
  const {song} = snapshot;
  const tempo = Math.round(song.tempoBpm * 1000);
  return [
    '[Song]',
    '{',
    `  Name = "${escapeChartString(song.title)}"`,
    `  Artist = "${escapeChartString(song.artist)}"`,
    '  Charter = "Frozen guitar reduction preview"',
    `  Resolution = ${song.resolution}`,
    '}',
    '[SyncTrack]',
    '{',
    `  0 = B ${tempo}`,
    '}',
    '[Events]',
    '{',
    `  ${song.window.startTick} = E "section Preview"`,
    '}',
    ...GUITAR_DIFFICULTIES.map(difficulty =>
      tierSection(difficulty, snapshot.tiers[difficulty]),
    ),
    '',
  ].join('\n');
}

function assertSnapshotShape(snapshot: GuitarReductionSnapshot): void {
  if (
    snapshot?.artifactVersion !== 1 ||
    snapshot.status !== 'frozen-preview' ||
    snapshot.artifactKind !== 'precomputed-preview-output'
  ) {
    throw new Error('Unsupported guitar reduction snapshot format');
  }

  for (const difficulty of GUITAR_DIFFICULTIES) {
    if (!snapshot.tiers?.[difficulty]) {
      throw new Error(`Snapshot is missing the ${difficulty} guitar tier`);
    }
  }
}

/** Parse the checked-in snapshot through scan-chart's canonical JS parser. */
export function parseGuitarReductionSnapshot(
  snapshot: GuitarReductionSnapshot,
): ParsedGuitarReductionSnapshot {
  assertSnapshotShape(snapshot);
  const chart = parseChartFile(
    new TextEncoder().encode(snapshotToChartText(snapshot)),
    'chart',
  );
  const tracks = {} as Record<GuitarDifficulty, Track>;

  for (const difficulty of GUITAR_DIFFICULTIES) {
    const track = chart.trackData.find(
      candidate =>
        candidate.instrument === 'guitar' &&
        candidate.difficulty === difficulty,
    );
    if (!track) {
      throw new Error(
        `scan-chart did not produce a ${difficulty} guitar track`,
      );
    }
    tracks[difficulty] = track;
  }

  return {snapshot, chart, tracks};
}

export async function loadGuitarReductionSnapshot(
  signal?: AbortSignal,
): Promise<ParsedGuitarReductionSnapshot> {
  const requestInit: RequestInit = {cache: 'no-store'};
  if (signal) requestInit.signal = signal;
  const response = await fetch(
    '/data/guitar-difficulties/guitar-reduction-e101baa.json',
    requestInit,
  );
  if (!response.ok) {
    throw new Error(`Snapshot request failed (${response.status})`);
  }
  return parseGuitarReductionSnapshot(
    (await response.json()) as GuitarReductionSnapshot,
  );
}
