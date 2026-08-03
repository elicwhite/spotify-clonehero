/**
 * Reducer output -> tier payload (plan 0074 Design D). The two reducers
 * disagree on shape — `lib/drum-difficulty/ours` returns lane-named notes,
 * `lib/guitar-difficulty` returns renderable `Track`s — and
 * `GenerateDifficultiesCommand` wants one thing. This module is that
 * normalization, kept out of `tasks.ts` so the task definition stays a task
 * definition.
 */

import {oursNotesToTrack} from '@/lib/drum-difficulty/toRenderableTrack';
import type {Track} from '@/lib/preview/highway/types';
import type {
  DifficultyTierContent,
  DifficultyTierNote,
  DifficultyTierRange,
  DifficultyTierSet,
  DifficultyTiers,
} from './difficulty-protocol';

/** Projects a reduced track into a {@link DifficultyTierContent} (drops the
 *  ms fields `GenerateDifficultiesCommand` doesn't need — it re-times from
 *  tick via the target doc's own tempo map). */
export function trackToTierContent(track: Track): DifficultyTierContent {
  const notes: DifficultyTierNote[] = [];
  for (const group of track.noteEventGroups) {
    for (const event of group) {
      notes.push({
        tick: event.tick,
        type: event.type,
        length: event.length ?? 0,
        flags: event.flags ?? 0,
      });
    }
  }
  const ticks = (
    ranges: ReadonlyArray<{tick: number; length: number}>,
  ): DifficultyTierRange[] =>
    ranges.map(range => ({tick: range.tick, length: range.length}));
  return {
    notes,
    starPowerSections: ticks(track.starPowerSections),
    rejectedStarPowerSections: ticks(track.rejectedStarPowerSections),
    soloSections: ticks(track.soloSections),
    flexLanes: track.flexLanes.map(lane => ({
      tick: lane.tick,
      length: lane.length,
      isDouble: lane.isDouble,
    })),
  };
}

/** Normalizes either reducer's output to the common {@link DifficultyTierSet}
 *  `GenerateDifficultiesCommand` consumes. Drums route through
 *  `oursNotesToTrack` (the same lane/type/flags resolution the highway
 *  renders from) first; guitar's tiers are already renderable `Track`s,
 *  carrying the star power / solo / flex-lane ranges the ONNX reducer
 *  predicts alongside the notes. */
export function tiersToTierSet(tiers: DifficultyTiers): DifficultyTierSet {
  if (tiers.kind === 'drums') {
    return {
      hard: trackToTierContent(oursNotesToTrack(tiers.hard, 'hard')),
      medium: trackToTierContent(oursNotesToTrack(tiers.medium, 'medium')),
      easy: trackToTierContent(oursNotesToTrack(tiers.easy, 'easy')),
    };
  }
  return {
    hard: trackToTierContent(tiers.hard),
    medium: trackToTierContent(tiers.medium),
    easy: trackToTierContent(tiers.easy),
  };
}
