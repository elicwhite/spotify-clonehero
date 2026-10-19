/**
 * @jest-environment jsdom
 */
/**
 * The editor's WebMCP tools (`EditorMCPTools`), driven through the tool
 * objects they register — the same `execute` an agent reaches over WebMCP —
 * against a real `ChartEditorProvider`.
 */

import {act, render} from '@testing-library/react';
import {useEffect} from 'react';
import EditorMCPTools from '../EditorMCPTools';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {AudioServiceProvider} from '../AudioServiceContext';
import {getSelectedIds, type ChartEditorState} from '@/lib/chart-editor-core';
import {drums4LaneSchema, listNotes} from '@/lib/chart-edit';
import {noteId} from '@/lib/chart-editor-core/commands';
import {
  DEFAULT_DRUMS_EXPERT_SCOPE,
  DEFAULT_VOCALS_SCOPE,
  type EditorScope,
} from '@/lib/chart-editor-core/scope';
import {makeFixtureDoc} from '@/lib/chart-editor-core/__tests__/fixtures';

const registerTool = jest.fn();

beforeEach(() => {
  registerTool.mockReset();
  Object.defineProperty(navigator, 'modelContext', {
    configurable: true,
    value: {registerTool, unregisterTool: jest.fn()},
  });
});

function tool(name: string): WebMCPToolDefinition {
  const found = registerTool.mock.calls
    .map(([registered]) => registered as WebMCPToolDefinition)
    .find(registered => registered.name === name);
  if (!found) throw new Error(`${name} was not registered`);
  return found;
}

/** Runs a tool the way an agent does, one call per `act()` so the editor
 *  state it leaves behind is committed before the next call reads it. */
async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  let text = '';
  await act(async () => {
    text = (await tool(name).execute(args)).content[0].text;
  });
  return text;
}

function Harness({stateRef}: {stateRef: {current: ChartEditorState | null}}) {
  const {state, dispatch} = useChartEditorContext();
  useEffect(() => {
    dispatch({type: 'SET_CHART_DOC', chartDoc: makeFixtureDoc()});
  }, [dispatch]);
  useEffect(() => {
    stateRef.current = state;
  });
  return null;
}

async function mount(activeScope: EditorScope = DEFAULT_DRUMS_EXPERT_SCOPE) {
  const stateRef: {current: ChartEditorState | null} = {current: null};
  render(
    <AudioServiceProvider>
      <ChartEditorProvider activeScope={activeScope}>
        <Harness stateRef={stateRef} />
        <EditorMCPTools />
      </ChartEditorProvider>
    </AudioServiceProvider>,
  );
  await act(async () => {});
  return stateRef;
}

/** The fixture's drums/expert notes, by the id the editor gives them. */
function drumNoteIds(state: ChartEditorState | null): string[] {
  const track = state?.chartDoc?.parsedChart.trackData[0];
  return track ? listNotes(track, drums4LaneSchema).map(n => noteId(n)) : [];
}

describe('editor_select_note', () => {
  it('selects the note by the id the editor uses, so a delete removes it', async () => {
    const stateRef = await mount();
    expect(drumNoteIds(stateRef.current)).toContain('480:redDrum');

    await call('editor_select_note', {tick: 480, type: 'Red'});
    expect(getSelectedIds(stateRef.current!, 'note')).toEqual(
      new Set(['drums:expert|480:redDrum']),
    );

    await call('editor_delete_selected', {});
    expect(drumNoteIds(stateRef.current)).toEqual([
      '0:kick',
      '960:yellowDrum',
      '1440:blueDrum',
      '1920:greenDrum',
    ]);
  });

  it('says there is no such note, and selects nothing, when the track has none there', async () => {
    const stateRef = await mount();

    const reply = await call('editor_select_note', {tick: 240, type: 'Red'});

    expect(reply).toMatch(/no Red note at tick 240/i);
    expect(getSelectedIds(stateRef.current!, 'note').size).toBe(0);
  });

  it('selects nothing while the editor is not on a notes track', async () => {
    const stateRef = await mount(DEFAULT_VOCALS_SCOPE);

    const reply = await call('editor_select_note', {tick: 480, type: 'Red'});

    expect(reply).toBe('Not editing a track');
    expect(getSelectedIds(stateRef.current!, 'note').size).toBe(0);
  });
});
