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
 * aren't what this test is about.
 */

import '@testing-library/jest-dom';
import {render, screen} from '@testing-library/react';
import {createEmptyChart} from '@eliwhite/scan-chart';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import type {AudioManager} from '@/lib/preview/audioManager';
import SiteHeader from '@/components/SiteChrome';
import {ChartEditorProvider} from '../ChartEditorContext';
import {AudioServiceProvider} from '../AudioServiceContext';
import ChartEditor from '../ChartEditor';

let mockPathname = '/chart-editor';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('../../../lib/supabase/AuthProvider', () => ({
  useAuth: () => ({user: null, loading: false}),
}));

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
// `trackNames`/`setVolume`: the sidebar's Stems mixer (plan 0074 Phase 5)
// reads these on every mount now that DRUM_EDIT_CAPABILITIES (the default)
// shows it.
const audioManager = {
  trackNames: [],
  setVolume: () => {},
} as unknown as AudioManager;

function editor(props: {hideHeader?: boolean} = {}) {
  return (
    <AudioServiceProvider>
      <ChartEditorProvider>
        <ChartEditor
          metadata={metadata}
          chart={createEmptyChart({bpm: 120, resolution: 480})}
          audioManager={audioManager}
          durationSeconds={180}
          songName="Test Song"
          {...props}
        />
      </ChartEditorProvider>
    </AudioServiceProvider>
  );
}

function renderEditor(props: {hideHeader?: boolean} = {}) {
  return render(editor(props));
}

function SiteNavStub() {
  return <nav>Music Charts Tools</nav>;
}

beforeEach(() => {
  mockPathname = '/chart-editor';
});

describe('editor density scope (plan 0074 Phase 7 task 7c)', () => {
  it('marks the document root compact while an editor is mounted, and clears it after', () => {
    const {unmount} = renderEditor();

    // The root, not the editor's own subtree: Radix portals Select menus and
    // dialogs into `document.body`, outside any editor-scoped wrapper.
    expect(document.documentElement.dataset['density']).toBe('compact');

    unmount();
    expect(document.documentElement.dataset['density']).toBeUndefined();
  });

  it('does not mark a non-editor page compact (/spotify)', async () => {
    // Dynamic import so this suite doesn't drag /spotify's module graph
    // (Supabase client, etc.) into every other test in this file.
    const {default: WelcomeCard} = await import('@/app/spotify/WelcomeCard');
    render(<WelcomeCard />);

    expect(document.documentElement.dataset['density']).toBeUndefined();
  });
});

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
    renderEditor({hideHeader: true});

    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(
      screen.getByRole('region', {name: 'Editing surface'}),
    ).toBeInTheDocument();
  });
});

describe('site header + editor header row (plan 0074 Phase 8 task 8c)', () => {
  it("carries the editor's song identity in its own header row", () => {
    renderEditor();

    const header = screen.getByRole('banner');
    expect(header).toHaveTextContent('Test Song');
  });

  it('renders the compact site header (home link + auth) above the editor, as a row separate from the editor header', () => {
    render(
      <>
        <SiteHeader siteNav={<SiteNavStub />} />
        {editor()}
      </>,
    );

    // The compact site header and the editor's own song row are both on
    // screen at once - two `<header>` elements, one carrying the site's
    // home link, the other the song identity - neither suppresses the
    // other.
    const homeLink = screen.getByRole('link', {
      name: 'Music Charts Tools home',
    });
    expect(homeLink).toHaveAttribute('href', '/');
    expect(screen.getByText('Log In')).toBeInTheDocument();
    expect(screen.getByText('Test Song')).toBeInTheDocument();
  });

  it('keeps the full site nav, and no compact header, on a non-editor route', () => {
    mockPathname = '/spotify';
    render(<SiteHeader siteNav={<SiteNavStub />} />);

    expect(screen.getByText('Music Charts Tools')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', {name: 'Music Charts Tools home'}),
    ).not.toBeInTheDocument();
  });
});
