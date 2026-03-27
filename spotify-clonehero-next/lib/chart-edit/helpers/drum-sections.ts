/**
 * Section helpers for drum tracks.
 *
 * Manages star power, activation lanes, solo sections, and flex lanes
 * on a TrackData object. All mutations are in-place.
 */

import type { TrackData } from '../types';

// ---------------------------------------------------------------------------
// Star Power
// ---------------------------------------------------------------------------

/**
 * Add a star power section to the track.
 * If one already exists at the same tick, it is replaced.
 */
export function addStarPower(track: TrackData, tick: number, length: number): void {
  removeStarPower(track, tick);
  track.starPowerSections.push({ tick, length });
}

/**
 * Remove the star power section at the given tick.
 */
export function removeStarPower(track: TrackData, tick: number): void {
  track.starPowerSections = track.starPowerSections.filter((s) => s.tick !== tick);
}

// ---------------------------------------------------------------------------
// Activation Lanes (drumFreestyleSections with isCoda: false)
// ---------------------------------------------------------------------------

/**
 * Add an activation lane to the track.
 * If one already exists at the same tick, it is replaced.
 */
export function addActivationLane(track: TrackData, tick: number, length: number): void {
  removeActivationLane(track, tick);
  track.drumFreestyleSections.push({ tick, length, isCoda: false });
}

/**
 * Remove the activation lane at the given tick.
 * Only removes non-coda freestyle sections.
 */
export function removeActivationLane(track: TrackData, tick: number): void {
  track.drumFreestyleSections = track.drumFreestyleSections.filter(
    (s) => s.tick !== tick || s.isCoda,
  );
}

// ---------------------------------------------------------------------------
// Solo Sections
// ---------------------------------------------------------------------------

/**
 * Add a solo section to the track.
 * If one already exists at the same tick, it is replaced.
 */
export function addSoloSection(track: TrackData, tick: number, length: number): void {
  removeSoloSection(track, tick);
  track.soloSections.push({ tick, length });
}

/**
 * Remove the solo section at the given tick.
 */
export function removeSoloSection(track: TrackData, tick: number): void {
  track.soloSections = track.soloSections.filter((s) => s.tick !== tick);
}

// ---------------------------------------------------------------------------
// Flex Lanes
// ---------------------------------------------------------------------------

/**
 * Add a flex lane to the track.
 * If one already exists at the same tick, it is replaced.
 */
export function addFlexLane(
  track: TrackData,
  tick: number,
  length: number,
  isDouble: boolean,
): void {
  removeFlexLane(track, tick);
  track.flexLanes.push({ tick, length, isDouble });
}

/**
 * Remove the flex lane at the given tick.
 */
export function removeFlexLane(track: TrackData, tick: number): void {
  track.flexLanes = track.flexLanes.filter((s) => s.tick !== tick);
}
