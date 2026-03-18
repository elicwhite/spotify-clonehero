/**
 * Convert a scan-chart ParsedChart back into an editable ChartDocument.
 *
 * This is the inverse direction of reader.ts (which does ChartDocument -> ParsedChart
 * via serialize -> parse). Here we take a ParsedChart (from parseChartFile) and
 * construct a ChartDocument that the editing system can work with.
 *
 * The resulting ChartDocument can be serialized back to .chart format via
 * serializeChart(), and the round-trip should be lossless for the data we care about.
 */

import {noteTypes, noteFlags as nf} from '@eliwhite/scan-chart';
import type {
  ChartDocument,
  ChartMetadata,
  TempoEvent,
  TimeSignatureEvent,
  SectionEvent,
  TrackData,
  DrumNote,
  DrumNoteType,
  DrumNoteFlags,
} from './types';
import type {ParsedChart} from './reader';

/**
 * Map a scan-chart NoteType number to our DrumNoteType string.
 */
function scanChartTypeToDrumType(type: number): DrumNoteType | null {
  switch (type) {
    case noteTypes.kick:
      return 'kick';
    case noteTypes.redDrum:
      return 'red';
    case noteTypes.yellowDrum:
      return 'yellow';
    case noteTypes.blueDrum:
      return 'blue';
    case noteTypes.greenDrum:
      return 'green';
    default:
      return null;
  }
}

/**
 * Convert scan-chart bitmask flags to our DrumNoteFlags object.
 */
function scanChartFlagsToDrumFlags(flags: number): DrumNoteFlags {
  return {
    cymbal: (flags & nf.cymbal) !== 0 ? true : undefined,
    doubleKick: (flags & nf.doubleKick) !== 0 ? true : undefined,
    accent: (flags & nf.accent) !== 0 ? true : undefined,
    ghost: (flags & nf.ghost) !== 0 ? true : undefined,
  };
}

/**
 * Build a ChartDocument from a ParsedChart.
 *
 * @param parsed - The output of parseChartFile()
 * @param chartText - Optional: the original .chart text, used to extract
 *   metadata fields that scan-chart doesn't expose (musicStream, etc.)
 */
export function parsedChartToDocument(
  parsed: ParsedChart,
  chartText?: string,
): ChartDocument {
  const resolution = parsed.resolution;

  // -- Metadata --
  const metadata: ChartMetadata = {
    name: parsed.metadata.name ?? 'Untitled',
    artist: parsed.metadata.artist ?? 'Unknown',
    album: parsed.metadata.album,
    genre: parsed.metadata.genre,
    year: parsed.metadata.year,
    charter: parsed.metadata.charter,
    resolution,
    offset: parsed.metadata.delay,
    previewStart: parsed.metadata.preview_start_time,
  };

  // Try to extract musicStream/drumStream from original chart text
  if (chartText) {
    const musicMatch = chartText.match(/MusicStream\s*=\s*"([^"]+)"/);
    if (musicMatch) metadata.musicStream = musicMatch[1];
    const drumMatch = chartText.match(/DrumStream\s*=\s*"([^"]+)"/);
    if (drumMatch) metadata.drumStream = drumMatch[1];
  }

  // -- Tempos --
  const tempos: TempoEvent[] = parsed.tempos.map(t => ({
    tick: t.tick,
    bpm: t.beatsPerMinute,
  }));

  // -- Time signatures --
  const timeSignatures: TimeSignatureEvent[] = parsed.timeSignatures.map(ts => ({
    tick: ts.tick,
    numerator: ts.numerator,
    denominator: ts.denominator,
  }));

  // -- Sections --
  const sections: SectionEvent[] = parsed.sections.map(s => ({
    tick: s.tick,
    name: s.name,
  }));

  // -- End events --
  const endEvents = parsed.endEvents.map(e => ({tick: e.tick}));

  // -- Tracks --
  const tracks: TrackData[] = [];

  for (const trackData of parsed.trackData) {
    // We only convert drum tracks
    if (trackData.instrument !== 'drums') continue;

    const notes: DrumNote[] = [];

    for (const group of trackData.noteEventGroups) {
      for (const noteEvent of group) {
        const drumType = scanChartTypeToDrumType(noteEvent.type);
        if (!drumType) continue;

        notes.push({
          tick: noteEvent.tick,
          type: drumType,
          length: noteEvent.length,
          flags: scanChartFlagsToDrumFlags(noteEvent.flags),
        });
      }
    }

    // Sort by tick
    notes.sort((a, b) => a.tick - b.tick);

    tracks.push({
      instrument: trackData.instrument,
      difficulty: trackData.difficulty,
      notes,
      starPower: trackData.starPowerSections.map(sp => ({
        tick: sp.tick,
        length: sp.length,
      })),
    });
  }

  return {
    resolution,
    metadata,
    tempos,
    timeSignatures,
    sections,
    endEvents,
    tracks,
  };
}
