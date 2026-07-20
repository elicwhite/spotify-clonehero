/**
 * Audio-anchor plumbing tests (plan 0064 editor-button addendum §2/§7).
 *
 * The `audioAnchor` on a `ChartDocument` — the chart-time position of
 * original audio sample 0 — must behave exactly like a note under tempo
 * hand-edits (KEEP-MS keeps `anchor.ms`, KEEP-TICKS keeps `anchor.tick`), and
 * audio-relative external inputs (aligned lyric syllables, decoded onsets)
 * must be shifted onto the padded timeline before being applied.
 */

import {
  AddBPMCommand,
  ReplaceLyricsCommand,
  RepredictTempoCommand,
} from '../commands';
import {makeFixtureDoc} from './fixtures';
import {getAudioAnchor, setAudioAnchor, retimeChart} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import type {AlignedSyllable} from '@/lib/lyrics-align/aligner';
import {
  buildTimedTempos,
  tickToMs,
  msToTick,
} from '@/lib/drum-transcription/timing';
import type {Synctrack} from '@/lib/tempo-map/types';
import type {DecodedOnsetsFile} from '@/lib/drum-transcription/ml/types';

/** makeFixtureDoc, fully retimed: 120bpm @ tick 0, 140bpm @ tick 1920,
 *  resolution 480. Notes @ 0/480/960/1440/1920. */
function fixture(): ChartDocument {
  const doc = makeFixtureDoc();
  retimeChart(doc.parsedChart);
  return doc;
}

function tickToMsUnder(doc: ChartDocument, tick: number): number {
  const timed = buildTimedTempos(
    doc.parsedChart.tempos,
    doc.parsedChart.resolution,
  );
  return tickToMs(tick, timed, doc.parsedChart.resolution);
}

function msToTickUnder(doc: ChartDocument, ms: number): number {
  const timed = buildTimedTempos(
    doc.parsedChart.tempos,
    doc.parsedChart.resolution,
  );
  return msToTick(ms, timed, doc.parsedChart.resolution);
}

describe('AddBPMCommand — audio anchor glue parity', () => {
  it('audio glue (KEEP-MS): anchor keeps ms, tick recomputes under the new map', () => {
    const before = fixture();
    // tick 960 is 2 beats @ 120bpm = 1000ms under the pre-edit map.
    const anchored = setAudioAnchor(before, {tick: 960, ms: 1000});
    expect(tickToMsUnder(anchored, 960)).toBeCloseTo(1000, 6);

    const after = new AddBPMCommand(0, 90, 'audio').execute(anchored);
    const anchor = getAudioAnchor(after)!;

    expect(anchor.ms).toBe(1000); // unchanged
    expect(anchor.tick).not.toBe(960); // the grid moved under it
    // The recomputed tick lands exactly where 1000ms maps to under the NEW
    // (90bpm-opening) tempo map.
    expect(anchor.tick).toBeCloseTo(msToTickUnder(after, 1000), 6);
  });

  it('grid glue (KEEP-TICKS): anchor keeps tick, ms recomputes under the new map', () => {
    const before = fixture();
    const anchored = setAudioAnchor(before, {tick: 960, ms: 1000});

    const after = new AddBPMCommand(0, 90, 'grid').execute(anchored);
    const anchor = getAudioAnchor(after)!;

    expect(anchor.tick).toBe(960); // unchanged
    expect(anchor.ms).not.toBe(1000); // the grid moved under it
    expect(anchor.ms).toBeCloseTo(tickToMsUnder(after, 960), 6);
  });

  it('execute leaves the input doc (and its anchor) untouched — valid undo snapshot', () => {
    const before = fixture();
    const anchored = setAudioAnchor(before, {tick: 960, ms: 1000});

    for (const glue of ['grid', 'audio'] as const) {
      const cmd = new AddBPMCommand(0, 90, glue);
      const after = cmd.execute(anchored);
      expect(after).not.toBe(anchored);
      expect(getAudioAnchor(anchored)).toEqual({tick: 960, ms: 1000});
    }
  });

  it('an un-anchored doc stays anchor-free through both glue modes', () => {
    const before = fixture();
    expect(getAudioAnchor(before)).toBeNull();

    for (const glue of ['grid', 'audio'] as const) {
      const after = new AddBPMCommand(0, 90, glue).execute(before);
      expect(getAudioAnchor(after)).toBeNull();
    }
  });
});

describe('ReplaceLyricsCommand — audio-relative syllable shift (addendum §7)', () => {
  function syl(text: string, startMs: number, endMs?: number): AlignedSyllable {
    return {
      text,
      startMs,
      endMs: endMs ?? startMs + 50,
      joinNext: false,
      newLine: true,
    };
  }

  it('lands syllables at time + anchor.ms when the doc has a leading-silence anchor', () => {
    const before = fixture();
    const anchored = setAudioAnchor(before, {tick: 0, ms: 1000});

    const cmd = new ReplaceLyricsCommand([syl('hi', 500)]);
    const after = cmd.execute(anchored);

    const lyric =
      after.parsedChart.vocalTracks!.parts['vocals'].notePhrases[0].lyrics[0];
    // 500ms original-audio-relative + 1000ms anchor = 1500ms on the padded
    // timeline; at 120bpm/res480 that's exactly tick 1440.
    expect(lyric.tick).toBe(msToTickUnder(anchored, 1500));
  });

  it('lands syllables unshifted when the doc has no anchor', () => {
    const before = fixture();
    expect(getAudioAnchor(before)).toBeNull();

    const cmd = new ReplaceLyricsCommand([syl('hi', 500)]);
    const after = cmd.execute(before);

    const lyric =
      after.parsedChart.vocalTracks!.parts['vocals'].notePhrases[0].lyrics[0];
    expect(lyric.tick).toBe(msToTickUnder(before, 500));
  });

  it('redo (re-execute against the restored snapshot) does not double-shift', () => {
    const before = fixture();
    const anchored = setAudioAnchor(before, {tick: 0, ms: 1000});

    const cmd = new ReplaceLyricsCommand([syl('hi', 500)]);
    const once = cmd.execute(anchored);
    // Undo is snapshot replay: redo re-executes against the SAME pre-command
    // doc (`anchored`), not the previous output — `anchored` is untouched by
    // the first execute(), so this is exactly what the reducer's redo does.
    const twice = cmd.execute(anchored);

    const lyricOnce =
      once.parsedChart.vocalTracks!.parts['vocals'].notePhrases[0].lyrics[0];
    const lyricTwice =
      twice.parsedChart.vocalTracks!.parts['vocals'].notePhrases[0].lyrics[0];
    expect(lyricTwice.tick).toBe(lyricOnce.tick);
    expect(lyricTwice.tick).toBe(msToTickUnder(anchored, 1500));
  });
});

describe('RepredictTempoCommand — onset shift + anchor refresh (addendum §7)', () => {
  const RES = 480;
  const SYNC_120: Synctrack = {
    origin_ms: 0,
    tempos: [{ms: 0, bpm: 120}],
    timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
  };

  function onsetsAt(...timesSeconds: number[]): DecodedOnsetsFile {
    return {
      version: 1,
      flow: 'audio',
      onsets: timesSeconds.map(t => ({
        timeSeconds: t,
        drumClass: 'BD' as const,
        midiPitch: 36,
        confidence: 0.9,
      })),
    };
  }

  it('keeps the anchor ms and refreshes its tick under the corrected map', () => {
    const before = fixture();
    const anchored = setAudioAnchor(before, {tick: 960, ms: 1000});

    const cmd = new RepredictTempoCommand(SYNC_120, onsetsAt(0.1, 0.6));
    const after = cmd.execute(anchored);
    const anchor = getAudioAnchor(after)!;

    expect(anchor.ms).toBe(1000);
    expect(anchor.tick).toBeCloseTo(msToTickUnder(after, 1000), 6);
  });

  it('shifts onsets onto the padded timeline before re-deriving notes', () => {
    void RES;
    // Onset at 0.1s (100ms) original-audio-relative; with a 1000ms anchor it
    // should land near 1100ms on the padded map, not near the unshifted
    // 100ms — buildDrumsTrackFromOnsets' own systematic-offset/phase-align
    // snapping means it won't be bit-exact, so assert proximity.
    const before = fixture();
    const anchored = setAudioAnchor(before, {tick: 0, ms: 1000});
    const cmd = new RepredictTempoCommand(SYNC_120, onsetsAt(0.1));
    const after = cmd.execute(anchored);
    const kickTrack = after.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    )!;
    const tick = kickTrack.noteEventGroups.flat()[0]!.tick;
    const shiftedTick = msToTickUnder(after, 1100);
    const unshiftedTick = msToTickUnder(after, 100);
    expect(Math.abs(tick - shiftedTick)).toBeLessThan(50);
    expect(Math.abs(tick - unshiftedTick)).toBeGreaterThan(800);
  });
});
