/**
 * song.ini serializer for ChartMetadata.
 *
 * Produces a [song] INI section with Windows line endings (\r\n)
 * and Clone Hero's standard field ordering. Only writes fields
 * that have defined values.
 */

import type { ChartMetadata } from './types';

/**
 * Ordered list of song.ini fields matching Clone Hero convention.
 * Each entry maps the ChartMetadata key to the ini field name and value type.
 */
const FIELD_ORDER: {
  key: keyof ChartMetadata;
  type: 'string' | 'number' | 'boolean';
}[] = [
  { key: 'name', type: 'string' },
  { key: 'artist', type: 'string' },
  { key: 'album', type: 'string' },
  { key: 'genre', type: 'string' },
  { key: 'year', type: 'string' },
  { key: 'charter', type: 'string' },
  { key: 'song_length', type: 'number' },
  { key: 'diff_band', type: 'number' },
  { key: 'diff_guitar', type: 'number' },
  { key: 'diff_guitar_coop', type: 'number' },
  { key: 'diff_rhythm', type: 'number' },
  { key: 'diff_bass', type: 'number' },
  { key: 'diff_drums', type: 'number' },
  { key: 'diff_drums_real', type: 'number' },
  { key: 'diff_keys', type: 'number' },
  { key: 'diff_guitarghl', type: 'number' },
  { key: 'diff_guitar_coop_ghl', type: 'number' },
  { key: 'diff_rhythm_ghl', type: 'number' },
  { key: 'diff_bassghl', type: 'number' },
  { key: 'diff_vocals', type: 'number' },
  { key: 'preview_start_time', type: 'number' },
  { key: 'icon', type: 'string' },
  { key: 'loading_phrase', type: 'string' },
  { key: 'album_track', type: 'number' },
  { key: 'playlist_track', type: 'number' },
  { key: 'modchart', type: 'boolean' },
  { key: 'delay', type: 'number' },
  { key: 'hopo_frequency', type: 'number' },
  { key: 'eighthnote_hopo', type: 'boolean' },
  { key: 'multiplier_note', type: 'number' },
  { key: 'sustain_cutoff_threshold', type: 'number' },
  { key: 'chord_snap_threshold', type: 'number' },
  { key: 'video_start_time', type: 'number' },
  { key: 'five_lane_drums', type: 'boolean' },
  { key: 'pro_drums', type: 'boolean' },
  { key: 'end_events', type: 'boolean' },
];

function formatValue(value: string | number | boolean, type: 'string' | 'number' | 'boolean'): string {
  if (type === 'boolean') {
    return value ? 'True' : 'False';
  }
  return String(value);
}

/**
 * Serialize ChartMetadata to song.ini format.
 *
 * Only writes fields that have defined values (skips undefined).
 * Uses Windows line endings and no quoting.
 */
export function serializeIni(metadata: ChartMetadata): string {
  const lines: string[] = ['[song]'];

  for (const { key, type } of FIELD_ORDER) {
    const value = metadata[key];
    if (value === undefined) continue;
    lines.push(`${key} = ${formatValue(value as string | number | boolean, type)}`);
  }

  // Write any extra fields that weren't in our known field list
  if (metadata.extraIniFields) {
    for (const [key, value] of Object.entries(metadata.extraIniFields)) {
      lines.push(`${key} = ${value}`);
    }
  }

  return lines.join('\r\n') + '\r\n';
}
