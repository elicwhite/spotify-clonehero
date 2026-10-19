/**
 * Section helpers for drum tracks.
 *
 * Manages star power, activation lanes, solo sections, and flex lanes
 * on a ParsedTrackData object. All mutations are in-place.
 */

import type {ParsedTrackData} from '../types';
import {applyEventTiming, type ChartTiming} from '../retime';

// A minimal section shape shared by every helper below: a tick-anchored
// span whose derived `msTime`/`msLength` come from the tempo table when a
// `ChartTiming` is supplied (plan 0061 §2's push model). Tracks carry no
// tempos, so callers that have the whole chart pass `timing`; callers still
// round-tripping the doc may omit it.
type TimedSpan = {
  tick: number;
  length: number;
  msTime: number;
  msLength: number;
};

function timeSpan(span: TimedSpan, timing?: ChartTiming): void {
  if (timing) applyEventTiming(span, timing);
}

// ---------------------------------------------------------------------------
// Star Power
// ---------------------------------------------------------------------------

export function addStarPower(
  track: ParsedTrackData,
  tick: number,
  length: number,
  timing?: ChartTiming,
): void {
  removeStarPower(track, tick);
  const section = {tick, length, msTime: 0, msLength: 0};
  timeSpan(section, timing);
  track.starPowerSections.push(section);
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
  timing?: ChartTiming,
): void {
  removeActivationLane(track, tick);
  const section = {tick, length, isCoda: false, msTime: 0, msLength: 0};
  timeSpan(section, timing);
  track.drumFreestyleSections.push(section);
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
  timing?: ChartTiming,
): void {
  removeSoloSection(track, tick);
  const section = {tick, length, msTime: 0, msLength: 0};
  timeSpan(section, timing);
  track.soloSections.push(section);
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
  timing?: ChartTiming,
): void {
  removeFlexLane(track, tick);
  const section = {tick, length, isDouble, msTime: 0, msLength: 0};
  timeSpan(section, timing);
  track.flexLanes.push(section);
}

export function removeFlexLane(track: ParsedTrackData, tick: number): void {
  track.flexLanes = track.flexLanes.filter(s => s.tick !== tick);
}
