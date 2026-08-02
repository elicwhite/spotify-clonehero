import {parseChartFile, writeChartFolder} from '@eliwhite/scan-chart';
import {AddTrackCommand} from '../commands';
import {makeFixtureDoc} from './fixtures';
import {chartEditorReducer, initialState} from '@/lib/chart-editor-core';

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
  it('stores explicit visible rows independently from active scope', () => {
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
});
