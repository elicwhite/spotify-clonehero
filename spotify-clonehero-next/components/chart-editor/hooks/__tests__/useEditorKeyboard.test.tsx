/**
 * @jest-environment jsdom
 */
/**
 * `useEditorKeyboard` schema-threading regression tests (plan 0067 §5/6).
 *
 * Mounts the hook under a guitar-scoped `ChartEditorProvider` and simulates
 * keyboard events to confirm select-all (Mod+A) resolves notes via the
 * active schema instead of the drum-pinned `getDrumNotes`.
 */

import '@testing-library/jest-dom';
import {useEffect} from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import {createEmptyChart} from '@eliwhite/scan-chart';
import {noteTypes} from '@eliwhite/scan-chart';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../../ChartEditorContext';
import {AudioServiceProvider} from '../../AudioServiceContext';
import {DEFAULT_GUITAR_EXPERT_SCOPE} from '../../scope';
import {getSelectedIds} from '@/lib/chart-editor-core';
import {useEditorKeyboard} from '../useEditorKeyboard';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import type {ChartDocument} from '@/lib/chart-edit';
import {addNote} from '@/lib/chart-edit/entities/notes';
import {guitarSchema} from '@/lib/chart-edit';

function makeGuitarDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('guitar', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  const guitar = doc.parsedChart.trackData[0];
  addNote(guitar, {tick: 0, type: noteTypes.green}, guitarSchema);
  addNote(guitar, {tick: 480, type: noteTypes.red}, guitarSchema);
  addNote(guitar, {tick: 960, type: noteTypes.open}, guitarSchema);
  return doc;
}

function Harness() {
  const {state, dispatch} = useChartEditorContext();
  useEditorKeyboard();

  useEffect(() => {
    dispatch({type: 'SET_CHART_DOC', chartDoc: makeGuitarDoc()});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = getSelectedIds(state, 'note');
  return <div data-testid="selected-count">{selected.size}</div>;
}

describe('useEditorKeyboard — schema threading (plan 0067)', () => {
  it('Mod+A selects every note on a guitar-scoped track', () => {
    render(
      <AudioServiceProvider>
        <ChartEditorProvider activeScope={DEFAULT_GUITAR_EXPERT_SCOPE}>
          <Harness />
        </ChartEditorProvider>
      </AudioServiceProvider>,
    );

    fireEvent.keyDown(document, {key: 'a', ctrlKey: true});

    expect(screen.getByTestId('selected-count').textContent).toBe('3');
  });
});
