/**
 * @jest-environment jsdom
 */
/**
 * Site-wide header (plan 0074 Phase 8 task 8c, owner feedback from live
 * review 2026-08-03: the site header - brand link home, More Tools, login -
 * must stay visible at the top of every editor route). The full site nav on
 * every ordinary page; on an editor route, the compact site header (home
 * link + More Tools + auth controls) instead - always present, never
 * suppressed by the page beneath it.
 */

import '@testing-library/jest-dom';
import {render, screen} from '@testing-library/react';
import SiteHeader from '../SiteChrome';
import EditorHeaderRow from '../chart-editor/EditorHeaderRow';

let mockPathname = '/spotify';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('../../lib/supabase/AuthProvider', () => ({
  useAuth: () => ({user: null, loading: false}),
}));

function SiteNavStub() {
  return <nav>Music Charts Tools</nav>;
}

function renderChrome(children?: React.ReactNode) {
  return render(
    <>
      <SiteHeader siteNav={<SiteNavStub />} />
      {children}
    </>,
  );
}

describe('SiteHeader', () => {
  beforeEach(() => {
    mockPathname = '/spotify';
  });

  it('renders the full site nav on a non-editor page', () => {
    renderChrome();

    expect(screen.getByText('Music Charts Tools')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', {name: 'Music Charts Tools home'}),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Log In')).not.toBeInTheDocument();
  });

  it('renders the compact site header - home link, More Tools, and auth controls - on an editor route', () => {
    mockPathname = '/chart-editor';
    renderChrome();

    const homeLink = screen.getByRole('link', {
      name: 'Music Charts Tools home',
    });
    expect(homeLink).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', {name: 'More Tools'})).toBeInTheDocument();
    expect(screen.getByText('Log In')).toBeInTheDocument();
  });

  it('treats nested editor sub-paths as editor routes too', () => {
    mockPathname = '/add-lyrics/anything';
    renderChrome();

    expect(
      screen.getByRole('link', {name: 'Music Charts Tools home'}),
    ).toBeInTheDocument();
  });

  it('renders exactly one site header, whatever else the page renders', () => {
    mockPathname = '/chart-editor';
    renderChrome(<EditorHeaderRow>Song title</EditorHeaderRow>);

    // The compact site header and the editor's own song row are two
    // distinct `<header>` elements - both on screen, neither suppressing
    // the other - but only one of them is the *site* header.
    expect(
      screen.getAllByRole('link', {name: 'Music Charts Tools home'}),
    ).toHaveLength(1);
    expect(screen.getByText('Song title')).toBeInTheDocument();
  });
});

describe("EditorHeaderRow (the editor's own song-identity row)", () => {
  it('always renders its own row, independent of route or site chrome', () => {
    mockPathname = '/spotify';
    render(<EditorHeaderRow>Song title</EditorHeaderRow>);

    expect(screen.getByText('Song title')).toBeInTheDocument();
  });
});
