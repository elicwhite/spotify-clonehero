/**
 * Dispatch-path capability gate tests (plan 0037 Task 3).
 *
 * Two layers under test:
 *  - `isCommandAllowed` directly, against each shipped `EditorCapabilities`
 *    preset and a representative command per entity kind.
 *  - `EditorSession.dispatch`, end to end: a disallowed `EXECUTE_COMMAND`
 *    must be a no-op (no state transition, no listener notification), and
 *    an allowed one must apply normally.
 */

import {EditorSession} from '../EditorSession';
import {isCommandAllowed} from '../capabilityGate';
import {
  ADD_LYRICS_CAPABILITIES,
  DRUM_EDIT_CAPABILITIES,
  PREVIEW_CAPABILITIES,
  TEMPO_CAPABILITIES,
} from '@/components/chart-editor/capabilities';
import {
  AddNoteCommand,
  toSchemaNote,
  AddSectionCommand,
  AddLyricCommand,
  MoveTempoMarkerCommand,
  AddTimeSignatureCommand,
  BatchCommand,
} from '@/components/chart-editor/commands';
import {makeFixtureDoc} from '@/components/chart-editor/__tests__/fixtures';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '@/components/chart-editor/scope';
import {noteTypes} from '@eliwhite/scan-chart';

const noteCmd = () =>
  new AddNoteCommand(
    toSchemaNote({tick: 240, type: noteTypes.kick, length: 0, flags: 0}),
    {instrument: 'drums', difficulty: 'expert'},
  );
const sectionCmd = () => new AddSectionCommand(2400, 'Bridge');
const lyricCmd = () => new AddLyricCommand(240, 'la');
const tempoMoveCmd = () => new MoveTempoMarkerCommand(1920, 2000, 'audio');
const timesigCmd = () => new AddTimeSignatureCommand(0, 3, 4);

describe('isCommandAllowed', () => {
  it('DRUM_EDIT allows every kind (notes, sections, lyrics, tempo, timesig)', () => {
    expect(isCommandAllowed(noteCmd(), DRUM_EDIT_CAPABILITIES)).toBe(true);
    expect(isCommandAllowed(sectionCmd(), DRUM_EDIT_CAPABILITIES)).toBe(true);
    expect(isCommandAllowed(lyricCmd(), DRUM_EDIT_CAPABILITIES)).toBe(true);
    expect(isCommandAllowed(tempoMoveCmd(), DRUM_EDIT_CAPABILITIES)).toBe(true);
    expect(isCommandAllowed(timesigCmd(), DRUM_EDIT_CAPABILITIES)).toBe(true);
  });

  it('ADD_LYRICS allows lyric edits but rejects notes/tempo/timesig', () => {
    expect(isCommandAllowed(lyricCmd(), ADD_LYRICS_CAPABILITIES)).toBe(true);
    expect(isCommandAllowed(noteCmd(), ADD_LYRICS_CAPABILITIES)).toBe(false);
    expect(isCommandAllowed(sectionCmd(), ADD_LYRICS_CAPABILITIES)).toBe(false);
    expect(isCommandAllowed(tempoMoveCmd(), ADD_LYRICS_CAPABILITIES)).toBe(
      false,
    );
  });

  it('PREVIEW rejects every command (read-only)', () => {
    expect(isCommandAllowed(noteCmd(), PREVIEW_CAPABILITIES)).toBe(false);
    expect(isCommandAllowed(sectionCmd(), PREVIEW_CAPABILITIES)).toBe(false);
    expect(isCommandAllowed(lyricCmd(), PREVIEW_CAPABILITIES)).toBe(false);
    expect(isCommandAllowed(tempoMoveCmd(), PREVIEW_CAPABILITIES)).toBe(false);
  });

  it('TEMPO allows tempo/timesig/section but rejects notes and lyrics', () => {
    expect(isCommandAllowed(tempoMoveCmd(), TEMPO_CAPABILITIES)).toBe(true);
    expect(isCommandAllowed(timesigCmd(), TEMPO_CAPABILITIES)).toBe(true);
    expect(isCommandAllowed(sectionCmd(), TEMPO_CAPABILITIES)).toBe(true);
    expect(isCommandAllowed(noteCmd(), TEMPO_CAPABILITIES)).toBe(false);
    expect(isCommandAllowed(lyricCmd(), TEMPO_CAPABILITIES)).toBe(false);
  });

  it(
    'a tempo marker move that KEEP-MS-remaps note ticks is gated by its ' +
      "declared 'tempo' intent, not by a 'note' grant",
    () => {
      // MoveTempoMarkerCommand's default glue ('audio' → KEEP-MS) remaps every
      // note's tick as a side effect, but it declares only {'tempo'} as its
      // entityKinds — so TEMPO_CAPABILITIES (which grants 'tempo' but not
      // 'note') must still allow it.
      const cmd = tempoMoveCmd();
      expect(cmd.entityKinds.has('note')).toBe(false);
      expect(cmd.entityKinds.has('tempo')).toBe(true);
      expect(TEMPO_CAPABILITIES.editableEntities.has('note')).toBe(false);
      expect(isCommandAllowed(cmd, TEMPO_CAPABILITIES)).toBe(true);
    },
  );

  it(
    'BatchCommand gates as the union of its members: one disallowed ' +
      'member rejects the whole batch',
    () => {
      const batch = new BatchCommand([sectionCmd(), noteCmd()]);
      // TEMPO grants 'section' but not 'note' — the note member must sink it.
      expect(isCommandAllowed(batch, TEMPO_CAPABILITIES)).toBe(false);
      // DRUM_EDIT grants both, so the same batch is allowed there.
      expect(isCommandAllowed(batch, DRUM_EDIT_CAPABILITIES)).toBe(true);
    },
  );
});

describe('EditorSession.dispatch capability gate', () => {
  function sessionWith(capabilities: typeof DRUM_EDIT_CAPABILITIES) {
    return new EditorSession(
      {chartDoc: makeFixtureDoc(), activeScope: DEFAULT_DRUMS_EXPERT_SCOPE},
      capabilities,
    );
  }

  it('rejects a disallowed command: no state transition, no notify', () => {
    const session = sessionWith(TEMPO_CAPABILITIES);
    const before = session.getState();
    let notified = false;
    session.subscribe(() => {
      notified = true;
    });

    // The gate deliberately rejects this dispatch, which makes
    // EditorSession.dispatch emit a real console.warn — expected here, but
    // silence it so it doesn't show up as noise in CI/deploy logs, and
    // assert on it instead so the rejection itself stays under test.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const cmd = noteCmd();
    const newDoc = cmd.execute(before.chartDoc!);
    session.dispatch({type: 'EXECUTE_COMMAND', command: cmd, chartDoc: newDoc});

    expect(session.getState()).toBe(before);
    expect(session.getState().undoStack).toHaveLength(0);
    expect(notified).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('rejected'));
    warnSpy.mockRestore();
  });

  it('applies an allowed command normally', () => {
    const session = sessionWith(DRUM_EDIT_CAPABILITIES);
    const before = session.getState();

    const cmd = noteCmd();
    const newDoc = cmd.execute(before.chartDoc!);
    session.dispatch({type: 'EXECUTE_COMMAND', command: cmd, chartDoc: newDoc});

    expect(session.getState()).not.toBe(before);
    expect(session.getState().undoStack).toHaveLength(1);
    expect(session.getState().chartDoc).toBe(newDoc);
  });

  it('TEMPO preset allows a tempo-marker move that remaps note ticks', () => {
    const session = sessionWith(TEMPO_CAPABILITIES);
    const before = session.getState();

    const cmd = tempoMoveCmd();
    const newDoc = cmd.execute(before.chartDoc!);
    session.dispatch({type: 'EXECUTE_COMMAND', command: cmd, chartDoc: newDoc});

    expect(session.getState()).not.toBe(before);
    expect(session.getState().chartDoc).toBe(newDoc);
  });
});
