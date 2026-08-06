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
import type {AudioStemOrigin} from '../hooks/usePaddedAudio';

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

/** Options for {@link defaultVolumeFor}. */
export interface DefaultVolumeOptions {
  /**
   * True when the project has no audio at all. The click is then the only
   * thing there is to hear, so starting it silent would make Play do nothing
   * with no explanation. With audio present the click stays silent until the
   * user raises it.
   */
  silentProject?: boolean | undefined;
}

/** The default slider position for a track: silent for the click, full for
 *  every real stem. */
export function defaultVolumeFor(
  name: string,
  {silentProject = false}: DefaultVolumeOptions = {},
): number {
  if (!soloExempt(name)) return 100;
  return silentProject ? 70 : 0;
}

/**
 * Whether a stem arrives muted.
 *
 * A separated stem is a derived preview artifact whose audio is ALREADY in
 * the full mix beside it, so playing it unasked doubles that instrument
 * against itself. It arrives muted rather than at zero volume: mute is the
 * reversible state the row can advertise (the M toggle lights up, one click
 * undoes it) and it leaves the slider at the level the stem should play at,
 * where a zero slider would render as an ordinary live row that happens to
 * be silent.
 *
 * The click is the other way round for the same reason: its slider IS its
 * control (the user dials in how loud a metronome they want), so it starts
 * at zero — see {@link defaultVolumeFor} — with its M toggle unlit and its
 * readout honestly showing 0%.
 *
 * A stem the user dropped on the mixer themselves is never muted: adding it
 * is the request to hear it.
 */
export function defaultMuteFor(origin: AudioStemOrigin | undefined): boolean {
  return origin === 'ai-separated';
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
