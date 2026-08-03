/**
 * The Stems mixer's solo bus (plan 0074 Phase 5, Design C): the single
 * implementation of "given every row's slider/mute/solo, what does each
 * track actually sound like, and which rows are silent only because
 * something else is solo'd".
 *
 * Pure and React-free so the policy is one value the UI reads twice (once to
 * push volumes at the `AudioManager`, once to render the rows) rather than a
 * procedure written out at each of those places.
 */

import {CLICK_TRACK_NAME} from '@/lib/preview/clickTrack';

/** One row's controls, as the user set them. `volume` is 0-100. */
export interface MixerRowState {
  volume: number;
  mute: boolean;
  solo: boolean;
}

export interface ResolvedMixerRow {
  /** Gain to hand `AudioManager.setVolume`, 0-1. */
  volume: number;
  /** Silent because some OTHER row is solo'd, and not muted itself — a
   *  distinct rendering from an explicit mute. */
  dimmedBySolo: boolean;
}

export interface ResolvedMixer {
  /** True when at least one solo-eligible row is solo'd. */
  anySolo: boolean;
  resolved: Record<string, ResolvedMixerRow>;
}

/** The metronome click is solo-exempt: it never dims for another stem's
 *  solo, and has no solo of its own. */
function soloExempt(name: string): boolean {
  return name === CLICK_TRACK_NAME;
}

/** The default slider position for a track: silent for the click, full for
 *  every real stem. */
export function defaultVolumeFor(name: string): number {
  return soloExempt(name) ? 0 : 100;
}

/**
 * Resolves the whole mixer. Precedence per row: an explicit mute wins, then
 * "someone else is solo'd", then the row's own slider value.
 */
export function resolveMixer(
  rows: Readonly<Record<string, MixerRowState>>,
): ResolvedMixer {
  const names = Object.keys(rows);
  const anySolo = names.some(name => !soloExempt(name) && rows[name].solo);

  const resolved: Record<string, ResolvedMixerRow> = {};
  for (const name of names) {
    const row = rows[name];
    const dimmedBySolo = !soloExempt(name) && anySolo && !row.solo && !row.mute;
    resolved[name] = {
      volume: row.mute || dimmedBySolo ? 0 : row.volume / 100,
      dimmedBySolo,
    };
  }

  return {anySolo, resolved};
}
