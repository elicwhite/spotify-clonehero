/**
 * Section helpers for drum tracks.
 *
 * Manages star power, activation lanes, solo sections, and flex lanes
 * on a ParsedTrackData object. All mutations are in-place.
 */

import type {ParsedTrackData} from '../types';

// ---------------------------------------------------------------------------
// Star Power
// ---------------------------------------------------------------------------

export function addStarPower(
  track: ParsedTrackData,
  tick: number,
  length: number,
): void {
  removeStarPower(track, tick);
  track.starPowerSections.push({tick, length, msTime: 0, msLength: 0});
}

export function removeStarPower(track: ParsedTrackData, tick: number): void {
  track.starPowerSections = track.starPowerSections.filter(
    s => s.tick !== tick,
  );
}

// ---------------------------------------------------------------------------
// Activation Lanes (drumFreestyleSections with isCoda: false)
// ---------------------------------------------------------------------------

export function addActivationLane(
  track: ParsedTrackData,
  tick: number,
  length: number,
): void {
  removeActivationLane(track, tick);
  track.drumFreestyleSections.push({
    tick,
    length,
    isCoda: false,
    msTime: 0,
    msLength: 0,
  });
}

export function removeActivationLane(
  track: ParsedTrackData,
  tick: number,
): void {
  track.drumFreestyleSections = track.drumFreestyleSections.filter(
    s => s.tick !== tick || s.isCoda,
  );
}

// ---------------------------------------------------------------------------
// Solo Sections
// ---------------------------------------------------------------------------

export function addSoloSection(
  track: ParsedTrackData,
  tick: number,
  length: number,
): void {
  removeSoloSection(track, tick);
  track.soloSections.push({tick, length, msTime: 0, msLength: 0});
}

export function removeSoloSection(track: ParsedTrackData, tick: number): void {
  track.soloSections = track.soloSections.filter(s => s.tick !== tick);
}

// ---------------------------------------------------------------------------
// Flex Lanes
// ---------------------------------------------------------------------------

export function addFlexLane(
  track: ParsedTrackData,
  tick: number,
  length: number,
  isDouble: boolean,
): void {
  removeFlexLane(track, tick);
  track.flexLanes.push({tick, length, isDouble, msTime: 0, msLength: 0});
}

export function removeFlexLane(track: ParsedTrackData, tick: number): void {
  track.flexLanes = track.flexLanes.filter(s => s.tick !== tick);
}
