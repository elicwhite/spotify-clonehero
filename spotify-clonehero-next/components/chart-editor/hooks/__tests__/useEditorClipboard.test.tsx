/**
 * @jest-environment jsdom
 */
/**
 * Clipboard + delete behaviour of `useEditorKeyboard` (plan 0082 items 6
 * and 8): copy/cut/paste of notes and lyrics, cross-schema paste, single-step
 * undo of a paste, and Delete acting on a selected lyric.
 *
 * No `AudioManager` is mounted, so `getPlayheadTick` falls back to
 * `state.cursorTick` — the tests drive the playhead with `SET_CURSOR_TICK`.
 */

import '@testing-library/jest-dom';
import {useEffect} from 'react';
import {render, screen, fireEvent, act} from '@testing-library/react';
import {createEmptyChart, noteTypes} from '@eliwhite/scan-chart';
import type {NoteType} from '@eliwhite/scan-chart';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../../ChartEditorContext';
import {AudioServiceProvider} from '../../AudioServiceContext';
import {DEFAULT_GUITAR_EXPERT_SCOPE, trackQualifiedNoteId} from '../../scope';
import {getSelectedIds} from '@/lib/chart-editor-core';
import {useEditorKeyboard} from '../useEditorKeyboard';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import type {ChartDocument, NormalizedVocalTrack} from '@/lib/chart-edit';
import {
  addNote,
  bassSchema,
  guitarSchema,
  listNotes,
  lyricId,
  findTrack,
  schemaNoteId,
} from '@/lib/chart-edit';

const RESOLUTION = 192;

/** The editor's default snap. `gridDivision` counts subdivisions per WHOLE
 *  note, so 4 is the 1/4 grid. */
const GRID_DIVISION = 4;
/** One grid step in ticks: a whole note is `RESOLUTION * 4`, so the 1/4 grid
 *  steps by a quarter note (192 ticks). */
const GRID_STEP = (RESOLUTION * 4) / GRID_DIVISION;

const GUITAR_KEY = {instrument: 'guitar', difficulty: 'expert'} as const;
const BASS_KEY = {instrument: 'bass', difficulty: 'expert'} as const;

function vocalTracks(): NormalizedVocalTrack {
  return {
    parts: {
      vocals: {
        notePhrases: [
          {
            tick: 0,
            msTime: 0,
            length: 3840,
            msLength: 0,
            isPercussion: false,
            notes: [
              {tick: 0, msTime: 0, length: 60, msLength: 0},
              {tick: 192, msTime: 0, length: 60, msLength: 0},
            ],
            lyrics: [
              {tick: 0, msTime: 0, text: 'hel-', flags: 0},
              {tick: 192, msTime: 0, text: 'lo', flags: 0},
            ],
          },
        ],
        staticLyricPhrases: [],
        starPowerSections: [],
        rangeShifts: [],
      },
    },
    rangeShifts: [],
    lyricShifts: [],
  } as unknown as NormalizedVocalTrack;
}

function makeDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: RESOLUTION});
  parsed.trackData.push(emptyTrackData('guitar', 'expert'));
  parsed.trackData.push(emptyTrackData('bass', 'expert'));
  parsed.vocalTracks = vocalTracks();
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  const guitar = doc.parsedChart.trackData[0];
  // Green on the beat, red a sixteenth later (48 ticks at resolution 192).
  addNote(guitar, {tick: 768, type: noteTypes.green}, guitarSchema);
  addNote(guitar, {tick: 816, type: noteTypes.red}, guitarSchema);
  return doc;
}

const ctxRef: {current: ReturnType<typeof useChartEditorContext> | null} = {
  current: null,
};

function Harness() {
  const value = useChartEditorContext();
  useEditorKeyboard();

  useEffect(() => {
    ctxRef.current = value;
  });

  useEffect(() => {
    value.dispatch({type: 'SET_CHART_DOC', chartDoc: makeDoc()});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div data-testid="ready">{value.state.chartDoc ? 'loaded' : 'empty'}</div>
  );
}

function mount() {
  render(
    <AudioServiceProvider>
      <ChartEditorProvider activeScope={DEFAULT_GUITAR_EXPERT_SCOPE}>
        <Harness />
      </ChartEditorProvider>
    </AudioServiceProvider>,
  );
  expect(screen.getByTestId('ready')).toHaveTextContent('loaded');
}

function dispatch(
  action: Parameters<NonNullable<(typeof ctxRef)['current']>['dispatch']>[0],
) {
  act(() => {
    ctxRef.current!.dispatch(action);
  });
}

function guitarNotes() {
  const track = findTrack(ctxRef.current!.state.chartDoc!, GUITAR_KEY)!.track;
  return listNotes(track, guitarSchema);
}

function bassNotes() {
  const track = findTrack(ctxRef.current!.state.chartDoc!, BASS_KEY)!.track;
  return listNotes(track, bassSchema);
}

function lyrics() {
  return (
    ctxRef.current!.state.chartDoc!.parsedChart.vocalTracks?.parts?.[
      'vocals'
    ]?.notePhrases.flatMap(p => p.lyrics) ?? []
  );
}

function selectGuitarNotes(ticks: number[], types: NoteType[]) {
  dispatch({
    type: 'SET_SELECTION',
    kind: 'note',
    ids: new Set(
      ticks.map((tick, i) =>
        trackQualifiedNoteId(GUITAR_KEY, schemaNoteId(tick, types[i])),
      ),
    ),
  });
}

function key(k: string) {
  fireEvent.keyDown(document, {key: k, ctrlKey: true});
}

beforeEach(() => {
  ctxRef.current = null;
});

describe('paste (plan 0082 item 8)', () => {
  it('does nothing when the clipboard is empty', () => {
    mount();
    dispatch({type: 'SET_CURSOR_TICK', tick: 1920});
    key('v');
    expect(guitarNotes()).toHaveLength(2);
    expect(ctxRef.current!.state.undoEntries).toHaveLength(0);
  });

  it('pastes copied notes at the playhead, preserving their tick deltas', () => {
    mount();
    selectGuitarNotes([768, 816], [noteTypes.green, noteTypes.red]);
    key('c');
    expect(ctxRef.current!.state.clipboard?.notes.map(n => n.tick)).toEqual([
      0, 48,
    ]);

    dispatch({type: 'SET_CURSOR_TICK', tick: 1920});
    key('v');

    const ticks = guitarNotes().map(n => n.tick);
    expect(ticks).toEqual([768, 816, 1920, 1968]);
  });

  it('grid-snaps the anchor but keeps the subdivision inside the paste', () => {
    mount();
    selectGuitarNotes([768, 816], [noteTypes.green, noteTypes.red]);
    key('c');

    // gridDivision 4 (the 1/4 grid) => a 192-tick step, so a playhead at
    // 1930 snaps back to 1920.
    dispatch({type: 'SET_GRID_DIVISION', division: GRID_DIVISION});
    dispatch({type: 'SET_CURSOR_TICK', tick: 1930});
    key('v');

    expect(guitarNotes().map(n => n.tick)).toEqual([768, 816, 1920, 1968]);
  });

  it('undoes an entire paste in one step', () => {
    mount();
    selectGuitarNotes([768, 816], [noteTypes.green, noteTypes.red]);
    key('c');
    dispatch({type: 'SET_CURSOR_TICK', tick: 1920});
    key('v');
    expect(guitarNotes()).toHaveLength(4);
    expect(ctxRef.current!.state.undoEntries).toHaveLength(1);

    act(() => {
      fireEvent.keyDown(document, {key: 'z', ctrlKey: true});
    });
    expect(guitarNotes()).toHaveLength(2);
  });

  it('translates lanes through the target track schema on a cross-track paste', () => {
    mount();
    selectGuitarNotes([768, 816], [noteTypes.green, noteTypes.red]);
    key('c');

    dispatch({
      type: 'SET_ACTIVE_SCOPE',
      scope: {kind: 'track', track: BASS_KEY},
    });
    dispatch({type: 'SET_CURSOR_TICK', tick: 960});
    key('v');

    expect(bassNotes().map(n => ({tick: n.tick, type: n.type}))).toEqual([
      {tick: 960, type: noteTypes.green},
      {tick: 1008, type: noteTypes.red},
    ]);
    // The source track is untouched.
    expect(guitarNotes()).toHaveLength(2);
  });

  it('drops a pasted note that collides with an existing one and keeps the rest', () => {
    mount();
    selectGuitarNotes([768, 816], [noteTypes.green, noteTypes.red]);
    key('c');
    // Pasting back onto the source: the green at 768 already exists, the
    // red at 816 already exists, so nothing new appears.
    dispatch({type: 'SET_CURSOR_TICK', tick: 768});
    key('v');
    expect(guitarNotes()).toHaveLength(2);

    // A grid step later nothing collides, so the whole clipboard lands and
    // leaves two greens exactly one grid step apart.
    dispatch({type: 'SET_CURSOR_TICK', tick: 768 + GRID_STEP});
    key('v');
    expect(guitarNotes().map(n => n.tick)).toEqual([
      768,
      816,
      768 + GRID_STEP,
      816 + GRID_STEP,
    ]);

    // Copy those two greens and paste them anchored on the later one: the
    // first copy lands on the green that's already there and is dropped,
    // while the second still lands a grid step past it.
    selectGuitarNotes(
      [768, 768 + GRID_STEP],
      [noteTypes.green, noteTypes.green],
    );
    key('c');
    dispatch({type: 'SET_CURSOR_TICK', tick: 768 + GRID_STEP});
    key('v');
    expect(guitarNotes().map(n => n.tick)).toEqual([
      768,
      816,
      768 + GRID_STEP,
      816 + GRID_STEP,
      768 + 2 * GRID_STEP,
    ]);
  });

  it('pushes no undo step when every pasted note collides', () => {
    mount();
    selectGuitarNotes([768, 816], [noteTypes.green, noteTypes.red]);
    key('c');
    dispatch({type: 'SET_CURSOR_TICK', tick: 768});
    key('v');
    expect(guitarNotes()).toHaveLength(2);
    expect(ctxRef.current!.state.undoEntries).toHaveLength(0);
  });

  it('pushes no undo step when pasted lyrics land outside every phrase', () => {
    mount();
    dispatch({
      type: 'SET_SELECTION',
      kind: 'lyric',
      ids: new Set([lyricId(0)]),
    });
    key('c');
    // The fixture's only phrase spans ticks 0..3840.
    dispatch({type: 'SET_CURSOR_TICK', tick: 9600});
    key('v');
    expect(lyrics()).toHaveLength(2);
    expect(ctxRef.current!.state.undoEntries).toHaveLength(0);
  });

  it('pastes lyrics exactly at the playhead, preserving relative timing', () => {
    mount();
    dispatch({
      type: 'SET_SELECTION',
      kind: 'lyric',
      ids: new Set([lyricId(0), lyricId(192)]),
    });
    key('c');
    // 192 ticks at 120bpm / resolution 192 is one beat: 500ms.
    expect(ctxRef.current!.state.clipboard?.lyrics).toEqual([
      {offsetMs: 0, text: 'hel-'},
      {offsetMs: 500, text: 'lo'},
    ]);

    dispatch({type: 'SET_CURSOR_TICK', tick: 1000});
    key('v');

    expect(lyrics().map(l => ({tick: l.tick, text: l.text}))).toEqual([
      {tick: 0, text: 'hel-'},
      {tick: 192, text: 'lo'},
      {tick: 1000, text: 'hel-'},
      {tick: 1192, text: 'lo'},
    ]);
  });
});

describe('cut (plan 0082 item 8)', () => {
  it('copies then removes the selected notes in one undo step', () => {
    mount();
    selectGuitarNotes([768, 816], [noteTypes.green, noteTypes.red]);
    key('x');
    expect(guitarNotes()).toHaveLength(0);
    expect(ctxRef.current!.state.clipboard?.notes.map(n => n.tick)).toEqual([
      0, 48,
    ]);
    expect(ctxRef.current!.state.undoEntries).toHaveLength(1);
  });
});

describe('delete a selected lyric (plan 0082 item 6)', () => {
  it('Delete removes the selected syllable', () => {
    mount();
    dispatch({
      type: 'SET_SELECTION',
      kind: 'lyric',
      ids: new Set([lyricId(192)]),
    });
    fireEvent.keyDown(document, {key: 'Delete'});

    expect(lyrics().map(l => l.tick)).toEqual([0]);
    expect(getSelectedIds(ctxRef.current!.state, 'lyric').size).toBe(0);
  });

  it('Backspace removes the selected syllable too', () => {
    mount();
    dispatch({
      type: 'SET_SELECTION',
      kind: 'lyric',
      ids: new Set([lyricId(0)]),
    });
    fireEvent.keyDown(document, {key: 'Backspace'});

    expect(lyrics().map(l => l.tick)).toEqual([192]);
  });

  it('deletes co-selected notes and lyrics as a single undo step', () => {
    mount();
    selectGuitarNotes([768], [noteTypes.green]);
    dispatch({
      type: 'SET_SELECTION',
      kind: 'lyric',
      ids: new Set([lyricId(192)]),
    });
    fireEvent.keyDown(document, {key: 'Delete'});

    expect(guitarNotes().map(n => n.tick)).toEqual([816]);
    expect(lyrics().map(l => l.tick)).toEqual([0]);
    expect(ctxRef.current!.state.undoEntries).toHaveLength(1);
  });
});
