/**
 * @jest-environment jsdom
 */
/**
 * Site-wide header (plan 0074 Phase 7 task 7b): the full site nav on every
 * ordinary page, and on editor-rendering routes one compact row (app icon +
 * a content slot) that a page fills with its own identity and actions
 * instead of stacking a second header row.
 */

import '@testing-library/jest-dom';
import {render, screen} from '@testing-library/react';
import SiteHeader, {
  EditorChromeProvider,
  EditorHeaderContent,
} from '../SiteChrome';

let mockPathname = '/spotify';
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));

function SiteNavStub() {
  return <nav>Music Charts Tools</nav>;
}

function renderChrome(children?: React.ReactNode) {
  return render(
    <EditorChromeProvider>
      <SiteHeader siteNav={<SiteNavStub />} />
      {children}
    </EditorChromeProvider>,
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
  });

  it('renders the compact icon-only row (no site nav) on an editor route', () => {
    mockPathname = '/chart-editor';
    renderChrome();

    expect(screen.queryByText('Music Charts Tools')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', {name: 'Music Charts Tools home'}),
    ).toBeInTheDocument();
  });

  it('treats nested editor sub-paths as editor routes too', () => {
    mockPathname = '/add-lyrics/anything';
    renderChrome();

    expect(screen.queryByText('Music Charts Tools')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', {name: 'Music Charts Tools home'}),
    ).toBeInTheDocument();
  });

  it('puts a page header content into the one compact row rather than a second row', async () => {
    mockPathname = '/chart-editor';
    renderChrome(<EditorHeaderContent>Song title</EditorHeaderContent>);

    const row = await screen.findByRole('banner');
    expect(await screen.findByText('Song title')).toBeInTheDocument();
    // One header element, one app icon: the page's content joined the row
    // the site chrome already rendered.
    expect(screen.getAllByRole('banner')).toHaveLength(1);
    expect(
      screen.getAllByRole('link', {name: 'Music Charts Tools home'}),
    ).toHaveLength(1);
    expect(row).toContainElement(screen.getByText('Song title'));
  });

  it('renders its own row when there is no app shell around it', () => {
    render(<EditorHeaderContent>Song title</EditorHeaderContent>);

    const row = screen.getByRole('banner');
    expect(row).toContainElement(screen.getByText('Song title'));
    expect(
      screen.getByRole('link', {name: 'Music Charts Tools home'}),
    ).toBeInTheDocument();
  });

  it('renders no editor row on a non-editor route hosting editor content', () => {
    renderChrome(<EditorHeaderContent>Song title</EditorHeaderContent>);

    // The site nav stays, and the content falls back to its own row rather
    // than disappearing into a slot that does not exist.
    expect(screen.getByText('Music Charts Tools')).toBeInTheDocument();
    expect(screen.getByText('Song title')).toBeInTheDocument();
  });
});
