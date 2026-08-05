/**
 * @jest-environment jsdom
 */
/**
 * The transport bar owns the editor's tool actions: the cursor/place-note
 * mode switch and undo/redo. Contracts covered here:
 *
 * 1. The buttons are on the transport, not the sidebar, and switching mode
 *    writes `activeTool` in editor state.
 * 2. Undo/redo start disabled (nothing in the history) and stay wired to
 *    `useUndoRedo`.
 * 3. `showToolPalette: false` hides the whole group, so preview-only pages
 *    keep a bare transport.
 * 4. The bar shows no speed readout — speed is shown and stepped once, in
 *    the sidebar's utility cluster.
 */

import '@testing-library/jest-dom';
import {fireEvent, render, screen} from '@testing-library/react';
import TransportControls from '../TransportControls';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {
  DRUM_EDIT_CAPABILITIES,
  PREVIEW_CAPABILITIES,
  type EditorCapabilities,
} from '../capabilities';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '../scope';
import {fakeAudioManager} from './fakeAudioManager';

/** Surfaces `state.activeTool` so a click on a tool button is observable. */
function ActiveToolProbe() {
  const {state} = useChartEditorContext();
  return <div data-testid="active-tool">{state.activeTool}</div>;
}

function renderTransport(capabilities: EditorCapabilities) {
  return render(
    <ChartEditorProvider
      capabilities={capabilities}
      activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
      <TransportControls
        audioManager={fakeAudioManager()}
        durationSeconds={60}
      />
      <ActiveToolProbe />
    </ChartEditorProvider>,
  );
}

describe('TransportControls tool actions', () => {
  it('renders the cursor, place-note, undo and redo buttons', () => {
    renderTransport(DRUM_EDIT_CAPABILITIES);
    expect(screen.getByRole('button', {name: 'Cursor'})).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: 'Place Note'}),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Undo'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Redo'})).toBeInTheDocument();
  });

  it('switches the active tool when a tool button is clicked', () => {
    renderTransport(DRUM_EDIT_CAPABILITIES);
    expect(screen.getByTestId('active-tool')).toHaveTextContent('cursor');

    fireEvent.click(screen.getByRole('button', {name: 'Place Note'}));

    expect(screen.getByTestId('active-tool')).toHaveTextContent('place');
    expect(screen.getByRole('button', {name: 'Place Note'})).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('disables undo and redo with an empty history', () => {
    renderTransport(DRUM_EDIT_CAPABILITIES);
    expect(screen.getByRole('button', {name: 'Undo'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Redo'})).toBeDisabled();
  });

  it('hides the tool actions when the tool palette is not available', () => {
    renderTransport(PREVIEW_CAPABILITIES);
    for (const name of ['Cursor', 'Place Note', 'Undo', 'Redo']) {
      expect(screen.queryByRole('button', {name})).not.toBeInTheDocument();
    }
  });

  it('shows no speed readout', () => {
    renderTransport(DRUM_EDIT_CAPABILITIES);
    expect(screen.queryByText(/speed/i)).not.toBeInTheDocument();
  });
});
