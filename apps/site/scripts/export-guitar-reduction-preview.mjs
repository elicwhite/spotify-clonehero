#!/usr/bin/env node

/*
 * Reproduce the checked-in preview from the source workstream:
 *
 * node scripts/export-guitar-reduction-preview.mjs \
 *   --expert <scan-chart fixture.json> \
 *   --payload <e101baa seed-1729 payload.json> \
 *   --confirmation-payload <e101baa seed-2718 payload.json> \
 *   --output public/data/guitar-difficulties/guitar-reduction-e101baa.json \
 *   --max-tick 57600 --frozen-at 2026-07-31
 */

import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function required(name) {
  const value = option(name);
  if (!value) throw new Error(`Missing required option ${name}`);
  return value;
}

function readJson(file) {
  return JSON.parse(readFileSync(resolve(file), 'utf8'));
}

function sha256(file) {
  return createHash('sha256')
    .update(readFileSync(resolve(file)))
    .digest('hex');
}

function boundedItems(items, endTick) {
  return (items ?? [])
    .filter(item => Number(item.tick) <= endTick)
    .map(item => ({
      tick: Number(item.tick),
      length: Number(item.length),
      ...(item.is_double === undefined
        ? {}
        : {is_double: Boolean(item.is_double)}),
    }));
}

function boundedTier(tier, endTick) {
  return {
    notes: (tier.notes ?? [])
      .filter(note => Number(note.tick) <= endTick)
      .map(note => ({
        tick: Number(note.tick),
        lane: note.lane,
        length: Number(note.length),
        technique: note.technique,
      })),
    star_power: boundedItems(tier.star_power, endTick),
    rejected_star_power: boundedItems(tier.rejected_star_power, endTick),
    solo_sections: boundedItems(tier.solo_sections, endTick),
    flex_lanes: boundedItems(tier.flex_lanes, endTick),
  };
}

function songParts(songId) {
  const name = songId.split(' :: ').at(-1) ?? songId;
  const separator = name.indexOf(' - ');
  return separator === -1
    ? {artist: 'Unknown Artist', title: name}
    : {artist: name.slice(0, separator), title: name.slice(separator + 3)};
}

const expertPath = required('--expert');
const payloadPath = required('--payload');
const confirmationPath = required('--confirmation-payload');
const outputPath = required('--output');
const maxTick = Number(option('--max-tick', '57600'));
const frozenAt = option('--frozen-at', '2026-07-31');
const snapshotId = option('--snapshot-id', 'guitar-reduction-e101baa');

const expertFixture = readJson(expertPath);
const payload = readJson(payloadPath);
const confirmationPayload = readJson(confirmationPath);
const representative = payload.find(
  item => item.song_id === expertFixture.song_id,
);
if (!representative) {
  throw new Error(`Payload does not contain ${expertFixture.song_id}`);
}
const confirmationRepresentative = confirmationPayload.find(
  item => item.song_id === expertFixture.song_id,
);
if (!confirmationRepresentative) {
  throw new Error(
    `Confirmation payload does not contain ${expertFixture.song_id}`,
  );
}

const {artist, title} = songParts(expertFixture.song_id);
const sourceTiers = expertFixture.tiers;
const tiers = {
  expert: boundedTier(sourceTiers.expert, maxTick),
  hard: boundedTier(representative.tiers.hard, maxTick),
  medium: boundedTier(representative.tiers.medium, maxTick),
  easy: boundedTier(representative.tiers.easy, maxTick),
};

const snapshot = {
  artifactVersion: 1,
  snapshotId,
  status: 'frozen-preview',
  artifactKind: 'precomputed-preview-output',
  frozenAt,
  model: {
    sourceCommit: 'e101baa',
    featureVariant: 'neighbor_priority_easy_v1',
    targetVersion: 'chart_edit_v1+direct_mask_v1+secondary_v2',
    featureVersion:
      'guitar-features-v2-secondary-ranges+neighbor_priority_easy_v1',
    maskDecoder: 'expected_edit',
    maskDecoderDescription:
      'Choose the mask minimizing expected literal insert/delete/lane-move cost under the learned 32-class mask probabilities.',
    technique: 'chord_shared',
    techniqueCleanup: 'onyx_same_high',
    sustain: 'two_stage',
    sustainConstraint: 'onyx_gap',
    range: 'learned',
    hyperparameters: {
      estimator: 'HistGradientBoostingClassifier',
      iterations: 90,
      learningRate: 0.08,
      leafNodes: 31,
      minSamplesLeaf: 30,
      l2Regularization: 1.0,
    },
    runtimeModelEmbedded: false,
    exportNote:
      'This product artifact contains frozen output for a representative fixture, not a serialized live Python/scikit-learn estimator. Regenerate it with the checked-in export script when a portable estimator export is available.',
  },
  parser: {
    package: '@eliwhite/scan-chart',
    packageVersion: '8.1.0-eliwhite.6',
    sourceSchemaVersion: expertFixture.schema_version,
    sourceScanChartVersion: expertFixture.scan_chart_version,
    productContract: 'parseChartFile',
  },
  validation: {
    screenPromoted: true,
    seeds: [
      {seed: 1729, pooledChartEditRate: 0.40395157},
      {seed: 2718, pooledChartEditRate: 0.40515458},
    ],
  },
  provenance: {
    sourceWorkstream: 'drum-to-chart/autoresearch-guitar-reduction',
    sourcePayload:
      'cache/candidate_payloads/expected_edit_mask_decoder-neighbor_priority_easy_v1-1729.json',
    sourcePayloadSha256: sha256(payloadPath),
    confirmationPayload:
      'cache/candidate_payloads/expected_edit_mask_decoder-neighbor_priority_easy_v1-2718.json',
    confirmationPayloadSha256: sha256(confirmationPath),
    expertFixture:
      'analysis/guitar_reduction_probe/out/scan_chart_rb4dlc/RB4-to-RB2-DISC :: 38 Special - Caught Up In You.json',
    expertFixtureSha256: sha256(expertPath),
    exportScript: 'scripts/export-guitar-reduction-preview.mjs',
  },
  song: {
    songId: expertFixture.song_id,
    artist,
    title,
    resolution: Number(expertFixture.resolution),
    tempoBpm: Number(expertFixture.tempos?.[0]?.bpm ?? 120),
    window: {startTick: 0, endTick: maxTick},
  },
  tiers,
};

mkdirSync(dirname(resolve(outputPath)), {recursive: true});
writeFileSync(resolve(outputPath), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      output: resolve(outputPath),
      snapshotId,
      songId: snapshot.song.songId,
      maxTick,
      sha256: sha256(outputPath),
      confirmationFixturePresent: Boolean(confirmationRepresentative),
    },
    null,
    2,
  ),
);
