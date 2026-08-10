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
import SiteHeader, {SiteMain} from '../SiteChrome';
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

  it('includes the GitHub and Discord icon links on an editor route (plan 0076 item 1)', () => {
    mockPathname = '/chart-editor';
    renderChrome();

    const githubLink = screen.getByRole('link', {name: 'GitHub'});
    expect(githubLink).toHaveAttribute(
      'href',
      'https://github.com/TheSavior/spotify-clonehero',
    );
    const discordLink = screen.getByRole('link', {name: 'Discord'});
    expect(discordLink).toHaveAttribute(
      'href',
      'https://discord.gg/EDxu95B98s',
    );
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

describe('SiteMain (plan 0076 item 2: no gap below the compact header)', () => {
  it('drops top padding on an editor route so the grid sits flush under the header', () => {
    mockPathname = '/chart-editor';
    render(
      <SiteMain>
        <div data-testid="grid">grid</div>
      </SiteMain>,
    );

    const main = screen.getByTestId('grid').parentElement;
    expect(main?.tagName).toBe('MAIN');
    expect(main).not.toHaveClass('p-4');
    expect(main).not.toHaveClass('pt-4');
    // 0.75rem, not the full 1rem (plan 0076 items 3-4: the outer gutter on
    // editor routes still read as too roomy against the prototype at 1rem).
    expect(main).toHaveClass('px-3', 'pb-3');
  });

  it('keeps the full padding on a non-editor route', () => {
    mockPathname = '/spotify';
    render(
      <SiteMain>
        <div data-testid="content">content</div>
      </SiteMain>,
    );

    const main = screen.getByTestId('content').parentElement;
    expect(main).toHaveClass('p-4');
  });
});

describe('SiteMain gutter contract (plan 0099 Phase 4 item 1)', () => {
  /**
   * Which header a route gets and how much gutter `<main>` gives it are two
   * independent decisions. A route that lays out its own full-bleed shell can
   * take the regular site nav and no gutter, so it never has to cancel one
   * with a negative margin.
   */
  it('gives a full-bleed route no gutter at all', () => {
    mockPathname = '/find-music';
    render(
      <SiteMain>
        <div data-testid="content">content</div>
      </SiteMain>,
    );

    const main = screen.getByTestId('content').parentElement;
    expect(main).not.toHaveClass('p-4');
    expect(main).not.toHaveClass('px-3');
    expect(main).not.toHaveClass('pb-3');
  });

  it('still gives a full-bleed route the regular site nav, not the compact header', () => {
    mockPathname = '/find-music';
    renderChrome();

    expect(screen.getByText('Music Charts Tools')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', {name: 'Music Charts Tools home'}),
    ).not.toBeInTheDocument();
  });
});
