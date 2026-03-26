/**
 * .chart file serializer.
 *
 * Serializes a ChartDocument (which extends scan-chart's RawChartData)
 * to .chart text format. Produces UTF-8 text with Windows-style line
 * endings (\r\n). Output round-trips cleanly through scan-chart's
 * parseChartFile().
 */

import type { ChartDocument, TrackData, EventType, Instrument } from './types';
import { eventTypes } from './types';
import { getBasename } from '../src-shared/utils';

// ---------------------------------------------------------------------------
// Instrument → .chart section suffix
// ---------------------------------------------------------------------------

const instrumentSectionSuffix: Record<string, string> = {
  guitar: 'Single',
  guitarcoop: 'DoubleGuitar',
  rhythm: 'DoubleRhythm',
  bass: 'DoubleBass',
  drums: 'Drums',
  keys: 'Keyboard',
  guitarghl: 'GHLGuitar',
  guitarcoopghl: 'GHLCoop',
  rhythmghl: 'GHLRhythm',
  bassghl: 'GHLBass',
};

// ---------------------------------------------------------------------------
// Difficulty → .chart difficulty prefix
// ---------------------------------------------------------------------------

const difficultyPrefix: Record<string, string> = {
  expert: 'Expert',
  hard: 'Hard',
  medium: 'Medium',
  easy: 'Easy',
};

// ---------------------------------------------------------------------------
// EventType → .chart note number (instrument-dependent)
// ---------------------------------------------------------------------------

/**
 * Drum EventType → .chart note number.
 * Derived by reversing scan-chart's chart parser drum mapping.
 */
const drumEventTypeToNoteNumber: Partial<Record<EventType, number>> = {
  [eventTypes.kick]: 0,
  [eventTypes.redDrum]: 1,
  [eventTypes.yellowDrum]: 2,
  [eventTypes.blueDrum]: 3,
  [eventTypes.fiveOrangeFourGreenDrum]: 4,
  [eventTypes.fiveGreenDrum]: 5,
  [eventTypes.kick2x]: 32,
  [eventTypes.redAccent]: 34,
  [eventTypes.yellowAccent]: 35,
  [eventTypes.blueAccent]: 36,
  [eventTypes.fiveOrangeFourGreenAccent]: 37,
  [eventTypes.fiveGreenAccent]: 38,
  [eventTypes.redGhost]: 40,
  [eventTypes.yellowGhost]: 41,
  [eventTypes.blueGhost]: 42,
  [eventTypes.fiveOrangeFourGreenGhost]: 43,
  [eventTypes.fiveGreenGhost]: 44,
  [eventTypes.yellowCymbalMarker]: 66,
  [eventTypes.blueCymbalMarker]: 67,
  [eventTypes.greenCymbalMarker]: 68,
  [eventTypes.forceFlam]: 109,
};

/**
 * 5-fret guitar EventType → .chart note number.
 * Used for guitar, guitarcoop, rhythm, bass, keys.
 */
const fiveFretEventTypeToNoteNumber: Partial<Record<EventType, number>> = {
  [eventTypes.green]: 0,
  [eventTypes.red]: 1,
  [eventTypes.yellow]: 2,
  [eventTypes.blue]: 3,
  [eventTypes.orange]: 4,
  [eventTypes.forceUnnatural]: 5,
  [eventTypes.forceTap]: 6,
  [eventTypes.open]: 7,
};

/**
 * 6-fret (GHL) guitar EventType → .chart note number.
 * Used for guitarghl, guitarcoopghl, rhythmghl, bassghl.
 */
const ghlEventTypeToNoteNumber: Partial<Record<EventType, number>> = {
  [eventTypes.white1]: 0,
  [eventTypes.white2]: 1,
  [eventTypes.white3]: 2,
  [eventTypes.black1]: 3,
  [eventTypes.black2]: 4,
  [eventTypes.forceUnnatural]: 5,
  [eventTypes.forceTap]: 6,
  [eventTypes.open]: 7,
  [eventTypes.black3]: 8,
};

const ghlInstruments = new Set<string>([
  'guitarghl',
  'guitarcoopghl',
  'rhythmghl',
  'bassghl',
]);

/**
 * Get the appropriate EventType → chart note number map for an instrument.
 */
function getNoteNumberMap(
  instrument: Instrument,
): Partial<Record<EventType, number>> {
  if (instrument === 'drums') return drumEventTypeToNoteNumber;
  if (ghlInstruments.has(instrument)) return ghlEventTypeToNoteNumber;
  return fiveFretEventTypeToNoteNumber;
}

// ---------------------------------------------------------------------------
// Audio basename → .chart stream field name
// ---------------------------------------------------------------------------

const basenameToStreamField: Record<string, string> = {
  song: 'MusicStream',
  guitar: 'GuitarStream',
  bass: 'BassStream',
  rhythm: 'RhythmStream',
  vocals: 'VocalStream',
  drums: 'DrumStream',
  drums_1: 'Drum2Stream',
  drums_2: 'Drum3Stream',
  drums_3: 'Drum4Stream',
  keys: 'KeysStream',
  crowd: 'CrowdStream',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize a ChartDocument to a .chart file string.
 *
 * The output uses Windows line endings (\r\n) and follows the format
 * that scan-chart's parseChartFile() expects.
 */
export function serializeChart(doc: ChartDocument): string {
  const lines: string[] = [];

  lines.push(...serializeSongSection(doc));
  lines.push(...serializeSyncTrack(doc));
  lines.push(...serializeEventsSection(doc));

  for (const track of doc.trackData) {
    lines.push(...serializeTrackSection(track));
  }

  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// [Song] section
// ---------------------------------------------------------------------------

function serializeSongSection(doc: ChartDocument): string[] {
  const lines = ['[Song]', '{'];

  lines.push(`  Resolution = ${doc.chartTicksPerBeat}`);

  if (doc.metadata.delay != null && doc.metadata.delay !== 0) {
    lines.push(`  Offset = ${doc.metadata.delay}`);
  }

  // Audio stream references from assets
  for (const asset of doc.assets) {
    const basename = getBasename(asset.fileName).toLowerCase();
    const field = basenameToStreamField[basename];
    if (field != null) {
      lines.push(`  ${field} = "${asset.fileName}"`);
    }
  }

  lines.push('}');
  return lines;
}

// ---------------------------------------------------------------------------
// [SyncTrack] section
// ---------------------------------------------------------------------------

function serializeSyncTrack(doc: ChartDocument): string[] {
  const lines = ['[SyncTrack]', '{'];

  type SyncEvent =
    | { tick: number; order: 0; kind: 'ts'; numerator: number; denominator: number }
    | { tick: number; order: 1; kind: 'bpm'; beatsPerMinute: number };

  const events: SyncEvent[] = [
    ...doc.timeSignatures.map(
      (ts): SyncEvent => ({
        tick: ts.tick,
        order: 0,
        kind: 'ts',
        numerator: ts.numerator,
        denominator: ts.denominator,
      }),
    ),
    ...doc.tempos.map(
      (t): SyncEvent => ({
        tick: t.tick,
        order: 1,
        kind: 'bpm',
        beatsPerMinute: t.beatsPerMinute,
      }),
    ),
  ];

  // Sort by tick, then TS before B at same tick
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return a.order - b.order;
  });

  for (const event of events) {
    if (event.kind === 'bpm') {
      const millibeats = Math.round(event.beatsPerMinute * 1000);
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

// ---------------------------------------------------------------------------
// [Events] section
// ---------------------------------------------------------------------------

function serializeEventsSection(doc: ChartDocument): string[] {
  const lines = ['[Events]', '{'];

  const events: { tick: number; text: string }[] = [
    ...doc.sections.map((s) => ({ tick: s.tick, text: `section ${s.name}` })),
    ...doc.endEvents.map((e) => ({ tick: e.tick, text: 'end' })),
  ];

  events.sort((a, b) => a.tick - b.tick);

  for (const event of events) {
    lines.push(`  ${event.tick} = E "${event.text}"`);
  }

  lines.push('}');
  return lines;
}

// ---------------------------------------------------------------------------
// [<Difficulty><Instrument>] track sections
// ---------------------------------------------------------------------------

/** A single line event within a track section. */
type TrackLineEvent =
  | { tick: number; sortKey: 0; kind: 'S'; value: number; length: number }
  | { tick: number; sortKey: 1; kind: 'N'; value: number; length: number }
  | { tick: number; sortKey: 2; kind: 'E'; text: string };

function serializeTrackSection(track: TrackData): string[] {
  const suffix = instrumentSectionSuffix[track.instrument];
  const prefix = difficultyPrefix[track.difficulty];
  if (suffix == null || prefix == null) {
    // Unknown instrument or difficulty — skip
    return [];
  }

  const sectionName = `${prefix}${suffix}`;
  const lines = [`[${sectionName}]`, '{'];
  const noteMap = getNoteNumberMap(track.instrument);

  const events: TrackLineEvent[] = [];

  // Star power sections → S 2
  for (const sp of track.starPowerSections) {
    events.push({ tick: sp.tick, sortKey: 0, kind: 'S', value: 2, length: sp.length });
  }

  // Drum freestyle sections (non-coda) → S 64
  for (const fs of track.drumFreestyleSections) {
    if (!fs.isCoda) {
      events.push({ tick: fs.tick, sortKey: 0, kind: 'S', value: 64, length: fs.length });
    }
  }

  // Flex lanes → S 65 (single) or S 66 (double)
  for (const fl of track.flexLanes) {
    const value = fl.isDouble ? 66 : 65;
    events.push({ tick: fl.tick, sortKey: 0, kind: 'S', value, length: fl.length });
  }

  // Solo sections → E "solo" at tick, E "soloend" at tick+length
  for (const solo of track.soloSections) {
    events.push({ tick: solo.tick, sortKey: 2, kind: 'E', text: 'solo' });
    events.push({ tick: solo.tick + solo.length, sortKey: 2, kind: 'E', text: 'soloend' });
  }

  // Track events (notes and modifiers) → N <noteNumber> <length>
  for (const te of track.trackEvents) {
    const noteNumber = noteMap[te.type];
    if (noteNumber != null) {
      events.push({ tick: te.tick, sortKey: 1, kind: 'N', value: noteNumber, length: te.length });
    }
    // EventTypes not in the map are structural (starPower, soloSection, etc.)
    // and are handled via the dedicated sections above — skip them here.
  }

  // Sort: by tick, then S before N before E, then by value
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
    // Within same kind, sort by value (E events don't have a value, but
    // "solo" always comes before "soloend" alphabetically which is fine)
    if (a.kind === 'E' && b.kind === 'E') return 0;
    if (a.kind !== 'E' && b.kind !== 'E') return a.value - b.value;
    return 0;
  });

  for (const event of events) {
    if (event.kind === 'E') {
      lines.push(`  ${event.tick} = E "${event.text}"`);
    } else {
      lines.push(`  ${event.tick} = ${event.kind} ${event.value} ${event.length}`);
    }
  }

  lines.push('}');
  return lines;
}
