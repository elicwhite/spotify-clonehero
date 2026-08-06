/**
 * Whole-panel marquee tests: band membership (`bandsTouched`) and the
 * multi-kind sweep (`computeMarqueeSelection`).
 *
 * These are the hit-region maths behind "drag selection works for
 * everything in the piano roll": a rectangle that spans several bands
 * selects from each of them, and a rectangle kept inside one band selects
 * only that band's entities — which is how a selection is narrowed, with
 * no modifier key.
 *
 * Pure functions; the screen-to-world conversion is the caller's job, so
 * these pass already-converted bounds and already-measured band tops.
 */

import {
  bandsTouched,
  computeMarqueeSelection,
  emptyMarqueeSelection,
  selectEntitiesInMsRange,
  type MarqueeSources,
  type PanelBands,
} from '../marquee';
import {drums4LaneSchema, phraseEndId, phraseStartId} from '@/lib/chart-edit';
import type {DrumNote} from '@/lib/chart-edit';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import {noteId} from '../../commands';
import {noteTypes} from '@eliwhite/scan-chart';

/** 120 BPM, resolution 480: 1 beat = 500ms. */
const TIMED_TEMPOS: TimedTempo[] = [{tick: 0, beatsPerMinute: 120, msTime: 0}];
const RESOLUTION = 480;

/** The panel's real band stack: ruler 0..24, lyrics 24..46, tempo 46..72,
 *  note lanes 72..272. */
const BANDS: PanelBands = {
  rulerTop: 0,
  rulerBottom: 24,
  lyricsTop: 24,
  lyricsBottom: 46,
  tempoTop: 46,
  tempoBottom: 72,
  laneTop: 72,
  laneBottom: 272,
};

const ALL_KINDS = new Set([
  'note',
  'lyric',
  'phrase-start',
  'phrase-end',
  'tempo',
  'timesig',
  'section',
]);

function note(tick: number, type: DrumNote['type']): DrumNote {
  return {tick, type, length: 0, flags: 0};
}

/**
 * One entity of every kind, all inside 400..1100ms (ticks 384..1056), plus
 * a tick-0 tempo marker and tick-0 signature that must never be selectable.
 */
function sources(): MarqueeSources {
  return {
    notes: [
      note(480, noteTypes.redDrum),
      note(960, noteTypes.yellowDrum),
      note(2880, noteTypes.blueDrum),
    ],
    schema: drums4LaneSchema,
    timedTempos: TIMED_TEMPOS,
    resolution: RESOLUTION,
    lyricChips: [
      {id: 'vocals:480', ms: 500},
      {id: 'vocals:2880', ms: 3000},
    ],
    phraseBands: [{tick: 480, ms: 500, tickEnd: 960, msEnd: 1000}],
    partName: 'vocals',
    tempoMarkers: [
      {tick: 0, ms: 0},
      {tick: 480, ms: 500},
      {tick: 2880, ms: 3000},
    ],
    timeSignatures: [
      {tick: 0, ms: 0},
      {tick: 960, ms: 1000},
    ],
    sections: [
      {tick: 480, ms: 500},
      {tick: 2880, ms: 3000},
    ],
  };
}

/** Bounds covering 400..1100ms across every drum lane. */
const WIDE_BOUNDS = {msMin: 400, msMax: 1100, laneMin: 0, laneMax: 4};

describe('bandsTouched', () => {
  it('reports every band a tall rectangle crosses', () => {
    expect(bandsTouched(10, 200, BANDS)).toEqual({
      ruler: true,
      lyrics: true,
      tempo: true,
      lanes: true,
    });
  });

  it('reports only the band a rectangle stays inside', () => {
    expect(bandsTouched(50, 68, BANDS)).toEqual({
      ruler: false,
      lyrics: false,
      tempo: true,
      lanes: false,
    });
  });

  it('counts a purely horizontal drag as inside its own band', () => {
    expect(bandsTouched(60, 60, BANDS).tempo).toBe(true);
    expect(bandsTouched(60, 60, BANDS).lanes).toBe(false);
  });

  it('does not spill into the next band when the drag stops on the boundary', () => {
    // Exactly the tempo lane's span: the note lanes start at its bottom.
    expect(bandsTouched(46, 72, BANDS)).toEqual({
      ruler: false,
      lyrics: false,
      tempo: true,
      lanes: false,
    });
  });

  it('never touches a zero-height (hidden) band', () => {
    const noLyrics: PanelBands = {
      ...BANDS,
      lyricsTop: 24,
      lyricsBottom: 24,
      tempoTop: 24,
      tempoBottom: 50,
      laneTop: 50,
    };
    expect(bandsTouched(0, 300, noLyrics).lyrics).toBe(false);
  });
});

describe('selectEntitiesInMsRange', () => {
  it('is inclusive on both ends', () => {
    const picked = selectEntitiesInMsRange(
      [
        {id: 'a', ms: 400},
        {id: 'b', ms: 700},
        {id: 'c', ms: 1100},
        {id: 'd', ms: 1101},
      ],
      400,
      1100,
    );
    expect(picked).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('computeMarqueeSelection', () => {
  it('a rectangle spanning several bands selects from each of them', () => {
    const result = computeMarqueeSelection({
      bounds: WIDE_BOUNDS,
      touched: bandsTouched(10, 200, BANDS),
      allowed: ALL_KINDS,
      sources: sources(),
    });

    expect(result.note).toEqual(
      new Set([
        noteId({tick: 480, type: noteTypes.redDrum}),
        noteId({tick: 960, type: noteTypes.yellowDrum}),
      ]),
    );
    expect(result.lyric).toEqual(new Set(['vocals:480']));
    expect(result['phrase-start']).toEqual(
      new Set([phraseStartId(480, 'vocals')]),
    );
    expect(result['phrase-end']).toEqual(new Set([phraseEndId(960, 'vocals')]));
    expect(result.tempo).toEqual(new Set(['480']));
    expect(result.timesig).toEqual(new Set(['960']));
    expect(result.section).toEqual(new Set(['480']));
  });

  it('a rectangle inside the tempo lane selects only tempo-lane entities', () => {
    const result = computeMarqueeSelection({
      bounds: WIDE_BOUNDS,
      touched: bandsTouched(50, 68, BANDS),
      allowed: ALL_KINDS,
      sources: sources(),
    });

    expect(result.tempo).toEqual(new Set(['480']));
    expect(result.timesig).toEqual(new Set(['960']));
    expect(result.note.size).toBe(0);
    expect(result.lyric.size).toBe(0);
    expect(result['phrase-start'].size).toBe(0);
    expect(result['phrase-end'].size).toBe(0);
    expect(result.section.size).toBe(0);
  });

  it('a rectangle inside the note lanes selects only notes', () => {
    const result = computeMarqueeSelection({
      bounds: WIDE_BOUNDS,
      touched: bandsTouched(100, 200, BANDS),
      allowed: ALL_KINDS,
      sources: sources(),
    });

    expect(result.note.size).toBe(2);
    expect(result.lyric.size).toBe(0);
    expect(result.tempo.size).toBe(0);
    expect(result.timesig.size).toBe(0);
    expect(result.section.size).toBe(0);
  });

  it('a rectangle inside the lyrics row selects chips and phrase edges only', () => {
    const result = computeMarqueeSelection({
      bounds: WIDE_BOUNDS,
      touched: bandsTouched(28, 42, BANDS),
      allowed: ALL_KINDS,
      sources: sources(),
    });

    expect(result.lyric).toEqual(new Set(['vocals:480']));
    expect(result['phrase-start'].size).toBe(1);
    expect(result['phrase-end'].size).toBe(1);
    expect(result.note.size).toBe(0);
    expect(result.tempo.size).toBe(0);
  });

  it('an empty rectangle selects nothing at all', () => {
    const result = computeMarqueeSelection({
      bounds: {msMin: 1500, msMax: 1600, laneMin: 0, laneMax: 4},
      touched: bandsTouched(10, 200, BANDS),
      allowed: ALL_KINDS,
      sources: sources(),
    });
    expect(result).toEqual(emptyMarqueeSelection());
  });

  it('never selects the tick-0 tempo anchor or the initial time signature', () => {
    const result = computeMarqueeSelection({
      bounds: {msMin: 0, msMax: 5000, laneMin: 0, laneMax: 4},
      touched: bandsTouched(10, 200, BANDS),
      allowed: ALL_KINDS,
      sources: sources(),
    });
    expect(result.tempo).toEqual(new Set(['480', '2880']));
    expect(result.timesig).toEqual(new Set(['960']));
  });

  it('honors the page capabilities: a kind that is not selectable stays empty', () => {
    const result = computeMarqueeSelection({
      bounds: {msMin: 0, msMax: 5000, laneMin: 0, laneMax: 4},
      touched: bandsTouched(10, 200, BANDS),
      allowed: new Set(['tempo', 'timesig']),
      sources: sources(),
    });
    expect(result.tempo.size).toBe(2);
    expect(result.timesig.size).toBe(1);
    expect(result.note.size).toBe(0);
    expect(result.lyric.size).toBe(0);
    expect(result.section.size).toBe(0);
  });
});
