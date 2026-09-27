/**
 * What a committed drag does (`dragCommit.ts`): the move, and the selection
 * it leaves behind. Ids are positions, so the selection has to follow the
 * move to wherever it actually put things.
 *
 * Fixture drums/expert: kick 0, red 480, yellow 960, blue 1440, green 1920;
 * one vocals phrase 0..960 with lyrics at 240 and 720.
 */

import {initialState, type ChartEditorState} from '@/lib/chart-editor-core';
import {
  BatchCommand,
  MoveEntitiesCommand,
} from '@/lib/chart-editor-core/commands';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '@/lib/chart-editor-core/scope';
import {makeFixtureDoc} from '@/lib/chart-editor-core/__tests__/fixtures';
import {noteDragCommit, selectionDragCommit} from '../dragCommit';

const DRUMS_EXPERT = {instrument: 'drums', difficulty: 'expert'} as const;

function stateWith(selection: {
  note?: string[];
  lyric?: string[];
}): ChartEditorState {
  return {
    ...initialState,
    chartDoc: makeFixtureDoc(),
    activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
    selection: new Map(
      Object.entries(selection).map(([kind, ids]) => [
        kind as 'note' | 'lyric',
        new Set(ids),
      ]),
    ),
  };
}

describe('noteDragCommit', () => {
  it('re-keys the moved notes and keeps the rest of the selection', () => {
    const state = stateWith({
      note: ['drums:expert|480:redDrum', 'guitar:expert|0:green'],
    });
    const commit = noteDragCommit(state, DRUMS_EXPERT, {
      tickDelta: 240,
      laneDelta: 1,
    });
    expect(commit?.selection).toEqual({
      note: new Set(['drums:expert|720:yellowDrum', 'guitar:expert|0:green']),
    });
  });

  it('follows a note to where the move clamped it, not to tick + delta', () => {
    const state = stateWith({note: ['drums:expert|480:redDrum']});
    const commit = noteDragCommit(state, DRUMS_EXPERT, {
      tickDelta: -960,
      laneDelta: 0,
    });
    expect(commit?.selection).toEqual({
      note: new Set(['drums:expert|0:redDrum']),
    });
  });

  it('has nothing to commit when no selected note is on the dragged track', () => {
    const state = stateWith({note: ['guitar:expert|0:green']});
    expect(
      noteDragCommit(state, DRUMS_EXPERT, {tickDelta: 240, laneDelta: 0}),
    ).toBeNull();
  });

  it('has nothing to commit for a drag that ends where it started', () => {
    const state = stateWith({note: ['drums:expert|480:redDrum']});
    expect(
      noteDragCommit(state, DRUMS_EXPERT, {tickDelta: 0, laneDelta: 0}),
    ).toBeNull();
  });
});

describe('selectionDragCommit', () => {
  it('moves the notes and the lyrics in one step, and re-keys both', () => {
    const state = stateWith({
      note: ['drums:expert|480:redDrum'],
      lyric: ['vocals:240'],
    });
    const commit = selectionDragCommit(state, DRUMS_EXPERT, {
      tickDelta: 120,
      laneDelta: 0,
    });
    expect(commit?.command).toBeInstanceOf(BatchCommand);
    expect(commit?.selection).toEqual({
      note: new Set(['drums:expert|600:redDrum']),
      lyric: new Set(['vocals:360']),
    });
  });

  it('follows a lyric to its phrase bound, where the move clamps it', () => {
    const state = stateWith({lyric: ['vocals:720']});
    const commit = selectionDragCommit(state, DRUMS_EXPERT, {
      tickDelta: 960,
      laneDelta: 0,
    });
    // Lyrics alone need no batch around them.
    expect(commit?.command).toBeInstanceOf(MoveEntitiesCommand);
    expect(commit?.selection).toEqual({lyric: new Set(['vocals:960'])});
  });

  it('leaves the lyrics out of a drag that only changes lanes', () => {
    const state = stateWith({
      note: ['drums:expert|480:redDrum'],
      lyric: ['vocals:240'],
    });
    const commit = selectionDragCommit(state, DRUMS_EXPERT, {
      tickDelta: 0,
      laneDelta: 1,
    });
    expect(commit?.command).toBeInstanceOf(MoveEntitiesCommand);
    expect(commit?.selection).toEqual({
      note: new Set(['drums:expert|480:yellowDrum']),
    });
  });

  it('has nothing to commit when nothing that moves is selected', () => {
    const state = stateWith({});
    expect(
      selectionDragCommit(state, DRUMS_EXPERT, {tickDelta: 120, laneDelta: 0}),
    ).toBeNull();
  });
});
