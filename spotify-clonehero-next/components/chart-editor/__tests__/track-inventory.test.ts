import {parseChartFile, writeChartFolder} from '@eliwhite/scan-chart';
import {AddTrackCommand} from '../commands';
import {makeFixtureDoc} from './fixtures';
import {chartEditorReducer, initialState} from '@/lib/chart-editor-core';
import type {TrackKey} from '@/lib/chart-edit';

describe('AddTrackCommand', () => {
  it('adds an empty track without mutating the source document', () => {
    const source = makeFixtureDoc();
    const command = new AddTrackCommand({
      instrument: 'guitar',
      difficulty: 'expert',
    });

    const result = command.execute(source);

    expect(result).not.toBe(source);
    expect(source.parsedChart.trackData).toHaveLength(1);
    expect(result.parsedChart.trackData).toHaveLength(2);
    expect(result.parsedChart.trackData[0]).toMatchObject({
      instrument: 'guitar',
      difficulty: 'expert',
      noteEventGroups: [],
    });
  });

  it('is duplicate-safe and writes a valid chart package', () => {
    const source = makeFixtureDoc();
    const command = new AddTrackCommand({
      instrument: 'drums',
      difficulty: 'hard',
    });
    const result = command.execute(source);

    expect(command.execute(result)).toBe(result);
    const notesFile = writeChartFolder(result).find(
      file => file.fileName === 'notes.chart',
    );
    expect(notesFile).toBeDefined();
    const parsed = parseChartFile(notesFile!.data, 'chart');
    expect(
      parsed.trackData.some(
        track => track.instrument === 'drums' && track.difficulty === 'hard',
      ),
    ).toBe(true);
  });
});

describe('track View state and scope recovery', () => {
  it('stores explicit visible rows in their own set', () => {
    const track = {instrument: 'drums', difficulty: 'expert'} as const;
    const hidden = chartEditorReducer(initialState, {
      type: 'SET_TRACK_VISIBILITY',
      track,
      visible: true,
    });
    expect(hidden.visibleTrackKeys).toEqual(new Set(['drums:expert']));

    const cleared = chartEditorReducer(hidden, {
      type: 'SET_TRACK_VISIBILITY',
      track,
      visible: false,
    });
    expect(cleared.visibleTrackKeys).toEqual(new Set());
  });

  it('recovers focus when undo removes its track', () => {
    const source = makeFixtureDoc();
    const command = new AddTrackCommand({
      instrument: 'guitar',
      difficulty: 'expert',
    });
    const added = command.execute(source);
    const focused = {
      ...initialState,
      chartDoc: added,
      undoStack: [command],
      undoDocStack: [source],
      activeScope: {
        kind: 'track' as const,
        track: {instrument: 'guitar' as const, difficulty: 'expert' as const},
      },
    };
    const recovered = chartEditorReducer(focused, {
      type: 'UNDO',
      chartDoc: source,
    });

    expect(recovered.activeScope).toEqual({
      kind: 'track',
      track: {instrument: 'drums', difficulty: 'expert'},
    });
  });

  // Keyboard note entry and the Note Inspector both resolve the track to
  // act on from `activeScope` (`trackKeyFromScope`), so hiding the
  // last-interacted track via the Chart Matrix must not leave it pointed at
  // a track no highway pane renders anymore.
  describe('activeScope fallback when the last-interacted track is hidden', () => {
    const DRUMS: TrackKey = {instrument: 'drums', difficulty: 'expert'};
    const GUITAR: TrackKey = {instrument: 'guitar', difficulty: 'expert'};

    it('falls back to another remaining visible track', () => {
      const withTwoVisible = chartEditorReducer(
        {
          ...initialState,
          activeScope: {kind: 'track', track: GUITAR},
        },
        {
          type: 'SET_VISIBLE_TRACKS',
          tracks: new Set(['drums:expert', 'guitar:expert']),
        },
      );

      const afterHidingGuitar = chartEditorReducer(withTwoVisible, {
        type: 'SET_TRACK_VISIBILITY',
        track: GUITAR,
        visible: false,
      });

      expect(afterHidingGuitar.visibleTrackKeys).toEqual(
        new Set(['drums:expert']),
      );
      expect(afterHidingGuitar.activeScope).toEqual({
        kind: 'track',
        track: DRUMS,
      });
    });

    it('leaves activeScope untouched when hiding a track that was not last-interacted', () => {
      const withTwoVisible = chartEditorReducer(
        {
          ...initialState,
          activeScope: {kind: 'track', track: DRUMS},
        },
        {
          type: 'SET_VISIBLE_TRACKS',
          tracks: new Set(['drums:expert', 'guitar:expert']),
        },
      );

      const afterHidingGuitar = chartEditorReducer(withTwoVisible, {
        type: 'SET_TRACK_VISIBILITY',
        track: GUITAR,
        visible: false,
      });

      expect(afterHidingGuitar.activeScope).toEqual({
        kind: 'track',
        track: DRUMS,
      });
    });

    it('leaves activeScope untouched when hiding the last visible track (no fallback candidate)', () => {
      const onlyDrumsVisible = chartEditorReducer(
        {
          ...initialState,
          activeScope: {kind: 'track', track: DRUMS},
        },
        {type: 'SET_VISIBLE_TRACKS', tracks: new Set(['drums:expert'])},
      );

      const afterHidingDrums = chartEditorReducer(onlyDrumsVisible, {
        type: 'SET_TRACK_VISIBILITY',
        track: DRUMS,
        visible: false,
      });

      expect(afterHidingDrums.visibleTrackKeys).toEqual(new Set());
      expect(afterHidingDrums.activeScope).toEqual({
        kind: 'track',
        track: DRUMS,
      });
    });

    // Showing a track is an interaction with it, so it becomes the
    // last-interacted one. On surfaces whose piano roll is not stacked
    // (`/guitar-edit`, `/bass-edit`, `/drum-edit`), that piano roll reads
    // `activeScope`, so this is what keeps it in step with the matrix.
    it('retargets activeScope to the track being shown (visible: true)', () => {
      const withDrumsVisible = chartEditorReducer(
        {
          ...initialState,
          activeScope: {kind: 'track', track: DRUMS},
        },
        {type: 'SET_VISIBLE_TRACKS', tracks: new Set(['drums:expert'])},
      );

      const afterShowingGuitar = chartEditorReducer(withDrumsVisible, {
        type: 'SET_TRACK_VISIBILITY',
        track: GUITAR,
        visible: true,
      });

      expect(afterShowingGuitar.visibleTrackKeys).toEqual(
        new Set(['drums:expert', 'guitar:expert']),
      );
      expect(afterShowingGuitar.activeScope).toEqual({
        kind: 'track',
        track: GUITAR,
      });
    });
  });

  // `visibleTrackKeys` names only tracks the loaded doc contains, and every
  // write reconciles against `chartDoc` -- consumers (highway panes, stacked
  // piano-roll rows) parse ids straight out of the set without re-filtering.
  describe('SET_TRACK_VISIBILITY reconciles against the loaded doc', () => {
    it('ignores a track the doc does not contain', () => {
      const loaded = chartEditorReducer(initialState, {
        type: 'SET_CHART_DOC',
        chartDoc: makeFixtureDoc(),
      });

      const afterShowingAbsent = chartEditorReducer(loaded, {
        type: 'SET_TRACK_VISIBILITY',
        track: {instrument: 'guitar', difficulty: 'expert'},
        visible: true,
      });

      expect(afterShowingAbsent).toBe(loaded);
    });

    it('shows a track the doc does contain', () => {
      const loaded = chartEditorReducer(initialState, {
        type: 'SET_CHART_DOC',
        chartDoc: makeFixtureDoc(),
      });

      const shown = chartEditorReducer(loaded, {
        type: 'SET_TRACK_VISIBILITY',
        track: {instrument: 'drums', difficulty: 'expert'},
        visible: true,
      });

      expect(shown.visibleTrackKeys).toEqual(new Set(['drums:expert']));
    });
  });
});
