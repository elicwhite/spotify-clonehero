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

export function trackKeyId(track: TrackKey): string {
  return `${track.instrument}:${track.difficulty}`;
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
