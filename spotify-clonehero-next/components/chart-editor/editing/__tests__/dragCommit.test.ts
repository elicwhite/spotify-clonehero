/**
 * What a committed drag does (`dragCommit.ts`): the move, and the selection
 * it leaves behind. Ids are positions, so the selection has to follow the
 * move to wherever it actually put things.
 *
 * Fixture drums/expert: kick 0, red 480, yellow 960, blue 1440, green 1920;
 * one vocals phrase 0..960 with lyrics at 240 and 720.
 */

import {
  addLyric,
  addPhrase,
  listLyricTicks,
  type ChartDocument,
  type SelectableKind,
} from '@/lib/chart-edit';
import {initialState, type ChartEditorState} from '@/lib/chart-editor-core';
import {
  BatchCommand,
  MoveEntitiesCommand,
} from '@/lib/chart-editor-core/commands';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '@/lib/chart-editor-core/scope';
import {makeFixtureDoc} from '@/lib/chart-editor-core/__tests__/fixtures';
import {noteDragCommit, selectionDragCommit} from '../dragCommit';

const DRUMS_EXPERT = {instrument: 'drums', difficulty: 'expert'} as const;

function stateWith(
  selection: Partial<Record<SelectableKind, string[]>>,
  chartDoc: ChartDocument = makeFixtureDoc(),
): ChartEditorState {
  return {
    ...initialState,
    chartDoc,
    activeScope: DEFAULT_DRUMS_EXPERT_SCOPE,
    selection: new Map(
      Object.entries(selection).map(([kind, ids]) => [
        kind as SelectableKind,
        new Set(ids),
      ]),
    ),
  };
}

/** The fixture plus a second vocals phrase at 1440 with a lyric at 1920. */
function twoPhraseDoc(): ChartDocument {
  const doc = makeFixtureDoc();
  addPhrase(doc, 1440);
  addLyric(doc, 1920, 'la');
  return doc;
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

  it('moves only the lyrics when the editor is on no notes track', () => {
    const state = stateWith({
      note: ['drums:expert|480:redDrum'],
      lyric: ['vocals:240'],
    });
    const commit = selectionDragCommit(state, undefined, {
      tickDelta: 120,
      laneDelta: 0,
    });
    expect(commit?.command).toBeInstanceOf(MoveEntitiesCommand);
    expect(commit?.selection).toEqual({lyric: new Set(['vocals:360'])});
  });
});

describe('selectionDragCommit with phrases travelling whole', () => {
  /** A lyric-chip drag by `tickDelta` that carries the phrases at
   *  `startTicks` whole. */
  function travel(
    state: ChartEditorState,
    tickDelta: number,
    startTicks: number[],
  ) {
    return selectionDragCommit(
      state,
      undefined,
      {tickDelta, laneDelta: 0},
      new Set(startTicks),
    );
  }

  it('carries the lyrics and edges of the phrase, and moves a lyric outside it on its own', () => {
    const doc = twoPhraseDoc();
    const state = stateWith(
      {
        lyric: ['vocals:240', 'vocals:1920'],
        'phrase-start': ['vocals:0'],
        'phrase-end': ['vocals:960'],
      },
      doc,
    );
    const commit = travel(state, 120, [0]);
    expect(commit?.selection).toEqual({
      lyric: new Set(['vocals:360', 'vocals:2040']),
      'phrase-start': new Set(['vocals:120']),
      'phrase-end': new Set(['vocals:1080']),
    });
    // The unselected lyric at 720 rides with its phrase too.
    expect(listLyricTicks(commit!.command.execute(doc))).toEqual([
      360, 840, 2040,
    ]);
  });

  it('follows the phrase to where its move clamps it, not to tick + delta', () => {
    // The phrase at 1440 stops the one at 0 after 480 ticks.
    const state = stateWith(
      {
        lyric: ['vocals:240'],
        'phrase-start': ['vocals:0'],
        'phrase-end': ['vocals:960'],
      },
      twoPhraseDoc(),
    );
    expect(travel(state, 1000, [0])?.selection).toEqual({
      lyric: new Set(['vocals:720']),
      'phrase-start': new Set(['vocals:480']),
      'phrase-end': new Set(['vocals:1440']),
    });
  });

  it('keeps the lyrics of a phrase that cannot move with it, instead of moving them on their own', () => {
    // Tick 0 stops the phrase at 0 from moving left at all.
    const doc = makeFixtureDoc();
    const state = stateWith(
      {
        lyric: ['vocals:240'],
        'phrase-start': ['vocals:0'],
        'phrase-end': ['vocals:960'],
      },
      doc,
    );
    const commit = travel(state, -100, [0]);
    expect(commit?.selection.lyric).toEqual(new Set(['vocals:240']));
    expect(listLyricTicks(commit!.command.execute(doc))).toEqual([240, 720]);
  });

  it('moves a lyric outside the phrase before the phrase carries one onto its tick', () => {
    // The phrase at 0 carries its lyric at 960 onto 1440, where the next
    // phrase starts with a lyric of its own.
    const doc = makeFixtureDoc();
    addLyric(doc, 960, 'end');
    addPhrase(doc, 1440);
    addLyric(doc, 1440, 'start');
    const state = stateWith(
      {
        lyric: ['vocals:1440'],
        'phrase-start': ['vocals:0'],
        'phrase-end': ['vocals:960'],
      },
      doc,
    );
    const commit = travel(state, 480, [0]);
    expect(commit?.selection.lyric).toEqual(new Set(['vocals:1920']));
    expect(listLyricTicks(commit!.command.execute(doc))).toEqual([
      720, 1200, 1440, 1920,
    ]);
  });
});
