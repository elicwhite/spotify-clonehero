/**
 * Reducer-correctness tests.
 *
 * Covers EXECUTE_COMMAND / UNDO / REDO / SET_SELECTION / MARK_SAVED /
 * SET_ACTIVE_SCOPE and the snapshot stack-cap.
 */

import type {ChartDocument} from '@/lib/chart-edit';
import type {TrackKey} from '@/lib/chart-edit';
const DRUMS_KEY: TrackKey = {instrument: 'drums', difficulty: 'expert'};
import {
  chartEditorReducer,
  initialState,
  selectRenderDoc,
  type ChartEditorState,
} from '@/lib/chart-editor-core';
import type {EditCommand} from '../commands';
import {AddNoteCommand, toSchemaNote} from '../commands';
import {DEFAULT_DRUMS_EXPERT_SCOPE, DEFAULT_VOCALS_SCOPE} from '../scope';
import {makeFixtureDoc} from './fixtures';

/** Build an `EXECUTE_COMMAND` action from a command + the doc it was
 *  executed against. */
function executeAction(command: EditCommand, prevDoc: ChartDocument) {
  const newDoc = command.execute(prevDoc);
  return {
    type: 'EXECUTE_COMMAND' as const,
    command,
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

      const cmd = new AddNoteCommand(toSchemaNote({
          tick: 240,
          type: 'kick',
          length: 0,
          flags: {},
        }),
        DRUMS_KEY,
      );
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
          new AddNoteCommand(toSchemaNote({
              tick: 0,
              type: 'kick',
              length: 0,
              flags: {},
            }),
            DRUMS_KEY,
          ),
        ],
        redoDocStack: [doc],
      };
      const cmd = new AddNoteCommand(toSchemaNote({
          tick: 60,
          type: 'redDrum',
          length: 0,
          flags: {},
        }),
        DRUMS_KEY,
      );
      const next = chartEditorReducer(seeded, executeAction(cmd, doc));
      expect(next.redoStack).toHaveLength(0);
      expect(next.redoDocStack).toHaveLength(0);
    });

    it('caps the undo stack at UNDO_STACK_CAP (200)', () => {
      let doc = makeFixtureDoc();
      let state: ChartEditorState = {...initialState, chartDoc: doc};

      for (let i = 0; i < 205; i++) {
        const cmd = new AddNoteCommand(toSchemaNote({
            tick: i + 1,
            type: 'kick',
            length: 0,
            flags: {},
          }),
          DRUMS_KEY,
        );
        const action = executeAction(cmd, state.chartDoc!);
        state = chartEditorReducer(state, action);
        doc = action.chartDoc;
      }

      expect(state.undoStack).toHaveLength(200);
      expect(state.undoDocStack).toHaveLength(200);
    });

    it('returns state unchanged when chartDoc is null', () => {
      const cmd = new AddNoteCommand(toSchemaNote({
          tick: 0,
          type: 'kick',
          length: 0,
          flags: {},
        }),
        DRUMS_KEY,
      );
      const next = chartEditorReducer(initialState, {
        type: 'EXECUTE_COMMAND',
        command: cmd,
        chartDoc: {} as never,
      });
      expect(next).toBe(initialState);
    });
  });

  describe('UNDO / REDO', () => {
    it('UNDO pops the most recent command and pushes it onto redo', () => {
      const doc = makeFixtureDoc();
      const seeded = {...initialState, chartDoc: doc};
      const cmd = new AddNoteCommand(toSchemaNote({
          tick: 240,
          type: 'kick',
          length: 0,
          flags: {},
        }),
        DRUMS_KEY,
      );
      const afterExec = chartEditorReducer(seeded, executeAction(cmd, doc));

      const undone = chartEditorReducer(afterExec, {
        type: 'UNDO',
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
      const cmd = new AddNoteCommand(toSchemaNote({
          tick: 240,
          type: 'kick',
          length: 0,
          flags: {},
        }),
        DRUMS_KEY,
      );
      const exec = chartEditorReducer(seeded, executeAction(cmd, doc));
      const undone = chartEditorReducer(exec, {
        type: 'UNDO',
        chartDoc: doc,
      });
      const redone = chartEditorReducer(undone, {
        type: 'REDO',
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
        chartDoc: doc,
      });
      expect(next).toBe(seeded);
    });

    it('REDO is a no-op when the redo stack is empty', () => {
      const doc = makeFixtureDoc();
      const seeded = {...initialState, chartDoc: doc};
      const next = chartEditorReducer(seeded, {
        type: 'REDO',
        chartDoc: doc,
      });
      expect(next).toBe(seeded);
    });
  });

  describe('MARK_SAVED', () => {
    it('snapshots the current undo depth and clears dirty', () => {
      const doc = makeFixtureDoc();
      const seeded = {...initialState, chartDoc: doc};
      const cmd = new AddNoteCommand(toSchemaNote({
          tick: 0,
          type: 'kick',
          length: 0,
          flags: {},
        }),
        DRUMS_KEY,
      );
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
      const cmd = new AddNoteCommand(toSchemaNote({
          tick: 0,
          type: 'kick',
          length: 0,
          flags: {},
        }),
        DRUMS_KEY,
      );
      state = chartEditorReducer(state, executeAction(cmd, doc));
      expect(state.dirty).toBe(true);
      // Undo -> back to depth 0 -> not dirty.
      state = chartEditorReducer(state, {
        type: 'UNDO',
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

  describe('tempo glue mode (0062 §9)', () => {
    it('defaults to audio-glued', () => {
      expect(initialState.tempoGlueMode).toBe('audio');
    });

    it('SET_TEMPO_GLUE_MODE flips the mode', () => {
      const next = chartEditorReducer(initialState, {
        type: 'SET_TEMPO_GLUE_MODE',
        mode: 'grid',
      });
      expect(next.tempoGlueMode).toBe('grid');
    });

    it('resets to audio-glued on chart (re)load — never persisted', () => {
      const glued = chartEditorReducer(initialState, {
        type: 'SET_TEMPO_GLUE_MODE',
        mode: 'grid',
      });
      const loaded = chartEditorReducer(glued, {
        type: 'SET_CHART_DOC',
        chartDoc: makeFixtureDoc(),
      });
      expect(loaded.tempoGlueMode).toBe('audio');
    });
  });

  describe('pendingTempoCandidate invalidation (0061 §7)', () => {
    const candidate = () => ({
      op: 'keep-ms' as const,
      doc: makeFixtureDoc(),
    });

    function seedWithCandidate(): ChartEditorState {
      const withDoc = chartEditorReducer(initialState, {
        type: 'SET_CHART_DOC',
        chartDoc: makeFixtureDoc(),
      });
      return chartEditorReducer(withDoc, {
        type: 'SET_PENDING_TEMPO_CANDIDATE',
        candidate: candidate(),
      });
    }

    it('holds a candidate set via SET_PENDING_TEMPO_CANDIDATE', () => {
      const seeded = seedWithCandidate();
      expect(seeded.pendingTempoCandidate?.op).toBe('keep-ms');
    });

    it('a command dispatch clears the in-flight candidate', () => {
      const seeded = seedWithCandidate();
      const doc = seeded.chartDoc!;
      const next = chartEditorReducer(
        seeded,
        executeAction(
          new AddNoteCommand(toSchemaNote({tick: 240, type: 'kick', length: 0, flags: {}}),
            DRUMS_KEY,
          ),
          doc,
        ),
      );
      expect(next.pendingTempoCandidate).toBeNull();
    });

    it('undo clears the in-flight candidate', () => {
      const seeded = seedWithCandidate();
      const doc = seeded.chartDoc!;
      const afterCmd = chartEditorReducer(
        {...seeded, pendingTempoCandidate: null},
        executeAction(
          new AddNoteCommand(toSchemaNote({tick: 240, type: 'kick', length: 0, flags: {}}),
            DRUMS_KEY,
          ),
          doc,
        ),
      );
      const withCandidate = chartEditorReducer(afterCmd, {
        type: 'SET_PENDING_TEMPO_CANDIDATE',
        candidate: candidate(),
      });
      const undone = chartEditorReducer(withCandidate, {
        type: 'UNDO',
        chartDoc: doc,
      });
      expect(undone.pendingTempoCandidate).toBeNull();
    });

    it('a chart reload clears the in-flight candidate', () => {
      const seeded = seedWithCandidate();
      const reloaded = chartEditorReducer(seeded, {
        type: 'SET_CHART_DOC',
        chartDoc: makeFixtureDoc(),
      });
      expect(reloaded.pendingTempoCandidate).toBeNull();
    });

    it('selectRenderDoc draws the candidate doc while one is staged, else chartDoc', () => {
      const committed = chartEditorReducer(initialState, {
        type: 'SET_CHART_DOC',
        chartDoc: makeFixtureDoc(),
      });
      // No candidate → the committed doc is what both views render.
      expect(selectRenderDoc(committed)).toBe(committed.chartDoc);

      const cand = candidate();
      const previewing = chartEditorReducer(committed, {
        type: 'SET_PENDING_TEMPO_CANDIDATE',
        candidate: cand,
      });
      // Candidate staged → both views render the candidate doc, not the
      // committed one.
      expect(selectRenderDoc(previewing)).toBe(cand.doc);
      expect(selectRenderDoc(previewing)).not.toBe(previewing.chartDoc);
    });
  });
});
