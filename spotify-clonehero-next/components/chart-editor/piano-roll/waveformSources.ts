/**
 * Waveform-source model for the piano-roll timeline (plan 0062 §11, QA
 * round-1 change 4). The waveform row can display any of the audio sources the
 * `AudioManager` holds for the project (e.g. the isolated drum stem and the
 * full mix). These pure helpers turn the manager's track names into a
 * user-facing, radio-style source list and pick the default selection.
 *
 * No React, no AudioManager instance: just the naming/selection rules, so the
 * defaulting logic is unit-testable.
 */

export interface WaveformSource {
  /** AudioManager track name (the id passed to `getTrackPcm`). */
  id: string;
  /** Display label for the menu + corner chip. */
  label: string;
}

/** Track-name substrings that identify the full-mix source, best-first. */
const MIX_HINTS = ['song', 'mix', 'full'] as const;

/** Human label for a known stem/track name; falls back to a title-cased id. */
export function labelForSource(id: string): string {
  const lower = id.toLowerCase();
  if (lower === 'drums') return 'Drums';
  if (MIX_HINTS.some(h => lower.includes(h))) return 'Song (full mix)';
  if (lower === 'bass') return 'Bass';
  if (lower === 'vocals') return 'Vocals';
  if (lower === 'other') return 'Other';
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Build the selectable source list from the AudioManager track names. The
 * drum stem (the audio the transcription came from) sorts first when present;
 * the rest keep their given order.
 */
export function buildWaveformSources(
  trackNames: readonly string[],
): WaveformSource[] {
  const sources = trackNames.map(id => ({id, label: labelForSource(id)}));
  return sources.sort((a, b) => {
    const ad = a.id.toLowerCase() === 'drums' ? 0 : 1;
    const bd = b.id.toLowerCase() === 'drums' ? 0 : 1;
    return ad - bd;
  });
}

/**
 * Default source: the drum stem when present (that's the audio the drums were
 * transcribed from), else the full mix, else the first available source.
 * `null` when there are no sources at all.
 */
export function defaultWaveformSourceId(
  sources: readonly WaveformSource[],
): string | null {
  if (sources.length === 0) return null;
  const drums = sources.find(s => s.id.toLowerCase() === 'drums');
  if (drums) return drums.id;
  const mix = sources.find(s =>
    MIX_HINTS.some(h => s.id.toLowerCase().includes(h)),
  );
  if (mix) return mix.id;
  return sources[0].id;
}
