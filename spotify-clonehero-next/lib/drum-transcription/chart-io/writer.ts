/**
 * .chart file serializer.
 *
 * Produces UTF-8 text with Windows-style line endings (\r\n).
 * Output round-trips cleanly through scan-chart's parseChartFile().
 */

import type {
  ChartDocument,
  ChartMetadata,
  TempoEvent,
  TimeSignatureEvent,
  SectionEvent,
  TrackData,
  DrumNote,
} from './types';
import {
  drumTypeToNoteNumber,
  drumTypeToCymbalNumber,
  drumTypeToAccentNumber,
  drumTypeToGhostNumber,
} from './note-mapping';

const difficultyPrefix: Record<string, string> = {
  expert: 'Expert',
  hard: 'Hard',
  medium: 'Medium',
  easy: 'Easy',
};

/**
 * Serialize a ChartDocument to a .chart file string.
 *
 * The output uses Windows line endings (\r\n) and follows the format
 * that scan-chart's parseChartFile() expects.
 */
export function serializeChart(doc: ChartDocument): string {
  const lines: string[] = [];

  lines.push(...serializeSongSection(doc.metadata));
  lines.push(...serializeSyncTrack(doc.tempos, doc.timeSignatures));
  lines.push(...serializeEvents(doc.sections, doc.endEvents));

  for (const track of doc.tracks) {
    lines.push(...serializeTrack(track));
  }

  return lines.join('\r\n') + '\r\n';
}

/**
 * Serialize the [Song] metadata section.
 */
export function serializeSongSection(meta: ChartMetadata): string[] {
  const lines = ['[Song]', '{'];

  lines.push(`  Name = "${meta.name}"`);
  lines.push(`  Artist = "${meta.artist}"`);
  if (meta.album) lines.push(`  Album = "${meta.album}"`);
  if (meta.genre) lines.push(`  Genre = "${meta.genre}"`);
  if (meta.year) lines.push(`  Year = ", ${meta.year}"`);
  if (meta.charter) lines.push(`  Charter = "${meta.charter}"`);
  lines.push(`  Resolution = ${meta.resolution}`);
  lines.push(`  Offset = ${meta.offset ?? 0}`);
  lines.push(`  Player2 = bass`);
  lines.push(`  Difficulty = ${meta.difficulty ?? 0}`);
  lines.push(`  PreviewStart = ${meta.previewStart ?? 0}`);
  lines.push(`  PreviewEnd = ${meta.previewEnd ?? 0}`);
  lines.push(`  MediaType = "cd"`);
  if (meta.musicStream) lines.push(`  MusicStream = "${meta.musicStream}"`);
  if (meta.drumStream) lines.push(`  DrumStream = "${meta.drumStream}"`);

  lines.push('}');
  return lines;
}

/**
 * Serialize the [SyncTrack] section.
 *
 * Interleaves tempo and time signature events sorted by tick.
 * At the same tick, TS comes before B (Moonscraper convention).
 */
export function serializeSyncTrack(
  tempos: TempoEvent[],
  timeSignatures: TimeSignatureEvent[],
): string[] {
  const lines = ['[SyncTrack]', '{'];

  type SyncEvent =
    | {tick: number; kind: 'tempo'; bpm: number}
    | {tick: number; kind: 'ts'; numerator: number; denominator: number};

  const events: SyncEvent[] = [
    ...tempos.map(t => ({tick: t.tick, kind: 'tempo' as const, bpm: t.bpm})),
    ...timeSignatures.map(ts => ({
      tick: ts.tick,
      kind: 'ts' as const,
      numerator: ts.numerator,
      denominator: ts.denominator,
    })),
  ];

  // Sort by tick, then TS before B at same tick
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return (a.kind === 'ts' ? 0 : 1) - (b.kind === 'ts' ? 0 : 1);
  });

  for (const event of events) {
    if (event.kind === 'tempo') {
      const millibeats = Math.round(event.bpm * 1000);
      lines.push(`  ${event.tick} = B ${millibeats}`);
    } else {
      const denomExp = Math.log2(event.denominator);
      if (event.denominator === 4) {
        lines.push(`  ${event.tick} = TS ${event.numerator}`);
      } else {
        lines.push(`  ${event.tick} = TS ${event.numerator} ${denomExp}`);
      }
    }
  }

  lines.push('}');
  return lines;
}

/**
 * Serialize the [Events] section.
 *
 * Section markers use the format: `<tick> = E "section <name>"`
 * End events use: `<tick> = E "end"`
 */
export function serializeEvents(
  sections: SectionEvent[],
  endEvents: {tick: number}[],
): string[] {
  const lines = ['[Events]', '{'];

  const events: {tick: number; text: string}[] = [
    ...sections.map(s => ({tick: s.tick, text: `section ${s.name}`})),
    ...endEvents.map(e => ({tick: e.tick, text: 'end'})),
  ];

  events.sort((a, b) => a.tick - b.tick);

  for (const event of events) {
    lines.push(`  ${event.tick} = E "${event.text}"`);
  }

  lines.push('}');
  return lines;
}

/**
 * Serialize a note track section (e.g. [ExpertDrums]).
 *
 * Events are sorted by tick, then S before N, then by note number.
 */
export function serializeTrack(track: TrackData): string[] {
  const sectionName = `${difficultyPrefix[track.difficulty]}Drums`;
  const lines = [`[${sectionName}]`, '{'];

  type TrackEvent =
    | {tick: number; kind: 'S'; value: number; length: number}
    | {tick: number; kind: 'N'; value: number; length: number};

  const events: TrackEvent[] = [];

  // Star power
  for (const sp of track.starPower ?? []) {
    events.push({tick: sp.tick, kind: 'S', value: 2, length: sp.length});
  }

  // Activation lanes
  for (const al of track.activationLanes ?? []) {
    events.push({tick: al.tick, kind: 'S', value: 64, length: al.length});
  }

  // Notes
  for (const note of track.notes) {
    // Base note number
    const baseNoteNum = drumTypeToNoteNumber(note.type, note.flags);
    events.push({
      tick: note.tick,
      kind: 'N',
      value: baseNoteNum,
      length: note.length,
    });

    // Double kick marker (emit note 32 in addition to note 0)
    if (note.type === 'kick' && note.flags.doubleKick) {
      events.push({tick: note.tick, kind: 'N', value: 32, length: 0});
    }

    // Pro drums cymbal markers
    if (note.flags.cymbal) {
      const cymbalNum = drumTypeToCymbalNumber(note.type);
      if (cymbalNum !== null) {
        events.push({tick: note.tick, kind: 'N', value: cymbalNum, length: 0});
      }
    }

    // Accent flags
    if (note.flags.accent) {
      const accentNum = drumTypeToAccentNumber(note.type);
      if (accentNum !== null) {
        events.push({tick: note.tick, kind: 'N', value: accentNum, length: 0});
      }
    }

    // Ghost flags
    if (note.flags.ghost) {
      const ghostNum = drumTypeToGhostNumber(note.type);
      if (ghostNum !== null) {
        events.push({tick: note.tick, kind: 'N', value: ghostNum, length: 0});
      }
    }
  }

  // Sort: by tick, then S before N, then by value
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    const kindOrder = (k: string) => (k === 'S' ? 0 : 1);
    if (kindOrder(a.kind) !== kindOrder(b.kind))
      return kindOrder(a.kind) - kindOrder(b.kind);
    return a.value - b.value;
  });

  for (const event of events) {
    lines.push(
      `  ${event.tick} = ${event.kind} ${event.value} ${event.length}`,
    );
  }

  lines.push('}');
  return lines;
}
