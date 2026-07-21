/**
 * @jest-environment jsdom
 */
/**
 * `NoteInspector` schema-driven flag/Kick tests (plan 0067 §5).
 *
 * `FLAG_ITEMS`/the Kick button used to be pinned to `drums4LaneSchema`;
 * these confirm a guitar-scoped inspector shows guitar's flag set
 * (strum/HOPO/tap) and hides the drum-only Kick button.
 */

import '@testing-library/jest-dom';
import {useEffect} from 'react';
import {render, screen} from '@testing-library/react';
import {createEmptyChart} from '@eliwhite/scan-chart';
import {noteTypes} from '@eliwhite/scan-chart';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {
  DEFAULT_DRUMS_EXPERT_SCOPE,
  DEFAULT_GUITAR_EXPERT_SCOPE,
} from '../scope';
import {noteId} from '../commands';
import NoteInspector from '../NoteInspector';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {addNote, addDrumNote, guitarSchema} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';

function makeGuitarDoc(): {doc: ChartDocument; id: string} {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('guitar', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  addNote(
    doc.parsedChart.trackData[0],
    {tick: 0, type: noteTypes.green},
    guitarSchema,
  );
  return {doc, id: noteId({tick: 0, type: noteTypes.green})};
}

function makeDrumsDoc(): {doc: ChartDocument; id: string} {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  addDrumNote(doc.parsedChart.trackData[0], {tick: 0, type: noteTypes.redDrum});
  return {doc, id: noteId({tick: 0, type: noteTypes.redDrum})};
}

function Harness({build}: {build: () => {doc: ChartDocument; id: string}}) {
  const {dispatch} = useChartEditorContext();

  useEffect(() => {
    const {doc, id} = build();
    dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
    dispatch({type: 'SET_SELECTION', kind: 'note', ids: new Set([id])});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <NoteInspector />;
}

describe('NoteInspector — schema-driven flags/Kick (plan 0067)', () => {
  it('shows guitar flag items (Strum/HOPO/Tap) and no Kick button on a guitar scope', () => {
    render(
      <ChartEditorProvider activeScope={DEFAULT_GUITAR_EXPERT_SCOPE}>
        <Harness build={makeGuitarDoc} />
      </ChartEditorProvider>,
    );

    expect(screen.getByRole('button', {name: /strum/i})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /hopo/i})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /^tap/i})).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: /^kick/i}),
    ).not.toBeInTheDocument();
  });

  it('still shows the Kick button on a drum scope', () => {
    render(
      <ChartEditorProvider activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
        <Harness build={makeDrumsDoc} />
      </ChartEditorProvider>,
    );

    expect(screen.getByRole('button', {name: /^kick/i})).toBeInTheDocument();
  });
});
