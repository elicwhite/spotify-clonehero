/**
 * Clipboard offset arithmetic (plan 0082 item 8).
 *
 * Notes keep tick deltas across a tempo change (the subdivision structure
 * they were copied from survives); lyrics keep millisecond deltas.
 */

import {noteTypes} from '@eliwhite/scan-chart';
import {buildTimedTempos, tickToMs} from '@/lib/drum-transcription/timing';
import {
  isClipboardEmpty,
  pasteAnchorTick,
  pasteLyricsAt,
  pasteNotesAt,
  toClipboardLyrics,
  toClipboardNotes,
} from '../clipboard';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '@/components/chart-editor/scope';

const RESOLUTION = 192;

/** 120bpm from tick 0, doubling to 240bpm at tick 1920 (bar 3). */
const TEMPOS = buildTimedTempos(
  [
    {tick: 0, beatsPerMinute: 120},
    {tick: 1920, beatsPerMinute: 240},
  ],
  RESOLUTION,
);

describe('isClipboardEmpty', () => {
  it('treats null and an all-empty payload as empty', () => {
    expect(isClipboardEmpty(null)).toBe(true);
    expect(
      isClipboardEmpty({
        notes: [],
        lyrics: [],
        sourceScope: DEFAULT_DRUMS_EXPERT_SCOPE,
      }),
    ).toBe(true);
  });

  it('is not empty when it holds only lyrics', () => {
    expect(
      isClipboardEmpty({
        notes: [],
        lyrics: [{offsetMs: 0, text: 'la'}],
        sourceScope: DEFAULT_DRUMS_EXPERT_SCOPE,
      }),
    ).toBe(false);
  });
});

describe('toClipboardNotes', () => {
  it('rebases onto the earliest note', () => {
    expect(
      toClipboardNotes([
        {tick: 960, type: noteTypes.red, length: 0, flags: 0},
        {tick: 768, type: noteTypes.green, length: 0, flags: 0},
        {tick: 816, type: noteTypes.yellow, length: 0, flags: 0},
      ]).map(n => n.tick),
    ).toEqual([192, 0, 48]);
  });

  it('returns an empty array for no notes', () => {
    expect(toClipboardNotes([])).toEqual([]);
  });
});

describe('pasteAnchorTick', () => {
  it('snaps the playhead to the current grid division', () => {
    // The editor's one lattice: `gridDivision` is subdivisions per whole
    // note, so at resolution 192 division 4 steps by a quarter note (192
    // ticks) and division 16 by a sixteenth (48).
    expect(RESOLUTION).toBe(192);
    expect(pasteAnchorTick(1000, RESOLUTION, 4)).toBe(960);
    expect(pasteAnchorTick(1000, RESOLUTION, 16)).toBe(1008);
  });

  it('leaves the playhead alone on the free grid', () => {
    expect(pasteAnchorTick(1000.4, RESOLUTION, 0)).toBe(1000);
  });

  it('never returns a negative tick', () => {
    expect(pasteAnchorTick(-50, RESOLUTION, 4)).toBe(0);
  });
});

describe('pasteNotesAt', () => {
  it('lands the first note on the anchor and preserves tick deltas', () => {
    const clip = toClipboardNotes([
      {tick: 768, type: noteTypes.green, length: 0, flags: 0},
      {tick: 816, type: noteTypes.yellow, length: 0, flags: 0},
      {tick: 960, type: noteTypes.red, length: 0, flags: 0},
    ]);
    expect(pasteNotesAt(clip, 2880).map(n => n.tick)).toEqual([
      2880, 2928, 3072,
    ]);
  });

  it('keeps the subdivision structure when the destination tempo differs', () => {
    // Copied from the 120bpm region, pasted into the 240bpm region: the
    // notes stay a sixteenth apart in BEATS even though they are now half
    // as far apart in wall-clock time.
    const clip = toClipboardNotes([
      {tick: 0, type: noteTypes.green, length: 0, flags: 0},
      {tick: 48, type: noteTypes.red, length: 0, flags: 0},
    ]);
    const pasted = pasteNotesAt(clip, 1920);
    expect(pasted.map(n => n.tick)).toEqual([1920, 1968]);

    const sourceGapMs =
      tickToMs(48, TEMPOS, RESOLUTION) - tickToMs(0, TEMPOS, RESOLUTION);
    const pastedGapMs =
      tickToMs(1968, TEMPOS, RESOLUTION) - tickToMs(1920, TEMPOS, RESOLUTION);
    expect(pastedGapMs).toBeCloseTo(sourceGapMs / 2, 6);
  });

  it('carries note type, length and flags through untouched', () => {
    const pasted = pasteNotesAt(
      [{tick: 0, type: noteTypes.blue, length: 240, flags: 5}],
      480,
    );
    expect(pasted[0]).toEqual({
      tick: 480,
      type: noteTypes.blue,
      length: 240,
      flags: 5,
    });
  });
});

describe('lyric clipboard timing', () => {
  it('stores millisecond offsets from the earliest syllable', () => {
    const clip = toClipboardLyrics(
      [
        {tick: 192, text: 'hel-'},
        {tick: 0, text: 'oh'},
        {tick: 384, text: 'lo'},
      ],
      TEMPOS,
      RESOLUTION,
    );
    expect(clip.map(l => l.text)).toEqual(['oh', 'hel-', 'lo']);
    // 192 ticks at 120bpm/res 192 is one beat: 500ms.
    expect(clip.map(l => l.offsetMs)).toEqual([0, 500, 1000]);
  });

  it('pastes the first syllable exactly on the playhead', () => {
    const clip = toClipboardLyrics(
      [
        {tick: 100, text: 'a'},
        {tick: 292, text: 'b'},
      ],
      TEMPOS,
      RESOLUTION,
    );
    const placed = pasteLyricsAt(clip, 733, TEMPOS, RESOLUTION);
    expect(placed[0]).toEqual({tick: 733, text: 'a'});
  });

  it('preserves real-time spacing when pasted into a faster region', () => {
    const clip = toClipboardLyrics(
      [
        {tick: 0, text: 'a'},
        {tick: 192, text: 'b'},
      ],
      TEMPOS,
      RESOLUTION,
    );
    const placed = pasteLyricsAt(clip, 1920, TEMPOS, RESOLUTION);
    // 500ms at 240bpm covers two beats, i.e. 384 ticks.
    expect(placed.map(l => l.tick)).toEqual([1920, 2304]);
    const gapMs =
      tickToMs(placed[1].tick, TEMPOS, RESOLUTION) -
      tickToMs(placed[0].tick, TEMPOS, RESOLUTION);
    expect(gapMs).toBeCloseTo(500, 6);
  });

  it('returns nothing for an empty clipboard', () => {
    expect(pasteLyricsAt([], 480, TEMPOS, RESOLUTION)).toEqual([]);
    expect(toClipboardLyrics([], TEMPOS, RESOLUTION)).toEqual([]);
  });

  it('never places a syllable before tick 0', () => {
    const placed = pasteLyricsAt(
      [
        {offsetMs: 0, text: 'a'},
        {offsetMs: -5000, text: 'b'},
      ],
      0,
      TEMPOS,
      RESOLUTION,
    );
    expect(placed.map(l => l.tick)).toEqual([0, 0]);
  });
});
