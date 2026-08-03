import type {
  ChartDocument,
  Difficulty,
  ParsedTrackData,
  TrackKey,
} from '@/lib/chart-edit';

export const SUPPORTED_TRACK_INSTRUMENTS = ['guitar', 'bass', 'drums'] as const;
export type SupportedTrackInstrument =
  (typeof SUPPORTED_TRACK_INSTRUMENTS)[number];

export const TRACK_DIFFICULTIES: Difficulty[] = [
  'expert',
  'hard',
  'medium',
  'easy',
];

export type SupportedTrackKey = Omit<TrackKey, 'instrument'> & {
  instrument: SupportedTrackInstrument;
};

/** Stable id for a `TrackKey`, as returned by {@link trackKeyId} — the shape
 *  `EditCommand.affectedTracks` and the assist engine's per-track content
 *  stamps key on (plan 0074 Design C). */
export type TrackKeyId = string;

export function trackKeyId(track: TrackKey): TrackKeyId {
  return `${track.instrument}:${track.difficulty}`;
}

/** Parse a `trackKeyId()`-shaped id (`"${instrument}:${difficulty}"`) back
 *  into a `TrackKey`. Returns null for a malformed id (defensive only —
 *  every id stored in `visibleTrackKeys` is produced by `trackKeyId()`). */
export function parseTrackKeyId(id: TrackKeyId): TrackKey | null {
  const separator = id.indexOf(':');
  if (separator <= 0 || separator === id.length - 1) return null;
  return {
    instrument: id.slice(0, separator) as TrackKey['instrument'],
    difficulty: id.slice(separator + 1) as TrackKey['difficulty'],
  };
}

export function availableTrackKeys(
  trackData: ParsedTrackData[],
): SupportedTrackKey[] {
  return SUPPORTED_TRACK_INSTRUMENTS.flatMap(instrument =>
    TRACK_DIFFICULTIES.filter(difficulty =>
      trackData.some(
        track =>
          track.instrument === instrument && track.difficulty === difficulty,
      ),
    ).map(difficulty => ({instrument, difficulty})),
  );
}

export function preferredTrackKey(
  trackData: ParsedTrackData[],
): SupportedTrackKey | undefined {
  const tracks = availableTrackKeys(trackData);
  return (
    tracks.find(
      track => track.instrument === 'guitar' && track.difficulty === 'expert',
    ) ??
    tracks.find(
      track => track.instrument === 'drums' && track.difficulty === 'expert',
    ) ??
    tracks.find(track => track.difficulty === 'expert') ??
    tracks[0]
  );
}

export function preferredTrackForChart(
  chartDoc: ChartDocument,
): SupportedTrackKey | undefined {
  return preferredTrackKey(chartDoc.parsedChart.trackData);
}

/**
 * Resolve {@link preferredTrackKey}'s choice back to the parser's track
 * object — the initial highway track for the unified `/chart-editor` page
 * (guitar Expert, then drums Expert, then any Expert, then the first track).
 */
export function findPreferredTrack(
  trackData: ParsedTrackData[],
): ParsedTrackData | undefined {
  const preferred = preferredTrackKey(trackData);
  return preferred
    ? trackData.find(
        track =>
          track.instrument === preferred.instrument &&
          track.difficulty === preferred.difficulty,
      )
    : undefined;
}
