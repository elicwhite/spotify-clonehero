/**
 * @jest-environment jsdom
 */
/**
 * ChartEditor responsive layout (plan 0074 Phase 3, task 3c).
 *
 * `ChartEditor` renders one named-areas CSS grid (`header`/`sidebar`/`main`/
 * `bottom`); `app/globals.css` maps the areas, with a single
 * `@media (min-width: 1440px)` rule taking the sidebar from occupying only
 * the middle row to spanning all three. No JS measurement is involved and
 * the DOM itself never restructures between the two modes, so this is a
 * smoke test rather than a real-viewport layout test (jsdom loads no
 * stylesheet and evaluates no `@media`): it asserts that the same landmark
 * roles exist in the one render, that each carries its constant `grid-area`,
 * and that all of them live inside the grid container.
 *
 * Heavy children (`HighwayEditor`, `PianoRollTimeline`, `TransportControls`)
 * are stubbed — they need a WebGL/canvas surface jsdom doesn't provide and
 * aren't what this test is about. `SheetMusic` never mounts here since
 * `state.showSheetMusic` defaults to false.
 */

import '@testing-library/jest-dom';
import {render, screen} from '@testing-library/react';
import {createEmptyChart} from '@eliwhite/scan-chart';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import type {AudioManager} from '@/lib/preview/audioManager';
import {ChartEditorProvider} from '../ChartEditorContext';
import {AudioServiceProvider} from '../AudioServiceContext';
import ChartEditor from '../ChartEditor';

jest.mock('../HighwayEditor', () => ({
  __esModule: true,
  default: () => <div data-testid="highway-editor-stub" />,
}));
jest.mock('../piano-roll/PianoRollTimeline', () => ({
  __esModule: true,
  default: () => <div data-testid="piano-roll-stub" />,
}));
jest.mock('../TransportControls', () => ({
  __esModule: true,
  default: () => <div data-testid="transport-controls-stub" />,
}));
const metadata = {} as ChartResponseEncore;
const audioManager = {} as AudioManager;

function renderEditor() {
  const chart = createEmptyChart({bpm: 120, resolution: 480});
  return render(
    <AudioServiceProvider>
      <ChartEditorProvider>
        <ChartEditor
          metadata={metadata}
          chart={chart}
          audioManager={audioManager}
          durationSeconds={180}
          songName="Test Song"
        />
      </ChartEditorProvider>
    </AudioServiceProvider>,
  );
}

describe('ChartEditor responsive grid', () => {
  it('renders the header, sidebar, and editing-surface regions the grid places into named areas', () => {
    renderEditor();

    const header = screen.getByRole('banner');
    const sidebar = screen.getByRole('complementary');
    const main = screen.getByRole('region', {name: 'Editing surface'});

    expect(header).toHaveTextContent('Test Song');
    expect(sidebar).toBeInTheDocument();
    expect(main).toContainElement(screen.getByTestId('highway-editor-stub'));

    // Same DOM in both breakpoints — every named area is a constant
    // `grid-area`, only the container's area map changes with viewport.
    expect(header).toHaveStyle({gridArea: 'header'});
    expect(sidebar).toHaveStyle({gridArea: 'sidebar'});
    expect(main).toHaveStyle({gridArea: 'main'});
  });

  it('places every region inside the one named-areas grid container', () => {
    renderEditor();

    const grid = document.querySelector('.chart-editor-grid');
    expect(grid).not.toBeNull();
    for (const region of [
      screen.getByRole('banner'),
      screen.getByRole('complementary'),
      screen.getByRole('region', {name: 'Editing surface'}),
    ]) {
      expect(grid).toContainElement(region);
    }
  });

  it('does not render the header landmark when hideHeader suppresses it (both modes stay landmark-consistent)', () => {
    const chart = createEmptyChart({bpm: 120, resolution: 480});
    render(
      <AudioServiceProvider>
        <ChartEditorProvider>
          <ChartEditor
            metadata={metadata}
            chart={chart}
            audioManager={audioManager}
            durationSeconds={180}
            songName="Test Song"
            hideHeader
          />
        </ChartEditorProvider>
      </AudioServiceProvider>,
    );

    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(
      screen.getByRole('region', {name: 'Editing surface'}),
    ).toBeInTheDocument();
  });
});
