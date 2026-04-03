/**
 * Chart reader — loads a ChartDocument from a set of FileEntry files.
 *
 * Delegates parsing to scan-chart's raw parsers (parseNotesFromChart / parseNotesFromMidi)
 * and enriches the result with song.ini metadata and asset classification.
 */

import type { ChartDocument, ChartMetadata, FileEntry } from './types';
import type { IniChartModifiers } from '@eliwhite/scan-chart';
import {
  parseNotesFromChart,
  parseNotesFromMidi,
  defaultIniChartModifiers,
} from '@eliwhite/scan-chart';
import {
  getExtension,
  hasChartName,
  hasIniName,
  hasAudioName,
  hasVideoName,
} from '../src-shared/utils';
import { parse as parseIni } from '../ini-parser';

// ---------------------------------------------------------------------------
// INI field descriptors for type conversion
// ---------------------------------------------------------------------------

const INI_STRING_FIELDS: (keyof ChartMetadata)[] = [
  'name',
  'artist',
  'album',
  'genre',
  'year',
  'charter',
  'icon',
  'loading_phrase',
];

const INI_INT_FIELDS: (keyof ChartMetadata)[] = [
  'song_length',
  'diff_band',
  'diff_guitar',
  'diff_guitar_coop',
  'diff_rhythm',
  'diff_bass',
  'diff_drums',
  'diff_drums_real',
  'diff_keys',
  'diff_guitarghl',
  'diff_guitar_coop_ghl',
  'diff_rhythm_ghl',
  'diff_bassghl',
  'diff_vocals',
  'album_track',
  'playlist_track',
  'multiplier_note',
];

const INI_NUMBER_FIELDS: (keyof ChartMetadata)[] = [
  'preview_start_time',
  'delay',
  'hopo_frequency',
  'sustain_cutoff_threshold',
  'chord_snap_threshold',
  'video_start_time',
];

const INI_BOOLEAN_FIELDS: (keyof ChartMetadata)[] = [
  'modchart',
  'eighthnote_hopo',
  'five_lane_drums',
  'pro_drums',
  'end_events',
];

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'bmp',
  'webp',
]);

// ---------------------------------------------------------------------------
// INI → ChartMetadata
// ---------------------------------------------------------------------------

function parseMetadataFromIni(iniText: string): ChartMetadata {
  const { iniObject } = parseIni(iniText);
  // Case-insensitive section lookup — real charts use [song], [Song], or [SONG]
  const sectionKey = Object.keys(iniObject).find(
    (k) => k.toLowerCase() === 'song',
  );
  const section = sectionKey ? iniObject[sectionKey] : {};
  const metadata: ChartMetadata = {};

  for (const key of INI_STRING_FIELDS) {
    if (key in section) {
      (metadata as Record<string, unknown>)[key] = section[key];
    }
  }

  for (const key of INI_INT_FIELDS) {
    if (key in section) {
      const parsed = parseInt(section[key], 10);
      if (!isNaN(parsed)) {
        (metadata as Record<string, unknown>)[key] = parsed;
      }
    }
  }

  for (const key of INI_NUMBER_FIELDS) {
    if (key in section) {
      const parsed = parseFloat(section[key]);
      if (!isNaN(parsed)) {
        // delay=0 is semantically identical to undefined (no offset).
        // scan-chart's .chart parser also returns undefined for Offset=0.
        // Normalize here so the value doesn't enter metadata and cause
        // round-trip mismatches.
        if (key === 'delay' && parsed === 0) continue;
        (metadata as Record<string, unknown>)[key] = parsed;
      }
    }
  }

  for (const key of INI_BOOLEAN_FIELDS) {
    if (key in section) {
      (metadata as Record<string, unknown>)[key] =
        section[key].toLowerCase() === 'true';
    }
  }

  // Preserve unknown fields so they survive round-trip (e.g. sysex_slider,
  // sysex_open_bass, diff_bass_real, diff_guitar_real, etc.)
  const knownFields = new Set<string>([
    ...INI_STRING_FIELDS,
    ...INI_INT_FIELDS,
    ...INI_NUMBER_FIELDS,
    ...INI_BOOLEAN_FIELDS,
  ]);
  const extra: Record<string, string> = {};
  for (const key of Object.keys(section)) {
    if (!knownFields.has(key)) {
      extra[key] = section[key];
    }
  }
  if (Object.keys(extra).length > 0) {
    metadata.extraIniFields = extra;
  }

  return metadata;
}

// ---------------------------------------------------------------------------
// INI → IniChartModifiers (for MIDI parsing)
// ---------------------------------------------------------------------------

function buildIniChartModifiers(metadata: ChartMetadata): IniChartModifiers {
  return {
    ...defaultIniChartModifiers,
    hopo_frequency:
      metadata.hopo_frequency ?? defaultIniChartModifiers.hopo_frequency,
    eighthnote_hopo:
      metadata.eighthnote_hopo ?? defaultIniChartModifiers.eighthnote_hopo,
    multiplier_note:
      metadata.multiplier_note ?? defaultIniChartModifiers.multiplier_note,
    sustain_cutoff_threshold:
      metadata.sustain_cutoff_threshold ??
      defaultIniChartModifiers.sustain_cutoff_threshold,
    chord_snap_threshold:
      metadata.chord_snap_threshold ??
      defaultIniChartModifiers.chord_snap_threshold,
    five_lane_drums:
      metadata.five_lane_drums ?? defaultIniChartModifiers.five_lane_drums,
    pro_drums: metadata.pro_drums ?? defaultIniChartModifiers.pro_drums,
    song_length:
      metadata.song_length ?? defaultIniChartModifiers.song_length,
  };
}

// ---------------------------------------------------------------------------
// Asset classification
// ---------------------------------------------------------------------------

function isImageFile(fileName: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(fileName).toLowerCase());
}

function isAssetFile(fileName: string): boolean {
  return hasAudioName(fileName) || hasVideoName(fileName) || isImageFile(fileName);
}

// ---------------------------------------------------------------------------
// .chart [Song] section raw parsing
// ---------------------------------------------------------------------------

/**
 * Parse the raw [Song] section from a .chart file, preserving field order
 * and unknown fields for byte-level roundtrip fidelity.
 */
function parseChartSongSection(
  data: Uint8Array,
): Array<{ key: string; value: string }> | undefined {
  const text = new TextDecoder().decode(data);
  // Find [Song] section
  const songMatch = text.match(/\[Song\]\s*\{([^}]*)\}/);
  if (!songMatch) return undefined;

  const entries: Array<{ key: string; value: string }> = [];
  const lines = songMatch[1].split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Match "Key = Value" or "Key = "Value""
    const m = trimmed.match(/^(\S+)\s*=\s*(.*?)[\r]*$/);
    if (m) {
      entries.push({ key: m[1], value: m[2] });
    }
  }
  return entries.length > 0 ? entries : undefined;
}

// ---------------------------------------------------------------------------
// readChart
// ---------------------------------------------------------------------------

/**
 * Parse a collection of FileEntry files into a ChartDocument.
 *
 * Expects at least one chart file (notes.chart or notes.mid) in the files array.
 * If both exist, notes.chart is preferred.
 */
export function readChart(files: FileEntry[]): ChartDocument {
  // 1. Find chart file
  const chartFiles = files.filter((f) => hasChartName(f.fileName));
  const chartFile =
    chartFiles.find((f) => f.fileName === 'notes.chart') ??
    chartFiles.find((f) => f.fileName === 'notes.mid');

  if (!chartFile) {
    throw new Error(
      'No chart file found. Expected notes.chart or notes.mid in the file list.',
    );
  }

  const ext = getExtension(chartFile.fileName).toLowerCase();
  const originalFormat: 'chart' | 'mid' = ext === 'chart' ? 'chart' : 'mid';

  // 2. Parse song.ini (if present)
  const iniFile = files.find((f) => hasIniName(f.fileName));
  let metadata: ChartMetadata = {};
  if (iniFile) {
    const iniText = new TextDecoder().decode(iniFile.data);
    metadata = parseMetadataFromIni(iniText);
  }

  // 3. Parse chart data via scan-chart
  let rawData;
  if (originalFormat === 'chart') {
    rawData = parseNotesFromChart(chartFile.data);
  } else {
    const iniChartModifiers = buildIniChartModifiers(metadata);
    rawData = parseNotesFromMidi(chartFile.data, iniChartModifiers);
  }

  // 4. Merge RawChartData.metadata into ChartMetadata as fallbacks.
  // When a song.ini exists, it's the primary source for metadata. But some
  // fields (like delay/Offset) may only be in the chart file itself — always
  // merge those as fallbacks regardless of whether an ini exists.
  if (rawData.metadata) {
    const raw = rawData.metadata;
    if (!iniFile) {
      // No ini — use chart metadata for everything
      if (raw.name !== undefined && metadata.name === undefined)
        metadata.name = raw.name;
      if (raw.artist !== undefined && metadata.artist === undefined)
        metadata.artist = raw.artist;
      if (raw.album !== undefined && metadata.album === undefined)
        metadata.album = raw.album;
      if (raw.genre !== undefined && metadata.genre === undefined)
        metadata.genre = raw.genre;
      if (raw.year !== undefined && metadata.year === undefined)
        metadata.year = raw.year;
      if (raw.charter !== undefined && metadata.charter === undefined)
        metadata.charter = raw.charter;
      if (raw.diff_guitar !== undefined && metadata.diff_guitar === undefined)
        metadata.diff_guitar = raw.diff_guitar;
      if (
        raw.preview_start_time !== undefined &&
        metadata.preview_start_time === undefined
      )
        metadata.preview_start_time = raw.preview_start_time;
    }
    // Always merge delay — .chart stores it as Offset in [Song], song.ini
    // stores it as delay (ms). Both should be sources, ini taking precedence.
    if (raw.delay !== undefined && metadata.delay === undefined)
      metadata.delay = raw.delay;
  }

  // 5. Classify remaining files as assets
  const usedChartFileName = chartFile.fileName;
  const assets = files.filter((f) => {
    // Skip the chart file we parsed
    if (f.fileName === usedChartFileName) return false;
    // Skip song.ini
    if (hasIniName(f.fileName)) return false;
    // notes.mid when notes.chart was used → pass-through asset
    if (hasChartName(f.fileName)) return true;
    // Audio, video, and image files
    return isAssetFile(f.fileName);
  });

  // 6. Parse raw [Song] section for .chart round-trip fidelity
  const chartSongSection =
    originalFormat === 'chart'
      ? parseChartSongSection(chartFile.data)
      : undefined;

  // 7. Build ChartDocument
  const { metadata: _rawMeta, ...rawFields } = rawData;

  return {
    ...rawFields,
    metadata,
    originalFormat,
    assets,
    chartSongSection,
  };
}
