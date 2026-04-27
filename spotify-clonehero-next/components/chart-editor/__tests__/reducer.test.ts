/**
 * Reducer-correctness tests.
 *
 * Covers EXECUTE_COMMAND / UNDO / REDO / SET_SELECTION / MARK_SAVED /
 * SET_ACTIVE_SCOPE and the snapshot stack-cap. These are pre-phase-8
 * tests — they exercise the doc-snapshot undo path. Phase 8 will
 * replace that path with invertible operations and rebuild the test set
 * around `apply(invert(apply(doc, op))) === doc`.
 */

import {parseChartFile, writeChartFolder} from '@eliwhite/scan-chart';
import type {ChartDocument} from '@/lib/chart-edit';
import {
  chartEditorReducer,
  initialState,
  type ChartEditorState,
} from '../ChartEditorContext';
import type {EditCommand} from '../commands';
import {AddNoteCommand} from '../commands';
import {DEFAULT_DRUMS_EXPERT_SCOPE, DEFAULT_VOCALS_SCOPE} from '../scope';
import {makeFixtureDoc} from './fixtures';

/** Helper: round-trip a ChartDocument through the writer + parser the way
 *  `useExecuteCommand` does, so EXECUTE_COMMAND actions can be assembled
 *  with a real `chart` field. */
function reparse(doc: ChartDocument) {
  const files = writeChartFolder({
    parsedChart: {...doc.parsedChart, format: 'chart'},
    assets: doc.assets,
  });
  const chartFile = files.find(f => f.fileName === 'notes.chart')!;
  return parseChartFile(chartFile.data, 'chart', undefined);
}

/** Build an `EXECUTE_COMMAND` action from a command + the doc it was
 *  executed against. */
function executeAction(command: EditCommand, prevDoc: ChartDocument) {
  const newDoc = command.execute(prevDoc);
  return {
    type: 'EXECUTE_COMMAND' as const,
    command,
    chart: reparse(newDoc),
    chartDoc: newDoc,
  };
}

describe('chartEditorReducer', () => {
  describe('initial state', () => {
    it('starts with no chart doc and the drums-expert scope', () => {
      expect(initialState.chartDoc).toBeNull();
      expect(initialState.activeScope).toEqual(DEFAULT_DRUMS_EXPERT_SCOPE);
      expect(initialState.undoStack).toHaveLength(0);
      expect(initialState.redoStack).toHaveLength(0);
      expect(initialState.dirty).toBe(false);
      expect(initialState.selection.size).toBe(0);
    });
  });

  describe('SET_SELECTION', () => {
    it('stores a non-empty set under the kind', () => {
      const next = chartEditorReducer(initialState, {
        type: 'SET_SELECTION',
        kind: 'note',
        ids: new Set(['0:kick', '480:redDrum']),
      });
      expect(next.selection.get('note')).toEqual(
        new Set(['0:kick', '480:redDrum']),
      );
    });

    it('removes the entry when the new set is empty', () => {
      const seeded = chartEditorReducer(initialState, {
        type: 'SET_SELECTION',
        kind: 'note',
        ids: new Set(['0:kick']),
      });
      const cleared = chartEditorReducer(seeded, {
        type: 'SET_SELECTION',
        kind: 'note',
        ids: new Set(),
      });
      expect(cleared.selection.has('note')).toBe(false);
    });

    it('immutably replaces the selection map', () => {
      const next = chartEditorReducer(initialState, {
        type: 'SET_SELECTION',
        kind: 'lyric',
        ids: new Set(['vocals:240']),
      });
      expect(next.selection).not.toBe(initialState.selection);
    });
  });

  describe('CLEAR_SELECTION', () => {
    it('drops every kind in one step', () => {
      const seeded = [
        ['note', '0:kick'],
        ['section', '0'],
        ['lyric', 'vocals:240'],
      ].reduce(
        (s, [kind, id]) =>
          chartEditorReducer(s, {
            type: 'SET_SELECTION',
            kind: kind as never,
            ids: new Set([id]),
          }),
        initialState,
      );
      expect(seeded.selection.size).toBe(3);
      const cleared = chartEditorReducer(seeded, {type: 'CLEAR_SELECTION'});
      expect(cleared.selection.size).toBe(0);
    });

    it('returns the same state object when already empty (referential)', () => {
      const cleared = chartEditorReducer(initialState, {
        type: 'CLEAR_SELECTION',
      });
      expect(cleared).toBe(initialState);
    });
  });

  describe('EXECUTE_COMMAND', () => {
    it('pushes onto the undo stack and clears redo', () => {
      const doc = makeFixtureDoc();
      const seeded = {...initialState, chartDoc: doc};

      const cmd = new AddNoteCommand({
        tick: 240,
        type: 'kick',
        length: 0,
        flags: {},
      });
      const next = chartEditorReducer(seeded, executeAction(cmd, doc));

      expect(next.undoStack).toHaveLength(1);
      expect(next.undoStack[0]).toBe(cmd);
      expect(next.undoDocStack).toHaveLength(1);
      expect(next.undoDocStack[0]).toBe(doc); // pre-execution snapshot
      expect(next.redoStack).toHaveLength(0);
      expect(next.dirty).toBe(true);
    });

    it('clears the redo stack on a fresh edit (new branch)', () => {
      const doc = makeFixtureDoc();
      const seeded = {
        ...initialState,
        chartDoc: doc,
        redoStack: [
          new AddNoteCommand({
            tick: 0,
            type: 'kick',
            length: 0,
            flags: {},
          }),
        ],
        redoDocStack: [doc],
      };
      const cmd = new AddNoteCommand({
        tick: 60,
        type: 'redDrum',
        length: 0,
        flags: {},
      });
      const next = chartEditorReducer(seeded, executeAction(cmd, doc));
      expect(next.redoStack).toHaveLength(0);
      expect(next.redoDocStack).toHaveLength(0);
    });

    it('caps the undo stack at UNDO_STACK_CAP (200)', () => {
      let doc = makeFixtureDoc();
      let state: ChartEditorState = {...initialState, chartDoc: doc};

      for (let i = 0; i < 205; i++) {
        const cmd = new AddNoteCommand({
          tick: i + 1,
          type: 'kick',
          length: 0,
          flags: {},
        });
        const action = executeAction(cmd, state.chartDoc!);
        state = chartEditorReducer(state, action);
        doc = action.chartDoc;
      }

      expect(state.undoStack).toHaveLength(200);
      expect(state.undoDocStack).toHaveLength(200);
    });

    it('returns state unchanged when chartDoc is null', () => {
      const cmd = new AddNoteCommand({
        tick: 0,
        type: 'kick',
        length: 0,
        flags: {},
      });
      const next = chartEditorReducer(initialState, {
        type: 'EXECUTE_COMMAND',
        command: cmd,
        chart: {} as never,
        chartDoc: {} as never,
      });
      expect(next).toBe(initialState);
    });
  });

  describe('UNDO / REDO', () => {
    it('UNDO pops the most recent command and pushes it onto redo', () => {
      const doc = makeFixtureDoc();
      const seeded = {...initialState, chartDoc: doc};
      const cmd = new AddNoteCommand({
        tick: 240,
        type: 'kick',
        length: 0,
        flags: {},
      });
      const afterExec = chartEditorReducer(seeded, executeAction(cmd, doc));

      const undone = chartEditorReducer(afterExec, {
        type: 'UNDO',
        chart: reparse(doc),
        chartDoc: doc,
      });

      expect(undone.undoStack).toHaveLength(0);
      expect(undone.redoStack).toHaveLength(1);
      expect(undone.redoStack[0]).toBe(cmd);
      // chartDoc rolls back to the pre-exec snapshot.
      expect(undone.chartDoc).toBe(doc);
    });

    it('REDO replays the topmost redo command', () => {
      const doc = makeFixtureDoc();
      const seeded = {...initialState, chartDoc: doc};
      const cmd = new AddNoteCommand({
        tick: 240,
        type: 'kick',
        length: 0,
        flags: {},
      });
      const exec = chartEditorReducer(seeded, executeAction(cmd, doc));
      const undone = chartEditorReducer(exec, {
        type: 'UNDO',
        chart: reparse(doc),
        chartDoc: doc,
      });
      const redone = chartEditorReducer(undone, {
        type: 'REDO',
        chart: exec.chart!,
        chartDoc: exec.chartDoc!,
      });

      expect(redone.undoStack).toHaveLength(1);
      expect(redone.redoStack).toHaveLength(0);
      expect(redone.chartDoc).toBe(exec.chartDoc);
    });

    it('UNDO is a no-op when the stack is empty', () => {
      const doc = makeFixtureDoc();
      const seeded = {...initialState, chartDoc: doc};
      const next = chartEditorReducer(seeded, {
        type: 'UNDO',
        chart: reparse(doc),
        chartDoc: doc,
      });
      expect(next).toBe(seeded);
    });

    it('REDO is a no-op when the redo stack is empty', () => {
      const doc = makeFixtureDoc();
      const seeded = {...initialState, chartDoc: doc};
      const next = chartEditorReducer(seeded, {
        type: 'REDO',
        chart: reparse(doc),
        chartDoc: doc,
      });
      expect(next).toBe(seeded);
    });
  });

  describe('MARK_SAVED', () => {
    it('snapshots the current undo depth and clears dirty', () => {
      const doc = makeFixtureDoc();
      const seeded = {...initialState, chartDoc: doc};
      const cmd = new AddNoteCommand({
        tick: 0,
        type: 'kick',
        length: 0,
        flags: {},
      });
      const exec = chartEditorReducer(seeded, executeAction(cmd, doc));
      const saved = chartEditorReducer(exec, {type: 'MARK_SAVED'});

      expect(saved.dirty).toBe(false);
      expect(saved.savedUndoDepth).toBe(1);
    });

    it('a subsequent UNDO that returns to the saved depth clears dirty', () => {
      const doc = makeFixtureDoc();
      let state: ChartEditorState = {...initialState, chartDoc: doc};
      // Mark-saved at depth 0.
      state = chartEditorReducer(state, {type: 'MARK_SAVED'});
      // Edit -> dirty.
      const cmd = new AddNoteCommand({
        tick: 0,
        type: 'kick',
        length: 0,
        flags: {},
      });
      state = chartEditorReducer(state, executeAction(cmd, doc));
      expect(state.dirty).toBe(true);
      // Undo -> back to depth 0 -> not dirty.
      state = chartEditorReducer(state, {
        type: 'UNDO',
        chart: reparse(doc),
        chartDoc: doc,
      });
      expect(state.dirty).toBe(false);
    });
  });

  describe('SET_ACTIVE_SCOPE', () => {
    it('switches scopes and preserves selection state', () => {
      const seeded = chartEditorReducer(initialState, {
        type: 'SET_SELECTION',
        kind: 'note',
        ids: new Set(['0:kick']),
      });
      const next = chartEditorReducer(seeded, {
        type: 'SET_ACTIVE_SCOPE',
        scope: DEFAULT_VOCALS_SCOPE,
      });
      expect(next.activeScope).toEqual(DEFAULT_VOCALS_SCOPE);
      expect(next.selection.get('note')).toEqual(new Set(['0:kick']));
    });

    it('returns the same state when the scope reference is unchanged', () => {
      const next = chartEditorReducer(initialState, {
        type: 'SET_ACTIVE_SCOPE',
        scope: initialState.activeScope,
      });
      expect(next).toBe(initialState);
    });
  });
});
