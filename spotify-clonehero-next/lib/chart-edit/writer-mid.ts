/**
 * MIDI binary serializer for ChartDocument.
 *
 * Converts a ChartDocument (which extends scan-chart's RawChartData) into a
 * standard Format-1 MIDI file compatible with Clone Hero, Moonscraper, and
 * scan-chart's own MIDI parser.
 *
 * Track layout:
 *   0 — Tempo map (BPM + time signatures)
 *   1 — EVENTS (sections, end events, lyrics)
 *   N — One track per instrument (e.g. PART DRUMS, PART GUITAR)
 */

import type { ChartDocument, TrackData } from './types';
import { eventTypes } from './types';
import type { Instrument, Difficulty, EventType } from './types';
import { writeMidi } from 'midi-file';
import type { MidiData, MidiEvent } from 'midi-file';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const instrumentTrackNames: Record<Instrument, string> = {
  drums: 'PART DRUMS',
  guitar: 'PART GUITAR',
  guitarcoop: 'PART GUITAR COOP',
  rhythm: 'PART RHYTHM',
  bass: 'PART BASS',
  keys: 'PART KEYS',
  guitarghl: 'PART GUITAR GHL',
  guitarcoopghl: 'PART GUITAR COOP GHL',
  rhythmghl: 'PART RHYTHM GHL',
  bassghl: 'PART BASS GHL',
};

/** Base MIDI note number for each difficulty (drums: kick note). */
const drumDiffBases: Record<Difficulty, number> = {
  expert: 96,
  hard: 84,
  medium: 72,
  easy: 60,
};

/**
 * Base MIDI note for 5-fret instruments.
 *
 * scan-chart uses diffStarts { expert: 95, hard: 83, medium: 71, easy: 59 }
 * where offsets are: 0=open(enhanced), 1=green, 2=red, 3=yellow, 4=blue,
 * 5=orange, 6=forceHopo, 7=forceStrum. We store diffStart directly.
 */
const fiveFretDiffStarts: Record<Difficulty, number> = {
  expert: 95,
  hard: 83,
  medium: 71,
  easy: 59,
};

/**
 * Base MIDI note for 6-fret (GHL) instruments.
 * Matches scan-chart sixFretDiffStarts: offsets 0=open, 1=white1, ..., 8=forceStrum.
 */
const sixFretDiffStarts: Record<Difficulty, number> = {
  expert: 94,
  hard: 82,
  medium: 70,
  easy: 58,
};

/** EventType → offset from difficulty base for drum notes. */
const drumNoteOffsets: Partial<Record<EventType, number>> = {
  [eventTypes.kick]: 0,
  [eventTypes.redDrum]: 1,
  [eventTypes.yellowDrum]: 2,
  [eventTypes.blueDrum]: 3,
  [eventTypes.fiveOrangeFourGreenDrum]: 4,
  [eventTypes.fiveGreenDrum]: 5,
};

/** EventType → offset from difficulty start for 5-fret notes. */
const fiveFretNoteOffsets: Partial<Record<EventType, number>> = {
  [eventTypes.open]: 0, // Enhanced opens only
  [eventTypes.green]: 1,
  [eventTypes.red]: 2,
  [eventTypes.yellow]: 3,
  [eventTypes.blue]: 4,
  [eventTypes.orange]: 5,
  [eventTypes.forceHopo]: 6,
  [eventTypes.forceStrum]: 7,
};

/** EventType → offset from difficulty start for 6-fret (GHL) notes. */
const sixFretNoteOffsets: Partial<Record<EventType, number>> = {
  [eventTypes.open]: 0,
  [eventTypes.white1]: 1,
  [eventTypes.white2]: 2,
  [eventTypes.white3]: 3,
  [eventTypes.black1]: 4,
  [eventTypes.black2]: 5,
  [eventTypes.black3]: 6,
  [eventTypes.forceHopo]: 7,
  [eventTypes.forceStrum]: 8,
};

/** Tom marker EventType → MIDI note number (instrument-wide, not per-difficulty). */
const tomMarkerNotes: Partial<Record<EventType, number>> = {
  [eventTypes.yellowTomMarker]: 110,
  [eventTypes.blueTomMarker]: 111,
  [eventTypes.greenTomMarker]: 112,
};

/** Accent EventType → base drum note EventType it modifies. */
const accentToBaseNote: Partial<Record<EventType, EventType>> = {
  [eventTypes.redAccent]: eventTypes.redDrum,
  [eventTypes.yellowAccent]: eventTypes.yellowDrum,
  [eventTypes.blueAccent]: eventTypes.blueDrum,
  [eventTypes.fiveOrangeFourGreenAccent]: eventTypes.fiveOrangeFourGreenDrum,
  [eventTypes.fiveGreenAccent]: eventTypes.fiveGreenDrum,
  [eventTypes.kickAccent]: eventTypes.kick,
};

/** Ghost EventType → base drum note EventType it modifies. */
const ghostToBaseNote: Partial<Record<EventType, EventType>> = {
  [eventTypes.redGhost]: eventTypes.redDrum,
  [eventTypes.yellowGhost]: eventTypes.yellowDrum,
  [eventTypes.blueGhost]: eventTypes.blueDrum,
  [eventTypes.fiveOrangeFourGreenGhost]: eventTypes.fiveOrangeFourGreenDrum,
  [eventTypes.fiveGreenGhost]: eventTypes.fiveGreenDrum,
  [eventTypes.kickGhost]: eventTypes.kick,
};

/** Set of accent EventTypes. */
const accentEventTypes = new Set<EventType>(Object.keys(accentToBaseNote).map(Number) as EventType[]);

/** Set of ghost EventTypes. */
const ghostEventTypes = new Set<EventType>(Object.keys(ghostToBaseNote).map(Number) as EventType[]);

/** Set of tom marker EventTypes. */
const tomMarkerEventTypes = new Set<EventType>([
  eventTypes.yellowTomMarker,
  eventTypes.blueTomMarker,
  eventTypes.greenTomMarker,
]);

/** SysEx modifier types (written as Phase Shift SysEx, not MIDI notes). */
const sysExModifierTypes = new Set<EventType>([
  eventTypes.forceTap,
  eventTypes.forceOpen,
]);

/** MIDI-note modifier types (written as note on/off with sustain). */
const noteModifierTypes = new Set<EventType>([
  eventTypes.forceHopo,
  eventTypes.forceStrum,
]);

/** SysEx type byte for each modifier. */
const sysExTypeByte: Partial<Record<EventType, number>> = {
  [eventTypes.forceTap]: 0x04,
  [eventTypes.forceOpen]: 0x01,
};

/** 5-fret instruments (non-GHL). */
const fiveFretInstruments = new Set<Instrument>([
  'guitar',
  'guitarcoop',
  'rhythm',
  'bass',
  'keys',
]);

/** 6-fret (GHL) instruments. */
const sixFretInstruments = new Set<Instrument>([
  'guitarghl',
  'guitarcoopghl',
  'rhythmghl',
  'bassghl',
]);

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** An event with an absolute tick, to be converted to delta-time later. */
interface AbsoluteEvent {
  tick: number;
  event: MidiEvent;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Serialize a ChartDocument to MIDI binary format (Format 1).
 *
 * @returns A Uint8Array containing the complete .mid file.
 */
export function serializeMidi(doc: ChartDocument): Uint8Array {
  const tracks: MidiEvent[][] = [];

  // Track 0: tempo map
  tracks.push(buildTempoTrack(doc));

  // Track 1: events (sections, end events)
  tracks.push(buildEventsTrack(doc));

  // PART VOCALS track (lyrics + phrase markers)
  if (doc.lyrics.length > 0 || doc.vocalPhrases.length > 0) {
    tracks.push(buildVocalsTrack(doc));
  }

  // Group trackData by instrument
  const byInstrument = groupByInstrument(doc.trackData);

  byInstrument.forEach((trackDataEntries, instrument) => {
    tracks.push(buildInstrumentTrack(instrument, trackDataEntries, doc));
  });

  const midiData: MidiData = {
    header: {
      format: 1,
      numTracks: tracks.length,
      ticksPerBeat: doc.chartTicksPerBeat,
    },
    tracks,
  };

  const bytes = writeMidi(midiData);
  return new Uint8Array(bytes);
}

// ---------------------------------------------------------------------------
// Track builders
// ---------------------------------------------------------------------------

function buildTempoTrack(doc: ChartDocument): MidiEvent[] {
  const events: AbsoluteEvent[] = [];

  // Track name
  events.push({
    tick: 0,
    event: { deltaTime: 0, meta: true, type: 'trackName', text: 'tempo' } as MidiEvent,
  });

  // Tempo events
  for (const tempo of doc.tempos) {
    events.push({
      tick: tempo.tick,
      event: {
        deltaTime: 0,
        meta: true,
        type: 'setTempo',
        microsecondsPerBeat: Math.round(60000000 / tempo.beatsPerMinute),
      } as MidiEvent,
    });
  }

  // Time signature events
  for (const ts of doc.timeSignatures) {
    events.push({
      tick: ts.tick,
      event: {
        deltaTime: 0,
        meta: true,
        type: 'timeSignature',
        numerator: ts.numerator,
        denominator: ts.denominator,
        metronome: 24,
        thirtyseconds: 8,
      } as MidiEvent,
    });
  }

  return finalizeMidiTrack(events);
}

function buildEventsTrack(doc: ChartDocument): MidiEvent[] {
  const events: AbsoluteEvent[] = [];

  // Track name
  events.push({
    tick: 0,
    event: { deltaTime: 0, meta: true, type: 'trackName', text: 'EVENTS' } as MidiEvent,
  });

  // Section markers
  for (const section of doc.sections) {
    events.push({
      tick: section.tick,
      event: {
        deltaTime: 0,
        meta: true,
        type: 'text',
        text: `[section ${section.name}]`,
      } as MidiEvent,
    });
  }

  // End events
  for (const endEvent of doc.endEvents) {
    events.push({
      tick: endEvent.tick,
      event: { deltaTime: 0, meta: true, type: 'text', text: '[end]' } as MidiEvent,
    });
  }

  // Coda events (from drum freestyle sections marked as coda)
  const codaSections = doc.trackData.flatMap(td =>
    td.drumFreestyleSections.filter(fs => fs.isCoda)
  );
  const emittedCoda = new Set<string>();
  for (const cs of codaSections) {
    const key = `${cs.tick}`;
    if (!emittedCoda.has(key)) {
      emittedCoda.add(key);
      events.push({
        tick: cs.tick,
        event: { deltaTime: 0, meta: true, type: 'text', text: '[coda]' } as MidiEvent,
      });
    }
  }

  return finalizeMidiTrack(events);
}

function buildInstrumentTrack(
  instrument: Instrument,
  trackDataEntries: TrackData[],
  doc: ChartDocument,
): MidiEvent[] {
  const isDrums = instrument === 'drums';
  const isGhl = sixFretInstruments.has(instrument);
  const events: AbsoluteEvent[] = [];

  // Track name
  events.push({
    tick: 0,
    event: {
      deltaTime: 0,
      meta: true,
      type: 'trackName',
      text: instrumentTrackNames[instrument],
    } as MidiEvent,
  });

  // Collect accent/ghost info across all difficulties to decide ENABLE_CHART_DYNAMICS
  let hasAccentsOrGhosts = false;

  // Collect per-difficulty note events. We track accent/ghost modifiers per
  // (tick, baseNoteType) so we can adjust velocity on the corresponding noteOn.
  // Also collect tom markers to emit as instrument-wide MIDI notes.

  // Sets for deduplicating instrument-wide events that span all difficulties:
  // star power, solos, activation lanes, flex lanes, tom markers, flam
  // These are already per-difficulty in trackData (scan-chart distributes them),
  // so we need to deduplicate when merging difficulties back into one MIDI track.
  // Collect instrument-wide sections across all difficulties, then merge
  // overlapping ranges before emitting. MIDI cannot have overlapping notes
  // of the same pitch — when .chart has per-difficulty sections at different
  // ranges, we must merge them into valid non-overlapping MIDI notes.
  const allStarPower: { tick: number; length: number }[] = [];
  const allSolo: { tick: number; length: number }[] = [];
  const allActivation: { tick: number; length: number }[] = [];
  const emittedFlexLane = new Map<string, number>(); // key → velocity
  const emittedTomMarker = new Set<string>();
  const emittedFlam = new Set<string>();
  const emittedKick2x = new Set<string>();

  // Collect guitar/GHL modifier events per difficulty for sustain-range reconstruction.
  // scan-chart splits MIDI modifier sustains into zero-length events at each note tick;
  // we must reverse that to produce sustain-range SysEx/note pairs that Moonscraper and
  // Clone Hero expect.
  const modifiersByDiff = new Map<Difficulty, Map<EventType, { tick: number; length: number }[]>>();
  const noteTicksByDiff = new Map<Difficulty, number[]>();

  for (const td of trackDataEntries) {
    const difficulty = td.difficulty;

    // Build lookup: tick → Set<baseEventType> that have accent at that tick
    const accentAt = new Map<number, Set<EventType>>();
    // Build lookup: tick → Set<baseEventType> that have ghost at that tick
    const ghostAt = new Map<number, Set<EventType>>();

    for (const ev of td.trackEvents) {
      if (accentEventTypes.has(ev.type)) {
        hasAccentsOrGhosts = true;
        const base = accentToBaseNote[ev.type];
        if (base !== undefined) {
          let s = accentAt.get(ev.tick);
          if (!s) {
            s = new Set();
            accentAt.set(ev.tick, s);
          }
          s.add(base);
        }
      } else if (ghostEventTypes.has(ev.type)) {
        hasAccentsOrGhosts = true;
        const base = ghostToBaseNote[ev.type];
        if (base !== undefined) {
          let s = ghostAt.get(ev.tick);
          if (!s) {
            s = new Set();
            ghostAt.set(ev.tick, s);
          }
          s.add(base);
        }
      }
    }

    // For non-drum instruments, collect modifier events and note ticks
    // so we can reconstruct sustain ranges after the per-event loop.
    if (!isDrums) {
      const noteOffsets = isGhl ? sixFretNoteOffsets : fiveFretNoteOffsets;
      const noteTicks: number[] = [];
      let mods = modifiersByDiff.get(difficulty);
      if (!mods) {
        mods = new Map();
        modifiersByDiff.set(difficulty, mods);
      }

      for (const ev of td.trackEvents) {
        // Collect note ticks (needed for range reconstruction)
        if (noteOffsets[ev.type] !== undefined) {
          noteTicks.push(ev.tick);
        }
        // Collect SysEx and note-based modifiers
        if (sysExModifierTypes.has(ev.type) || noteModifierTypes.has(ev.type)) {
          let arr = mods.get(ev.type);
          if (!arr) {
            arr = [];
            mods.set(ev.type, arr);
          }
          arr.push({ tick: ev.tick, length: ev.length });
        }
      }

      // Deduplicate note ticks (chords produce multiple entries at the same tick)
      const existing = noteTicksByDiff.get(difficulty);
      if (existing) {
        existing.push(...noteTicks);
      } else {
        noteTicksByDiff.set(difficulty, noteTicks);
      }
    }

    for (const ev of td.trackEvents) {
      // Skip accent/ghost modifier events — they are encoded via velocity
      if (accentEventTypes.has(ev.type) || ghostEventTypes.has(ev.type)) {
        continue;
      }

      if (isDrums) {
        // Tom markers → instrument-wide MIDI notes (not per-difficulty)
        if (tomMarkerEventTypes.has(ev.type)) {
          const midiNote = tomMarkerNotes[ev.type];
          if (midiNote !== undefined) {
            const key = `${ev.tick}:${ev.length}:${midiNote}`;
            if (!emittedTomMarker.has(key)) {
              emittedTomMarker.add(key);
              addNoteOnOff(events, ev.tick, ev.length, midiNote, 100);
            }
          }
          continue;
        }

        // Flam → instrument-wide MIDI note 109
        if (ev.type === eventTypes.forceFlam) {
          const key = `${ev.tick}:${ev.length}`;
          if (!emittedFlam.has(key)) {
            emittedFlam.add(key);
            addNoteOnOff(events, ev.tick, ev.length, 109, 100);
          }
          continue;
        }

        // kick2x → double kick: difficulty base note - 1
        // (Expert+=95, Hard+=83, Medium+=71, Easy+=59)
        if (ev.type === eventTypes.kick2x) {
          addNoteOnOff(events, ev.tick, ev.length, drumDiffBases[difficulty] - 1, 100);
          continue;
        }

        // forceTap — instrument-wide note 104 (can appear on drum tracks from SysEx)
        if (ev.type === eventTypes.forceTap) {
          const key = `tap:${ev.tick}:${ev.length}`;
          if (!emittedFlam.has(key)) { // reuse flam dedup set (instrument-wide events)
            emittedFlam.add(key);
            addNoteOnOff(events, ev.tick, ev.length, 104, 100);
          }
          continue;
        }

        // Regular drum note
        const offset = drumNoteOffsets[ev.type];
        if (offset !== undefined) {
          const midiNote = drumDiffBases[difficulty] + offset;
          // Determine velocity from accent/ghost modifiers
          let velocity = 100;
          if (accentAt.get(ev.tick)?.has(ev.type)) {
            velocity = 127;
          } else if (ghostAt.get(ev.tick)?.has(ev.type)) {
            velocity = 1;
          }
          addNoteOnOff(events, ev.tick, ev.length, midiNote, velocity);
          continue;
        }
      } else if (isGhl) {
        const offset = sixFretNoteOffsets[ev.type];
        if (offset !== undefined) {
          const midiNote = sixFretDiffStarts[difficulty] + offset;
          addNoteOnOff(events, ev.tick, ev.length, midiNote, 100);
          continue;
        }

        // Skip SysEx and note-based modifiers — handled via range reconstruction below
        if (sysExModifierTypes.has(ev.type) || noteModifierTypes.has(ev.type)) {
          continue;
        }
      } else if (fiveFretInstruments.has(instrument)) {
        const offset = fiveFretNoteOffsets[ev.type];
        if (offset !== undefined) {
          const midiNote = fiveFretDiffStarts[difficulty] + offset;
          addNoteOnOff(events, ev.tick, ev.length, midiNote, 100);
          continue;
        }

        // Skip SysEx and note-based modifiers — handled via range reconstruction below
        if (sysExModifierTypes.has(ev.type) || noteModifierTypes.has(ev.type)) {
          continue;
        }
      }

      // Unhandled event types are silently skipped
    }

    // Collect sections for post-loop merge
    for (const sp of td.starPowerSections) allStarPower.push(sp);
    for (const solo of td.soloSections) allSolo.push(solo);
    for (const fs of td.drumFreestyleSections) allActivation.push(fs);

    // Flex lanes → note 126 (single) / 127 (double)
    // Track lowest difficulty per flex lane for LDS velocity encoding.
    // scan-chart's fixFlexLaneLds filters by velocity:
    //   easy: 21-30, medium: 21-40, hard: 21-50, expert: all
    // Use velocity to encode which difficulties should see the flex lane.
    const diffVelocity: Record<string, number> = { easy: 25, medium: 35, hard: 45, expert: 100 };
    for (const fl of td.flexLanes) {
      const note = fl.isDouble ? 127 : 126;
      const key = `${fl.tick}:${fl.length}:${note}`;
      if (!emittedFlexLane.has(key)) {
        emittedFlexLane.set(key, diffVelocity[td.difficulty] ?? 100);
      } else {
        // Lower velocity = more inclusive, keep the lowest
        const existing = emittedFlexLane.get(key)!;
        const thisVel = diffVelocity[td.difficulty] ?? 100;
        if (thisVel < existing) {
          emittedFlexLane.set(key, thisVel);
        }
      }
    }

    // Cross-format conversion: .chart uses cymbal markers, MIDI uses tom markers.
    // If data has cymbal markers but no tom markers, generate tom markers for non-cymbal notes.
    if (isDrums) {
      const hasCymbalMarkers = td.trackEvents.some(e =>
        e.type === eventTypes.yellowCymbalMarker ||
        e.type === eventTypes.blueCymbalMarker ||
        e.type === eventTypes.greenCymbalMarker
      );
      const hasTomMarkers = td.trackEvents.some(e =>
        e.type === eventTypes.yellowTomMarker ||
        e.type === eventTypes.blueTomMarker ||
        e.type === eventTypes.greenTomMarker
      );

      if (hasCymbalMarkers && !hasTomMarkers) {
        // Collect cymbal marker ticks per lane
        const cymbalTicks = {
          yellow: new Set<number>(),
          blue: new Set<number>(),
          green: new Set<number>(),
        };
        for (const ev of td.trackEvents) {
          if (ev.type === eventTypes.yellowCymbalMarker) cymbalTicks.yellow.add(ev.tick);
          if (ev.type === eventTypes.blueCymbalMarker) cymbalTicks.blue.add(ev.tick);
          if (ev.type === eventTypes.greenCymbalMarker) cymbalTicks.green.add(ev.tick);
        }

        // For each drum note without a cymbal marker, emit a tom marker
        const noteToTom: [EventType, Set<number>, number][] = [
          [eventTypes.yellowDrum, cymbalTicks.yellow, 110],
          [eventTypes.blueDrum, cymbalTicks.blue, 111],
          [eventTypes.fiveOrangeFourGreenDrum, cymbalTicks.green, 112],
        ];
        for (const [noteType, cymbals, midiNote] of noteToTom) {
          for (const ev of td.trackEvents) {
            if (ev.type === noteType && !cymbals.has(ev.tick)) {
              // Use length 1 so the noteOff is at tick+1, ensuring correct
              // noteOn/noteOff ordering (zero-length notes have their noteOff
              // sorted before noteOn at the same tick, which breaks parsing).
              const tomLen = 1;
              const key = `${ev.tick}:${tomLen}:${midiNote}`;
              if (!emittedTomMarker.has(key)) {
                emittedTomMarker.add(key);
                addNoteOnOff(events, ev.tick, tomLen, midiNote, 100);
              }
            }
          }
        }
      }
    }
  }

  // Emit merged instrument-wide sections
  for (const sp of mergeOverlappingSections(allStarPower)) {
    addNoteOnOff(events, sp.tick, sp.length, 116, 100);
  }
  for (const solo of mergeOverlappingSections(allSolo)) {
    addNoteOnOff(events, solo.tick, solo.length, 103, 100);
  }
  for (const fs of mergeOverlappingSections(allActivation)) {
    addNoteOnOff(events, fs.tick, fs.length, 120, 100);
  }

  // Emit modifier sustain ranges for guitar/GHL instruments.
  //
  // scan-chart's MIDI parser splits SysEx modifier sustains into zero-length
  // events at each note tick (to match .chart's per-note format). Our patched
  // scan-chart preserves the original sustains in `modifierSustains`. When
  // available, use those directly; otherwise reconstruct ranges from zero-length
  // events (needed for .chart-sourced data or unpatched scan-chart).
  //
  // SysEx modifiers (forceTap, forceOpen): if all charted difficulties have
  // identical ranges, use 0xFF (all-difficulty); otherwise per-difficulty.
  // Note-based modifiers (forceHopo, forceStrum): per-difficulty note on/off.
  if (!isDrums && modifiersByDiff.size > 0) {
    const chartedDiffs = [...modifiersByDiff.keys()];
    const diffStarts = isGhl ? sixFretDiffStarts : fiveFretDiffStarts;
    const noteOffsets = isGhl ? sixFretNoteOffsets : fiveFretNoteOffsets;

    // Check if any difficulty has modifierSustains from the scan-chart patch
    const hasModifierSustains = trackDataEntries.some(
      td => td.modifierSustains && td.modifierSustains.length > 0,
    );

    if (hasModifierSustains) {
      // Use original sustain ranges from modifierSustains (MIDI-sourced data).
      // Collect per-difficulty, then merge identical ranges across difficulties.
      const sustainsByDiff = new Map<Difficulty, Map<EventType, { tick: number; length: number }[]>>();
      for (const td of trackDataEntries) {
        if (!td.modifierSustains) continue;
        let diffMap = sustainsByDiff.get(td.difficulty);
        if (!diffMap) {
          diffMap = new Map();
          sustainsByDiff.set(td.difficulty, diffMap);
        }
        for (const ms of td.modifierSustains) {
          let arr = diffMap.get(ms.type);
          if (!arr) {
            arr = [];
            diffMap.set(ms.type, arr);
          }
          arr.push({ tick: ms.tick, length: ms.length });
        }
      }

      // Emit SysEx modifiers
      for (const modType of sysExModifierTypes) {
        const typeByte = sysExTypeByte[modType]!;
        const rangesByDiff = new Map<Difficulty, { tick: number; length: number }[]>();
        for (const diff of chartedDiffs) {
          rangesByDiff.set(diff, sustainsByDiff.get(diff)?.get(modType) ?? []);
        }

        // If all difficulties have identical ranges, use 0xFF
        const rangeArrays = [...rangesByDiff.values()];
        const allIdentical = rangeArrays.length > 0 && rangeArrays.every(
          r => JSON.stringify(r) === JSON.stringify(rangeArrays[0]),
        );

        if (allIdentical && rangeArrays[0].length > 0) {
          for (const range of rangeArrays[0]) {
            addSysExOnOff(events, range.tick, range.length, 0xff, typeByte);
          }
        } else {
          for (const [diff, ranges] of rangesByDiff) {
            for (const range of ranges) {
              addSysExOnOff(events, range.tick, range.length, sysExDiffMap[diff], typeByte);
            }
          }
        }
      }

      // Emit note-based modifiers
      for (const modType of noteModifierTypes) {
        const offset = noteOffsets[modType];
        if (offset === undefined) continue;
        for (const [diff, diffMap] of sustainsByDiff) {
          for (const range of diffMap.get(modType) ?? []) {
            addNoteOnOff(events, range.tick, range.length, diffStarts[diff] + offset, 100);
          }
        }
      }
    } else {
      // Reconstruct ranges from zero-length per-note events (.chart-sourced data).
      // Deduplicate note ticks per difficulty
      for (const [diff, ticks] of noteTicksByDiff) {
        noteTicksByDiff.set(diff, [...new Set(ticks)]);
      }

      // SysEx modifiers
      for (const modType of sysExModifierTypes) {
        const typeByte = sysExTypeByte[modType]!;
        const rangesByDiff = new Map<Difficulty, { tick: number; length: number }[]>();
        for (const diff of chartedDiffs) {
          const mods = modifiersByDiff.get(diff)?.get(modType) ?? [];
          const noteTicks = noteTicksByDiff.get(diff) ?? [];
          rangesByDiff.set(diff, reconstructModifierRanges(mods, noteTicks));
        }

        const rangeArrays = [...rangesByDiff.values()];
        const allIdentical = rangeArrays.length > 0 && rangeArrays.every(
          r => JSON.stringify(r) === JSON.stringify(rangeArrays[0]),
        );

        if (allIdentical && rangeArrays[0].length > 0) {
          for (const range of rangeArrays[0]) {
            addSysExOnOff(events, range.tick, range.length, 0xff, typeByte);
          }
        } else {
          for (const [diff, ranges] of rangesByDiff) {
            for (const range of ranges) {
              addSysExOnOff(events, range.tick, range.length, sysExDiffMap[diff], typeByte);
            }
          }
        }
      }

      // Note-based modifiers
      for (const modType of noteModifierTypes) {
        const offset = noteOffsets[modType];
        if (offset === undefined) continue;
        for (const [diff, mods] of modifiersByDiff) {
          const modEvents = mods.get(modType) ?? [];
          const noteTicks = noteTicksByDiff.get(diff) ?? [];
          const ranges = reconstructModifierRanges(modEvents, noteTicks);
          for (const range of ranges) {
            addNoteOnOff(events, range.tick, range.length, diffStarts[diff] + offset, 100);
          }
        }
      }
    }
  }

  // Emit flex lanes with collected LDS velocities
  for (const [key, velocity] of emittedFlexLane) {
    const [tickStr, lengthStr, noteStr] = key.split(':');
    addNoteOnOff(events, Number(tickStr), Number(lengthStr), Number(noteStr), velocity);
  }

  // Disco flip text events → [mix <diffIdx> drums0], [mix <diffIdx> drums0d], etc.
  // Each difficulty can have its own disco flip event at a unique tick.
  // Deduplicate by tick+type+difficulty to emit one event per difficulty.
  if (isDrums) {
    const diffToIdx: Record<string, number> = { easy: 0, medium: 1, hard: 2, expert: 3 };
    const discoTypeToFlag: Partial<Record<EventType, string>> = {
      [eventTypes.discoFlipOff]: '',
      [eventTypes.discoFlipOn]: 'd',
      [eventTypes.discoNoFlipOn]: 'dnoflip',
    };
    const emittedDisco = new Set<string>();
    for (const td of trackDataEntries) {
      const diffIdx = diffToIdx[td.difficulty] ?? 3;
      for (const ev of td.trackEvents) {
        const flag = discoTypeToFlag[ev.type];
        if (flag !== undefined) {
          const key = `${ev.tick}:${ev.type}:${td.difficulty}`;
          if (!emittedDisco.has(key)) {
            emittedDisco.add(key);
            events.push({
              tick: ev.tick,
              event: {
                deltaTime: 0,
                meta: true,
                type: 'text',
                text: `[mix ${diffIdx} drums0${flag}]`,
              } as MidiEvent,
            });
          }
        }
      }
    }
  }

  // Emit [ENABLE_CHART_DYNAMICS] text event at tick 0 if any accents/ghosts are present
  if (isDrums && hasAccentsOrGhosts) {
    events.push({
      tick: 0,
      event: {
        deltaTime: 0,
        meta: true,
        type: 'text',
        text: '[ENABLE_CHART_DYNAMICS]',
      } as MidiEvent,
    });
  }

  // Emit ENHANCED_OPENS text event if any 5-fret track has open notes
  if (fiveFretInstruments.has(instrument)) {
    const hasOpen = trackDataEntries.some(td =>
      td.trackEvents.some(ev => ev.type === eventTypes.open),
    );
    if (hasOpen) {
      events.push({
        tick: 0,
        event: {
          deltaTime: 0,
          meta: true,
          type: 'text',
          text: '[ENHANCED_OPENS]',
        } as MidiEvent,
      });
    }
  }

  return finalizeMidiTrack(events);
}

/**
 * Build the PART VOCALS track: lyrics as meta events + phrase markers as
 * note 105 on/off pairs.
 */
function buildVocalsTrack(doc: ChartDocument): MidiEvent[] {
  const events: AbsoluteEvent[] = [];

  events.push({
    tick: 0,
    event: { deltaTime: 0, meta: true, type: 'trackName', text: 'PART VOCALS' } as MidiEvent,
  });

  // Lyrics as MIDI lyric meta events (type 0x05)
  for (const lyric of doc.lyrics) {
    events.push({
      tick: lyric.tick,
      event: { deltaTime: 0, meta: true, type: 'lyrics', text: lyric.text } as MidiEvent,
    });
  }

  // Vocal phrase markers as note on/off pairs.
  // scan-chart includes noteNumber (105 or 106) on each phrase entry.
  // Write each with its original note number. When multiple phrases share
  // the same tick and note number, alternate to note 106 to avoid
  // overlapping noteOn events on the same MIDI note (which scan-chart
  // can't distinguish on re-parse).
  const sortedPhrases = [...doc.vocalPhrases]
    .sort((a, b) => a.tick - b.tick);
  const usedAtTick = new Map<number, Set<number>>(); // tick → set of used note numbers
  for (const phrase of sortedPhrases) {
    let noteNum = (phrase as {noteNumber?: number}).noteNumber ?? 105;
    // If this tick+noteNumber already used, alternate to the other note number
    const usedNums = usedAtTick.get(phrase.tick);
    if (usedNums && usedNums.has(noteNum)) {
      noteNum = noteNum === 105 ? 106 : 105;
    }
    if (!usedAtTick.has(phrase.tick)) usedAtTick.set(phrase.tick, new Set());
    usedAtTick.get(phrase.tick)!.add(noteNum);
    addNoteOnOff(events, phrase.tick, Math.max(phrase.length, 1), noteNum, 100);
  }

  return finalizeMidiTrack(events);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sysExDiffMap: Record<Difficulty, number> = {
  easy: 0x00,
  medium: 0x01,
  hard: 0x02,
  expert: 0x03,
};

/**
 * Merge overlapping sections into non-overlapping ranges.
 *
 * MIDI cannot represent overlapping notes of the same pitch. When .chart has
 * per-difficulty star power / solo sections at overlapping tick ranges,
 * they must be merged before writing as note 116/103/120. Without merging,
 * the interleaved noteOn/noteOff pairs produce corrupt lengths on re-parse.
 */
function mergeOverlappingSections(
  sections: { tick: number; length: number }[],
): { tick: number; length: number }[] {
  if (sections.length === 0) return [];
  const sorted = [...sections].sort((a, b) => a.tick - b.tick);
  const merged: { tick: number; length: number }[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    const prevEnd = prev.tick + prev.length;
    if (curr.tick <= prevEnd) {
      const currEnd = curr.tick + curr.length;
      prev.length = Math.max(prevEnd, currEnd) - prev.tick;
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

/**
 * Reconstruct sustain ranges from zero-length modifier events.
 *
 * scan-chart's MIDI parser splits modifier sustains (forceTap, forceOpen,
 * forceHopo, forceStrum) into zero-length events at each note tick. This
 * function reverses that process: it finds contiguous runs of modified note
 * ticks and produces a single sustain range for each run.
 *
 * "Contiguous" means there are no unmodified notes between modified ones.
 * The range starts at the first modified note's tick and ends at the last
 * modified note's tick + max(length, 1).
 *
 * Events that already have a non-zero length are passed through as-is.
 */
function reconstructModifierRanges(
  modifierEvents: { tick: number; length: number }[],
  noteTicks: number[],
): { tick: number; length: number }[] {
  if (modifierEvents.length === 0) return [];

  // If events already have non-zero length, pass through as-is
  if (modifierEvents.some(e => e.length > 0)) {
    return modifierEvents;
  }

  const modifierTickSet = new Set(modifierEvents.map(e => e.tick));
  const sortedNoteTicks = [...noteTicks].sort((a, b) => a - b);

  // Walk through notes in order, finding contiguous runs of modified notes
  const ranges: { tick: number; length: number }[] = [];
  let rangeStart: number | null = null;
  let lastModifiedNoteTick: number | null = null;

  for (const noteTick of sortedNoteTicks) {
    if (modifierTickSet.has(noteTick)) {
      if (rangeStart === null) {
        rangeStart = noteTick;
      }
      lastModifiedNoteTick = noteTick;
    } else {
      // Unmodified note — close any open range
      if (rangeStart !== null && lastModifiedNoteTick !== null) {
        ranges.push({ tick: rangeStart, length: lastModifiedNoteTick - rangeStart + 1 });
        rangeStart = null;
        lastModifiedNoteTick = null;
      }
    }
  }
  // Close final range
  if (rangeStart !== null && lastModifiedNoteTick !== null) {
    ranges.push({ tick: rangeStart, length: lastModifiedNoteTick - rangeStart + 1 });
  }

  return ranges;
}

/**
 * Add a Phase Shift SysEx on/off pair (used for forceOpen, forceTap).
 * Format: [0x50, 0x53, 0x00, 0x00, diffByte, typeByte, isStart, 0xF7]
 *
 * diffByte is 0xFF for "all difficulties", or 0x00-0x03 for individual ones.
 */
function addSysExOnOff(
  events: AbsoluteEvent[],
  tick: number,
  length: number,
  diffByte: number,
  typeByte: number,
): void {
  events.push({
    tick,
    event: {
      deltaTime: 0,
      type: 'sysEx',
      data: new Uint8Array([0x50, 0x53, 0x00, 0x00, diffByte, typeByte, 0x01]),
    } as MidiEvent,
  });
  events.push({
    tick: tick + Math.max(length, 1),
    event: {
      deltaTime: 0,
      type: 'sysEx',
      data: new Uint8Array([0x50, 0x53, 0x00, 0x00, diffByte, typeByte, 0x00]),
    } as MidiEvent,
  });
}

/** Add a noteOn/noteOff pair to the events array. */
function addNoteOnOff(
  events: AbsoluteEvent[],
  tick: number,
  length: number,
  noteNumber: number,
  velocity: number,
): void {
  events.push({
    tick,
    event: {
      deltaTime: 0,
      channel: 0,
      type: 'noteOn',
      noteNumber,
      velocity,
    } as MidiEvent,
  });
  // noteOff at tick + length. Use at least 1 tick so noteOff comes after
  // noteOn (finalizeMidiTrack sorts noteOff before noteOn at equal ticks,
  // which would cause scan-chart to discard zero-length notes).
  events.push({
    tick: tick + Math.max(length, 1),
    event: {
      deltaTime: 0,
      channel: 0,
      type: 'noteOff',
      noteNumber,
      velocity: 0,
    } as MidiEvent,
  });
}

/**
 * Sort absolute-tick events, convert to delta-times, and append end-of-track.
 *
 * Sorting is stable: events at the same tick preserve insertion order, except
 * that noteOff events sort before noteOn events at the same tick (to close
 * notes before opening new ones at the same position).
 */
function finalizeMidiTrack(events: AbsoluteEvent[]): MidiEvent[] {
  // Stable sort by tick; at equal tick, noteOff before noteOn, then meta before channel events
  events.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    // noteOff before noteOn at same tick
    const aIsOff = a.event.type === 'noteOff' ? 0 : 1;
    const bIsOff = b.event.type === 'noteOff' ? 0 : 1;
    return aIsOff - bIsOff;
  });

  // Convert to delta times
  let prevTick = 0;
  const midiEvents: MidiEvent[] = [];
  for (const { tick, event } of events) {
    event.deltaTime = tick - prevTick;
    prevTick = tick;
    midiEvents.push(event);
  }

  // End of track
  midiEvents.push({
    deltaTime: 0,
    meta: true,
    type: 'endOfTrack',
  } as MidiEvent);

  return midiEvents;
}

/**
 * Group TrackData entries by instrument, preserving the order instruments
 * first appear in the array.
 */
function groupByInstrument(trackData: TrackData[]): Map<Instrument, TrackData[]> {
  const map = new Map<Instrument, TrackData[]>();
  for (const td of trackData) {
    let arr = map.get(td.instrument);
    if (!arr) {
      arr = [];
      map.set(td.instrument, arr);
    }
    arr.push(td);
  }
  return map;
}
