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
import {DEFAULT_GUITAR_EXPERT_SCOPE} from '../../../../chart-editor-core/scope';
import {getSelectedIds} from '../../../../chart-editor-core';
import {useEditorKeyboard} from '../useEditorKeyboard';
import {emptyTrackData} from '../../../../chart-edit/__tests__/test-utils';
import type {ChartDocument} from '../../../../chart-edit';
import {addNote} from '../../../../chart-edit/entities/notes';
import {guitarSchema} from '../../../../chart-edit';
import {makeFixtureDoc} from '../../../../chart-editor-core/__tests__/fixtures';

// jsdom never implements `HTMLElement.isContentEditable` (it's always
// `undefined`), which is what `@tanstack/hotkeys` reads to decide an element
// is a text-entry surface. Polyfilling the getter here from the
// `contenteditable` attribute lets the contenteditable cases below exercise
// the real hotkey-ignoring code path exactly as a browser would.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
    configurable: true,
    get(this: HTMLElement) {
      const attr = this.getAttribute('contenteditable');
      return attr === '' || attr === 'true';
    },
  });
});

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
  return (
    <div>
      <div data-testid="selected-count">{selected.size}</div>
      <input data-testid="text-input" defaultValue="hello" />
      <div
        data-testid="editable"
        contentEditable
        suppressContentEditableWarning>
        hello
      </div>
    </div>
  );
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

describe('useEditorKeyboard — ignore hotkeys while a text entry is focused (plan 0082 item 5)', () => {
  it('Mod+A does not select notes when focus is in a text input', () => {
    render(
      <AudioServiceProvider>
        <ChartEditorProvider activeScope={DEFAULT_GUITAR_EXPERT_SCOPE}>
          <Harness />
        </ChartEditorProvider>
      </AudioServiceProvider>,
    );

    const input = screen.getByTestId('text-input');
    input.focus();
    fireEvent.keyDown(input, {key: 'a', ctrlKey: true});

    expect(screen.getByTestId('selected-count').textContent).toBe('0');
  });

  it('Mod+A does not select notes when focus is in a contenteditable element', () => {
    render(
      <AudioServiceProvider>
        <ChartEditorProvider activeScope={DEFAULT_GUITAR_EXPERT_SCOPE}>
          <Harness />
        </ChartEditorProvider>
      </AudioServiceProvider>,
    );

    const editable = screen.getByTestId('editable');
    editable.focus();
    fireEvent.keyDown(editable, {key: 'a', ctrlKey: true});

    expect(screen.getByTestId('selected-count').textContent).toBe('0');
  });

  it('Escape still clears selection when focus is in a text input', () => {
    render(
      <AudioServiceProvider>
        <ChartEditorProvider activeScope={DEFAULT_GUITAR_EXPERT_SCOPE}>
          <Harness />
        </ChartEditorProvider>
      </AudioServiceProvider>,
    );

    // Select on the body first (focus not in a text entry), matching the
    // baseline "fires with focus on the body" case.
    fireEvent.keyDown(document, {key: 'a', ctrlKey: true});
    expect(screen.getByTestId('selected-count').textContent).toBe('3');

    const input = screen.getByTestId('text-input');
    input.focus();
    fireEvent.keyDown(input, {key: 'Escape'});

    expect(screen.getByTestId('selected-count').textContent).toBe('0');
  });

  it('Escape still clears selection when focus is in a contenteditable element', () => {
    render(
      <AudioServiceProvider>
        <ChartEditorProvider activeScope={DEFAULT_GUITAR_EXPERT_SCOPE}>
          <Harness />
        </ChartEditorProvider>
      </AudioServiceProvider>,
    );

    fireEvent.keyDown(document, {key: 'a', ctrlKey: true});
    expect(screen.getByTestId('selected-count').textContent).toBe('3');

    const editable = screen.getByTestId('editable');
    editable.focus();
    fireEvent.keyDown(editable, {key: 'Escape'});

    expect(screen.getByTestId('selected-count').textContent).toBe('0');
  });
});

/** Opens the drums fixture in Place Note mode and shows the active tool and
 *  how many notes the track holds. */
function ToolHarness() {
  const {state, dispatch} = useChartEditorContext();
  useEditorKeyboard();

  useEffect(() => {
    dispatch({type: 'SET_CHART_DOC', chartDoc: makeFixtureDoc()});
    dispatch({type: 'SET_ACTIVE_TOOL', tool: 'place'});
  }, [dispatch]);

  const noteCount =
    state.chartDoc?.parsedChart.trackData[0].noteEventGroups.flat().length ?? 0;
  return (
    <div>
      <div data-testid="tool">{state.activeTool}</div>
      <div data-testid="note-count">{noteCount}</div>
    </div>
  );
}

describe('useEditorKeyboard — number keys pick tools and never place notes', () => {
  function mountInPlaceMode() {
    render(
      <AudioServiceProvider>
        <ChartEditorProvider>
          <ToolHarness />
        </ChartEditorProvider>
      </AudioServiceProvider>,
    );
    expect(screen.getByTestId('tool').textContent).toBe('place');
    // The fixture's drums/expert track: kick, red, yellow, blue, green.
    expect(screen.getByTestId('note-count').textContent).toBe('5');
  }

  it('a bare 1 selects the Cursor tool in Place Note mode', () => {
    mountInPlaceMode();

    fireEvent.keyDown(document, {key: '1'});

    expect(screen.getByTestId('tool').textContent).toBe('cursor');
    expect(screen.getByTestId('note-count').textContent).toBe('5');
  });

  it('a bare 2 selects Place Note again', () => {
    mountInPlaceMode();

    fireEvent.keyDown(document, {key: '1'});
    expect(screen.getByTestId('tool').textContent).toBe('cursor');
    fireEvent.keyDown(document, {key: '2'});

    expect(screen.getByTestId('tool').textContent).toBe('place');
  });

  it('no number key adds or removes a note in Place Note mode', () => {
    mountInPlaceMode();

    // 2 is the Place Note key itself: pressed in Place Note mode it keeps
    // that tool and places nothing.
    for (const key of ['0', '2', '3', '4', '5', '6', '7', '8', '9']) {
      fireEvent.keyDown(document, {key});
    }

    expect(screen.getByTestId('note-count').textContent).toBe('5');
    expect(screen.getByTestId('tool').textContent).toBe('place');
  });

  it('Mod+1 selects the Cursor tool too', () => {
    mountInPlaceMode();

    fireEvent.keyDown(document, {key: '1', ctrlKey: true});

    expect(screen.getByTestId('tool').textContent).toBe('cursor');
    expect(screen.getByTestId('note-count').textContent).toBe('5');
  });
});
