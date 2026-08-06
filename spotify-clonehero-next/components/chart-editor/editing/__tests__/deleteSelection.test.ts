/**
 * Mixed-selection Delete tests.
 *
 * The piano roll's marquee can sweep notes, lyrics, section flags,
 * time-signature chips and tempo markers into the selection at once.
 * Deleting that has to be ONE undo step, and the tempo markers have to go
 * out as one batched command placed after everything whose id is derived
 * from a tick.
 */

import {
  chartEditorReducer,
  initialState,
  type ChartEditorState,
} from '@/lib/chart-editor-core';
import type {ChartDocument, TrackKey} from '@/lib/chart-edit';
import {addTimeSignature, lyricId, retimeChart} from '@/lib/chart-edit';
import {noteTypes} from '@eliwhite/scan-chart';
import {
  BatchCommand,
  DeleteTempoMarkersCommand,
  noteId,
  type EditCommand,
} from '../../commands';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '../../scope';
import {makeFixtureDoc} from '../../__tests__/fixtures';
import {buildDeleteSelectionCommands} from '../deleteSelection';

const DRUMS_KEY: TrackKey = {instrument: 'drums', difficulty: 'expert'};

/** The shared fixture, with a second time signature and a third tempo
 *  marker so every deletable kind has something to select. */
function fixture(): ChartDocument {
  const doc = makeFixtureDoc();
  addTimeSignature(doc, 960, 3, 4);
  doc.parsedChart.tempos.push({tick: 960, beatsPerMinute: 100, msTime: 0});
  doc.parsedChart.tempos.sort((a, b) => a.tick - b.tick);
  retimeChart(doc.parsedChart);
  return doc;
}

/** State holding a mixed selection across every deletable kind. */
function mixedState(doc: ChartDocument): ChartEditorState {
  let state: ChartEditorState = {
    ...initialState,
    chartDoc: doc,
    activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
  };
  const select = (kind: Parameters<typeof selectAction>[0], ids: string[]) => {
    state = chartEditorReducer(state, selectAction(kind, ids));
  };
  select('note', [noteId({tick: 480, type: noteTypes.redDrum})]);
  select('lyric', [lyricId(240, 'vocals')]);
  select('section', ['1920']);
  select('timesig', ['960']);
  select('tempo', ['960', '1920']);
  // Phrase edges ride along in a real marquee but are never deletable.
  select('phrase-start', ['vocals:0']);
  return state;
}

function selectAction(kind: string, ids: string[]) {
  return {
    type: 'SET_SELECTION' as const,
    kind: kind as 'note',
    ids: new Set(ids),
  };
}

function build(doc: ChartDocument, state: ChartEditorState): EditCommand[] {
  return buildDeleteSelectionCommands({
    state,
    chartDoc: doc,
    noteIds: new Set([noteId({tick: 480, type: noteTypes.redDrum})]),
    trackKey: DRUMS_KEY,
    glue: 'audio',
  });
}

describe('buildDeleteSelectionCommands', () => {
  it('queues everything tick-keyed before the tempo markers', () => {
    const doc = fixture();
    const commands = build(doc, mixedState(doc));

    expect(commands.map(c => c.constructor.name)).toEqual([
      'DeleteNotesCommand',
      'DeleteLyricCommand',
      'DeleteSectionCommand',
      'RemoveTimeSignatureCommand',
      'DeleteTempoMarkersCommand',
    ]);
  });

  it('batches N tempo markers into a single command', () => {
    const doc = fixture();
    const commands = build(doc, mixedState(doc));
    const tempoCommands = commands.filter(
      c => c instanceof DeleteTempoMarkersCommand,
    );
    expect(tempoCommands).toHaveLength(1);

    const after = new BatchCommand(commands).execute(doc);
    expect(after.parsedChart.tempos.map(t => t.tick)).toEqual([0]);
  });

  it('deletes every selected kind in one batch', () => {
    const doc = fixture();
    const after = new BatchCommand(build(doc, mixedState(doc))).execute(doc);

    const notes = after.parsedChart.trackData[0].noteEventGroups.flat();
    expect(notes.some(n => n.type === noteTypes.redDrum)).toBe(false);
    expect(after.parsedChart.sections.map(s => s.tick)).toEqual([0]);
    expect(after.parsedChart.timeSignatures.some(ts => ts.tick === 960)).toBe(
      false,
    );
    expect(after.parsedChart.tempos.map(t => t.tick)).toEqual([0]);
    const lyrics = after.parsedChart
      .vocalTracks!.parts['vocals'].notePhrases.flatMap(p => p.lyrics)
      .map(l => l.tick);
    expect(lyrics).not.toContain(240);
  });

  it('leaves phrase edges alone', () => {
    const doc = fixture();
    const after = new BatchCommand(build(doc, mixedState(doc))).execute(doc);
    expect(
      after.parsedChart.vocalTracks!.parts['vocals'].notePhrases,
    ).toHaveLength(1);
  });

  it('never deletes the tick-0 tempo anchor or the initial meter', () => {
    const doc = fixture();
    let state: ChartEditorState = {
      ...initialState,
      chartDoc: doc,
      activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
    };
    state = chartEditorReducer(state, selectAction('tempo', ['0']));
    state = chartEditorReducer(state, selectAction('timesig', ['0']));

    const commands = buildDeleteSelectionCommands({
      state,
      chartDoc: doc,
      noteIds: new Set(),
      trackKey: DRUMS_KEY,
      glue: 'audio',
    });
    expect(commands).toEqual([]);
  });

  it('returns nothing when the selection is empty', () => {
    const doc = fixture();
    const commands = buildDeleteSelectionCommands({
      state: {...initialState, chartDoc: doc},
      chartDoc: doc,
      noteIds: new Set(),
      trackKey: DRUMS_KEY,
      glue: 'audio',
    });
    expect(commands).toEqual([]);
  });
});

describe('a mixed delete is a single undo step', () => {
  it('one EXECUTE_COMMAND, one UNDO, everything back', () => {
    const doc = fixture();
    const state = mixedState(doc);
    const batch = new BatchCommand(build(doc, state), 'Delete 5 item(s)');

    const afterDoc = batch.execute(doc);
    const executed = chartEditorReducer(state, {
      type: 'EXECUTE_COMMAND',
      command: batch,
      chartDoc: afterDoc,
    });

    // One entry on the undo stack, regardless of how many kinds went out.
    expect(executed.undoEntries).toHaveLength(1);

    const undone = chartEditorReducer(executed, {
      type: 'UNDO',
      chartDoc: executed.undoEntries[0].doc,
    });
    expect(undone.undoEntries).toHaveLength(0);
    expect(undone.chartDoc!.parsedChart.tempos.map(t => t.tick)).toEqual([
      0, 960, 1920,
    ]);
    expect(undone.chartDoc!.parsedChart.sections.map(s => s.tick)).toEqual([
      0, 1920,
    ]);
    expect(
      undone.chartDoc!.parsedChart.timeSignatures.map(ts => ts.tick),
    ).toEqual([0, 960]);
    const notes = undone
      .chartDoc!.parsedChart.trackData[0].noteEventGroups.flat()
      .map(n => n.tick)
      .sort((a, b) => a - b);
    expect(notes).toEqual([0, 480, 960, 1440, 1920]);
  });
});
