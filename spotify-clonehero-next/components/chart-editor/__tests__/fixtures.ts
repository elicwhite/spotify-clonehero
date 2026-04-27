/**
 * Shared fixture builders for chart-editor unit tests.
 *
 * Programmatic builders rather than checked-in JSON dumps — phase 8 will
 * change the operation model and JSON snapshots would rot.
 *
 * `expectDocsEqual(a, b)` does a deep-equal that strips non-comparable
 * fields (the assets array carries File-like blobs that don't survive
 * structuredClone in jsdom).
 */

import {createEmptyChart} from '@eliwhite/scan-chart';
import type {
  ChartDocument,
  NormalizedVocalPart,
  NormalizedVocalPhrase,
  ParsedTrackData,
} from '@/lib/chart-edit';
import {addDrumNote, addSection, addTempo} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';

/**
 * A deterministic doc with one expert drum track, two sections, two
 * tempo events, a single time signature, and a one-phrase vocals part.
 * Tick layout (resolution=480, 120 BPM):
 *   tick   0    480  960  1440 1920
 *          kick red  yelW blue green
 * Section "Intro" at tick 0; "Verse" at tick 1920.
 * Vocals: phrase 0..960 with two lyrics at 240 + 720.
 */
export function makeFixtureDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};

  const drums = doc.parsedChart.trackData[0];
  addDrumNote(drums, {tick: 0, type: 'kick'});
  addDrumNote(drums, {tick: 480, type: 'redDrum'});
  addDrumNote(drums, {tick: 960, type: 'yellowDrum', flags: {cymbal: true}});
  addDrumNote(drums, {tick: 1440, type: 'blueDrum'});
  addDrumNote(drums, {tick: 1920, type: 'greenDrum'});

  addSection(doc, 0, 'Intro');
  addSection(doc, 1920, 'Verse');
  addTempo(doc, 1920, 140);

  doc.parsedChart.vocalTracks = {
    parts: {vocals: vocalPart([phrase(0, 960, [240, 720])])},
    rangeShifts: [],
    lyricShifts: [],
  };

  return doc;
}

/** A doc with `vocals + harm1 + harm2` for multi-part editing tests. */
export function makeMultiPartVocalsDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  doc.parsedChart.vocalTracks = {
    parts: {
      vocals: vocalPart([phrase(0, 480, [240])]),
      harm1: vocalPart([phrase(0, 480, [120])]),
      harm2: vocalPart([phrase(0, 480, [60])]),
    },
    rangeShifts: [],
    lyricShifts: [],
  };
  return doc;
}

/**
 * Empty drum-track doc — useful when a test wants to start from scratch
 * and add notes/sections via commands rather than fixture data.
 */
export function makeEmptyDrumDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  return {parsedChart: parsed, assets: []};
}

/**
 * Compare two ChartDocuments. Strips `assets` (file blobs aren't
 * deep-comparable across the writer/parser round-trip) and any
 * `msTime` / `msLength` derived fields whose recomputation differs by
 * 1 ULP across the round-trip. Inside command tests we only care that
 * structural data (ticks, types, names, flags, lengths) survives the
 * execute → undo round-trip.
 */
export function normalizeDoc(doc: ChartDocument): unknown {
  return {
    parsedChart: {
      resolution: doc.parsedChart.resolution,
      tempos: doc.parsedChart.tempos.map(t => ({
        tick: t.tick,
        beatsPerMinute: t.beatsPerMinute,
      })),
      timeSignatures: doc.parsedChart.timeSignatures.map(ts => ({
        tick: ts.tick,
        numerator: ts.numerator,
        denominator: ts.denominator,
      })),
      sections: doc.parsedChart.sections.map(s => ({
        tick: s.tick,
        name: s.name,
      })),
      trackData: doc.parsedChart.trackData.map(t => ({
        instrument: t.instrument,
        difficulty: t.difficulty,
        notes: t.noteEventGroups
          .flat()
          .map(n => ({tick: n.tick, type: n.type, flags: n.flags}))
          .sort((a, b) =>
            a.tick === b.tick ? a.type - b.type : a.tick - b.tick,
          ),
      })),
      vocalTracks: {
        parts: Object.fromEntries(
          Object.entries(doc.parsedChart.vocalTracks?.parts ?? {}).map(
            ([name, part]) => [name, normalizeVocalPart(part)],
          ),
        ),
      },
    },
  };
}

function normalizeVocalPart(part: NormalizedVocalPart) {
  return {
    notePhrases: part.notePhrases.map(p => ({
      tick: p.tick,
      length: p.length,
      lyrics: p.lyrics.map(l => ({tick: l.tick, text: l.text})),
      notes: p.notes.map(n => ({tick: n.tick, length: n.length})),
    })),
  };
}

export function expectDocsEqual(a: ChartDocument, b: ChartDocument): void {
  expect(normalizeDoc(a)).toEqual(normalizeDoc(b));
}

// ---------------------------------------------------------------------------
// Local builders
// ---------------------------------------------------------------------------

function phrase(
  tick: number,
  length: number,
  lyricTicks: number[] = [],
): NormalizedVocalPhrase {
  return {
    tick,
    msTime: 0,
    length,
    msLength: 0,
    isPercussion: false,
    notes: lyricTicks.map(t => ({
      tick: t,
      msTime: 0,
      length: 60,
      msLength: 0,
      pitch: 60,
      type: 'pitched' as const,
    })),
    lyrics: lyricTicks.map(t => ({
      tick: t,
      msTime: 0,
      text: `s${t}`,
      flags: 0,
    })),
  };
}

function vocalPart(
  notePhrases: NormalizedVocalPhrase[] = [],
): NormalizedVocalPart {
  return {
    notePhrases,
    staticLyricPhrases: [],
    starPowerSections: [],
    rangeShifts: [],
    lyricShifts: [],
    textEvents: [],
  };
}

/** Re-export for tests that want to add tracks without re-importing. */
export {emptyTrackData};
export type {ParsedTrackData};
