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
  [eventTypes.kickAccent]: 33,
  [eventTypes.redAccent]: 34,
  [eventTypes.yellowAccent]: 35,
  [eventTypes.blueAccent]: 36,
  [eventTypes.fiveOrangeFourGreenAccent]: 37,
  [eventTypes.fiveGreenAccent]: 38,
  [eventTypes.kickGhost]: 39,
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

  // Join with \r\n. Add trailing \r\n only between lines, not after the last one.
  // Most .chart editors (Moonscraper, YARG) don't add a trailing newline.
  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// [Song] section
// ---------------------------------------------------------------------------

function serializeSongSection(doc: ChartDocument): string[] {
  const lines = ['[Song]', '{'];

  if (doc.chartSongSection) {
    // Preserve original [Song] fields in their original order for roundtrip.
    // Update Resolution and Offset from the document (they may have changed).
    for (const { key, value } of doc.chartSongSection) {
      if (key === 'Resolution') {
        lines.push(`  Resolution = ${doc.chartTicksPerBeat}`);
      } else if (key === 'Offset') {
        const delaySec = (doc.metadata.delay ?? 0) / 1000;
        lines.push(`  Offset = ${delaySec}`);
      } else {
        lines.push(`  ${key} = ${value}`);
      }
    }
  } else {
    // No original [Song] section — build from metadata (MIDI → .chart conversion)
    const m = doc.metadata;
    if (m.name != null) lines.push(`  Name = "${m.name}"`);
    if (m.artist != null) lines.push(`  Artist = "${m.artist}"`);
    if (m.charter != null) lines.push(`  Charter = "${m.charter}"`);
    if (m.album != null) lines.push(`  Album = "${m.album}"`);
    if (m.genre != null) lines.push(`  Genre = "${m.genre}"`);
    if (m.year != null) lines.push(`  Year = ", ${m.year}"`);

    lines.push(`  Resolution = ${doc.chartTicksPerBeat}`);

    if (m.delay != null && m.delay !== 0) {
      lines.push(`  Offset = ${m.delay / 1000}`);
    }
    if (m.preview_start_time != null) {
      lines.push(`  PreviewStart = ${m.preview_start_time / 1000}`);
    }
    if (m.diff_guitar != null) lines.push(`  Difficulty = ${m.diff_guitar}`);

    // Audio stream references from assets
    for (const asset of doc.assets) {
      const basename = getBasename(asset.fileName).toLowerCase();
      const field = basenameToStreamField[basename];
      if (field != null) {
        lines.push(`  ${field} = "${asset.fileName}"`);
      }
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

  // Deduplicate
  const deduped = events.filter((event, i) => {
    if (i === 0) return true;
    const prev = events[i - 1];
    if (prev.tick !== event.tick || prev.kind !== event.kind) return true;
    if (event.kind === 'bpm' && prev.kind === 'bpm') return prev.beatsPerMinute !== event.beatsPerMinute;
    if (event.kind === 'ts' && prev.kind === 'ts') return prev.numerator !== event.numerator || prev.denominator !== event.denominator;
    return true;
  });

  for (const event of deduped) {
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

  // Collect coda ticks from drum freestyle sections (deduplicated)
  const codaTicks = new Set<number>();
  for (const track of doc.trackData) {
    for (const fs of track.drumFreestyleSections) {
      if (fs.isCoda) codaTicks.add(fs.tick);
    }
  }

  const events: { tick: number; text: string }[] = [
    ...doc.sections.map((s) => ({ tick: s.tick, text: `section ${s.name}` })),
    ...doc.endEvents.map((e) => ({ tick: e.tick, text: 'end' })),
    ...doc.lyrics.map((l) => ({ tick: l.tick, text: `lyric ${l.text}` })),
    ...doc.vocalPhrases.flatMap((p) => [
      { tick: p.tick, text: 'phrase_start' },
      { tick: p.tick + p.length, text: 'phrase_end' },
    ]),
    ...[...codaTicks].map((tick) => ({ tick, text: 'coda' })),
  ];

  // Sort by tick, then by event priority within the same tick.
  // Priority order matches Moonscraper: phrase_end, lyric, section, phrase_start, coda, end.
  const eventPriority = (text: string): number => {
    if (text === 'phrase_end') return 0;
    if (text.startsWith('lyric ')) return 1;
    if (text.startsWith('section ')) return 2;
    if (text === 'phrase_start') return 3;
    if (text === 'coda') return 4;
    if (text === 'end') return 5;
    return 3;
  };
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return eventPriority(a.text) - eventPriority(b.text);
  });

  // Deduplicate
  const deduped = events.filter((event, i) => {
    if (i === 0) return true;
    const prev = events[i - 1];
    return !(prev.tick === event.tick && prev.text === event.text);
  });

  for (const event of deduped) {
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
  | { tick: number; sortKey: 1; kind: 'S'; value: number; length: number }
  | { tick: number; sortKey: 0; kind: 'N'; value: number; length: number }
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
    events.push({ tick: sp.tick, sortKey: 1, kind: 'S', value: 2, length: sp.length });
  }

  // Drum freestyle sections → S 64
  // Coda sections are also written as S 64; the isCoda flag is determined
  // on parse by whether the section's tick >= the first [coda] text event
  // in the [Events] section (see serializeEventsSection for coda events).
  for (const fs of track.drumFreestyleSections) {
    events.push({ tick: fs.tick, sortKey: 1, kind: 'S', value: 64, length: fs.length });
  }

  // Flex lanes → S 65 (single) or S 66 (double)
  for (const fl of track.flexLanes) {
    const value = fl.isDouble ? 66 : 65;
    events.push({ tick: fl.tick, sortKey: 1, kind: 'S', value, length: fl.length });
  }

  // Solo sections → E "solo" at tick, E "soloend" at tick+length
  for (const solo of track.soloSections) {
    events.push({ tick: solo.tick, sortKey: 2, kind: 'E', text: 'solo' });
    events.push({ tick: solo.tick + solo.length, sortKey: 2, kind: 'E', text: 'soloend' });
  }

  // Disco flip events → E "mix N drums0..." (drums only, per-difficulty)
  if (track.instrument === 'drums') {
    const diffIdx: Record<string, number> = { easy: 0, medium: 1, hard: 2, expert: 3 };
    const di = diffIdx[track.difficulty] ?? 3;
    const discoFlagMap: Partial<Record<EventType, string>> = {
      [eventTypes.discoFlipOff]: '',
      [eventTypes.discoFlipOn]: 'd',
      [eventTypes.discoNoFlipOn]: 'dnoflip',
    };
    for (const te of track.trackEvents) {
      const flag = discoFlagMap[te.type];
      if (flag !== undefined) {
        events.push({ tick: te.tick, sortKey: 2, kind: 'E', text: `mix ${di} drums0${flag}` });
      }
    }
  }

  // Track events (notes and modifiers) → N <noteNumber> <length>
  for (const te of track.trackEvents) {
    const noteNumber = noteMap[te.type];
    if (noteNumber != null) {
      events.push({ tick: te.tick, sortKey: 0, kind: 'N', value: noteNumber, length: te.length });
    }
    // EventTypes not in the map are structural (starPower, soloSection, etc.)
    // and are handled via the dedicated sections above — skip them here.
  }

  // Cross-format conversion: MIDI uses tom markers, .chart uses cymbal markers.
  // If data has tom markers but no cymbal markers, generate cymbal markers for non-tom notes.
  if (track.instrument === 'drums') {
    const hasTomMarkers = track.trackEvents.some(e =>
      e.type === eventTypes.yellowTomMarker ||
      e.type === eventTypes.blueTomMarker ||
      e.type === eventTypes.greenTomMarker
    );
    const hasCymbalMarkers = track.trackEvents.some(e =>
      e.type === eventTypes.yellowCymbalMarker ||
      e.type === eventTypes.blueCymbalMarker ||
      e.type === eventTypes.greenCymbalMarker
    );

    if (hasTomMarkers && !hasCymbalMarkers) {
      const tomTicks = {
        yellow: new Set<number>(),
        blue: new Set<number>(),
        green: new Set<number>(),
      };
      for (const ev of track.trackEvents) {
        if (ev.type === eventTypes.yellowTomMarker) tomTicks.yellow.add(ev.tick);
        if (ev.type === eventTypes.blueTomMarker) tomTicks.blue.add(ev.tick);
        if (ev.type === eventTypes.greenTomMarker) tomTicks.green.add(ev.tick);
      }

      const noteToChartCymbal: [EventType, Set<number>, number][] = [
        [eventTypes.yellowDrum, tomTicks.yellow, 66],
        [eventTypes.blueDrum, tomTicks.blue, 67],
        [eventTypes.fiveOrangeFourGreenDrum, tomTicks.green, 68],
      ];
      for (const [noteType, toms, chartNote] of noteToChartCymbal) {
        for (const ev of track.trackEvents) {
          if (ev.type === noteType && !toms.has(ev.tick)) {
            events.push({ tick: ev.tick, sortKey: 0, kind: 'N', value: chartNote, length: 0 });
          }
        }
      }
    }
  }

  // Sort: by tick, then N before S before E (matching Moonscraper output order).
  // Within the same tick and kind, preserve insertion order (which reflects
  // the original file order from scan-chart's parser).
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    return a.sortKey - b.sortKey;
  });

  // Deduplicate: remove exact duplicate events (same tick + kind + value/text)
  const deduped: TrackLineEvent[] = [];
  for (const event of events) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.tick === event.tick && prev.kind === event.kind) {
      if (event.kind === 'E' && prev.kind === 'E' && prev.text === event.text) continue;
      if (event.kind !== 'E' && prev.kind !== 'E' && prev.value === event.value && prev.length === event.length) continue;
    }
    deduped.push(event);
  }

  for (const event of deduped) {
    if (event.kind === 'E') {
      lines.push(`  ${event.tick} = E ${event.text}`);
    } else {
      lines.push(`  ${event.tick} = ${event.kind} ${event.value} ${event.length}`);
    }
  }

  lines.push('}');
  return lines;
}
