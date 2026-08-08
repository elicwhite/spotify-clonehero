/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {fireEvent, render, screen, within} from '@testing-library/react';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

import FindMusicSidebar, {
  type FindMusicSidebarProps,
} from '../FindMusicSidebar';
import type {FindMusicFilters, SourceStatus} from '../types';

const idle: SourceStatus = {phase: 'idle', summary: 'Not connected'};
const ready: SourceStatus = {phase: 'ready', summary: 'Refreshed just now'};

function makeFilters(
  overrides: Partial<FindMusicFilters> = {},
): FindMusicFilters {
  return {
    install: 'all',
    instruments: new Set(),
    query: '',
    exclusions: [],
    exclusionDraft: '',
    ...overrides,
  };
}

function makeProps(
  overrides: Partial<FindMusicSidebarProps> = {},
): FindMusicSidebarProps {
  return {
    view: 'music',
    onViewChange: jest.fn(),
    filters: makeFilters(),
    onFiltersChange: jest.fn(),
    onClearFilters: jest.fn(),
    historyStatus: idle,
    libraryStatus: idle,
    localStatus: idle,
    chorusStatus: ready,
    onRefreshHistory: jest.fn(),
    onRefreshLibrary: jest.fn(),
    onScanLocal: jest.fn(),
    onRefreshChorus: jest.fn(),
    onConnectSpotify: jest.fn(),
    authenticated: true,
    hasSpotify: true,
    musicCount: 3783,
    radarCount: 1200,
    ...overrides,
  };
}

describe('FindMusicSidebar', () => {
  it('switches between Your music and Recommendations and displays their counts', () => {
    const onViewChange = jest.fn();
    render(<FindMusicSidebar {...makeProps({onViewChange})} />);

    expect(
      screen.getByLabelText('Navigation, filters and sources'),
    ).toHaveClass('max-h-[40vh]', '[contain:paint]', 'lg:max-h-full');

    expect(screen.getByRole('link', {name: /your music/i})).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', {name: /your music/i})).toHaveAttribute(
      'href',
      '/find-music',
    );
    expect(
      screen.getByRole('link', {name: /recommendations/i}),
    ).toHaveAttribute('href', '/find-music/recommendations');
    expect(screen.getByText('3,783')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByText('more from artists you play')).toBeInTheDocument();
    expect(
      screen.queryByText('affinity recommendations'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('YouTube Music')).not.toBeInTheDocument();
    expect(screen.queryByText('Apple Music')).not.toBeInTheDocument();

    const library = screen.getByTestId('source-library');
    const history = screen.getByTestId('source-history');
    expect(
      library.compareDocumentPosition(history) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(history).getByRole('link', {
        name: 'Request Extended Streaming History',
      }),
    ).toHaveAttribute('href', 'https://www.spotify.com/us/account/privacy/');

    fireEvent.click(screen.getByRole('link', {name: /recommendations/i}));
    expect(onViewChange).toHaveBeenCalledWith('radar');
    fireEvent.click(screen.getByRole('link', {name: /your music/i}));
    expect(onViewChange).toHaveBeenLastCalledWith('music');
  });

  it('fills a mobile drawer without retaining the stacked sidebar height cap', () => {
    render(<FindMusicSidebar {...makeProps({variant: 'drawer'})} />);

    const sidebar = screen.getByLabelText('Navigation, filters and sources');
    expect(sidebar).toHaveClass('h-full', 'max-h-full', 'w-full', 'border-0');
    expect(sidebar).not.toHaveClass('max-h-[40vh]', 'border-b');
  });

  it('emits text, install and immutable instrument filters', () => {
    const onFiltersChange = jest.fn();
    const filters = makeFilters({instruments: new Set(['guitar'])});
    render(<FindMusicSidebar {...makeProps({filters, onFiltersChange})} />);

    expect(
      screen.getByRole('button', {name: 'Require Guitar'}).querySelector('img'),
    ).toHaveAttribute('src', expect.stringContaining('guitar.png'));

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Hide songs with installed charts',
      }),
    );
    expect(onFiltersChange).toHaveBeenCalledWith({
      ...filters,
      install: 'hide-installed',
    });

    fireEvent.click(screen.getByRole('button', {name: 'Require Guitar'}));
    const instrumentUpdate = onFiltersChange.mock.calls[1][0];
    expect(instrumentUpdate.instruments).toEqual(new Set());
    expect(instrumentUpdate.instruments).not.toBe(filters.instruments);

    fireEvent.change(screen.getByRole('searchbox', {name: 'Artist or song'}), {
      target: {value: 'Incubus Drive'},
    });
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...filters,
      query: 'Incubus Drive',
    });
  });

  it('offers pro drums without a PD label and does not offer regular drums', () => {
    render(<FindMusicSidebar {...makeProps()} />);

    expect(
      screen
        .getByRole('button', {name: 'Require Pro drums'})
        .querySelector('img'),
    ).toHaveAttribute('src', expect.stringContaining('drums.png'));
    expect(
      screen.queryByRole('button', {name: 'Require Drums'}),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('PD')).not.toBeInTheDocument();
  });

  it('filters live while adding, commits, and removes exclusion terms', () => {
    const onFiltersChange = jest.fn();
    const initial = makeFilters();
    const view = render(
      <FindMusicSidebar {...makeProps({filters: initial, onFiltersChange})} />,
    );

    fireEvent.click(screen.getByRole('button', {name: 'Add exclusion'}));
    const input = screen.getByRole('searchbox', {name: 'Exclusion term'});
    expect(input).toHaveFocus();
    fireEvent.change(input, {target: {value: 'blink'}});
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...initial,
      exclusionDraft: 'blink',
    });

    const drafting = {...initial, exclusionDraft: 'blink'};
    view.rerender(
      <FindMusicSidebar {...makeProps({filters: drafting, onFiltersChange})} />,
    );
    fireEvent.keyDown(screen.getByRole('searchbox', {name: 'Exclusion term'}), {
      key: 'Enter',
    });
    expect(onFiltersChange).toHaveBeenLastCalledWith({
      ...initial,
      exclusions: ['blink'],
    });

    const committed = {...initial, exclusions: ['blink']};
    view.rerender(
      <FindMusicSidebar
        {...makeProps({filters: committed, onFiltersChange})}
      />,
    );
    expect(screen.getByText('blink')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {name: 'Remove exclusion blink'}),
    );
    expect(onFiltersChange).toHaveBeenLastCalledWith(initial);
  });

  it('restores a persisted draft in the editor and lets Escape clear it', () => {
    const onFiltersChange = jest.fn();
    const filters = makeFilters({exclusionDraft: 'blink'});
    render(<FindMusicSidebar {...makeProps({filters, onFiltersChange})} />);

    const input = screen.getByRole('searchbox', {name: 'Exclusion term'});
    expect(input).toHaveValue('blink');
    fireEvent.keyDown(input, {key: 'Escape'});
    expect(onFiltersChange).toHaveBeenCalledWith({
      ...filters,
      exclusionDraft: '',
    });
  });

  it('clears active filters through the provided callback', () => {
    const onClearFilters = jest.fn();
    render(
      <FindMusicSidebar
        {...makeProps({
          filters: makeFilters({query: 'muse'}),
          onClearFilters,
        })}
      />,
    );

    expect(screen.getByText('1 active')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Clear all'}));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('keeps the same focused filters available on Recommendations', () => {
    render(<FindMusicSidebar {...makeProps({view: 'radar'})} />);

    expect(
      screen.getByRole('checkbox', {
        name: 'Hide songs with installed charts',
      }),
    ).toBeEnabled();
    expect(screen.getByRole('button', {name: 'Require Guitar'})).toBeEnabled();
    expect(
      screen.getByRole('searchbox', {name: 'Artist or song'}),
    ).toBeEnabled();
    expect(screen.queryByText('Minimum plays')).not.toBeInTheDocument();
    expect(screen.queryByText('Evidence source')).not.toBeInTheDocument();
  });

  it('routes each source action to its callback and connects Spotify when needed', () => {
    const onRefreshHistory = jest.fn();
    const onScanLocal = jest.fn();
    const onRefreshChorus = jest.fn();
    const onConnectSpotify = jest.fn();
    render(
      <FindMusicSidebar
        {...makeProps({
          onRefreshHistory,
          onScanLocal,
          onRefreshChorus,
          onConnectSpotify,
          libraryStatus: ready,
          authenticated: false,
          hasSpotify: false,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', {name: 'Pick history folder…'}));
    fireEvent.click(screen.getByRole('button', {name: 'Pick Songs folder…'}));
    fireEvent.click(screen.getByRole('button', {name: 'Refresh index'}));
    fireEvent.click(screen.getByRole('button', {name: 'Sign in with Spotify'}));

    expect(onRefreshHistory).toHaveBeenCalledTimes(1);
    expect(onScanLocal).toHaveBeenCalledTimes(1);
    expect(onRefreshChorus).toHaveBeenCalledTimes(1);
    expect(onConnectSpotify).toHaveBeenCalledTimes(1);
  });

  it('does not allow an index download before a taste source is connected', () => {
    render(
      <FindMusicSidebar
        {...makeProps({authenticated: false, hasSpotify: false})}
      />,
    );

    expect(
      within(screen.getByTestId('source-chorus')).getByRole('button', {
        name: 'Connect taste sources first',
      }),
    ).toBeDisabled();
  });

  it('refreshes the Spotify library directly for a connected account', () => {
    const onRefreshLibrary = jest.fn();
    render(
      <FindMusicSidebar
        {...makeProps({
          libraryStatus: ready,
          onRefreshLibrary,
        })}
      />,
    );

    const library = screen.getByTestId('source-library');
    fireEvent.click(within(library).getByRole('button', {name: 'Refresh'}));
    expect(onRefreshLibrary).toHaveBeenCalledTimes(1);
  });

  it('announces source loading state, renders progress, and disables its action', () => {
    render(
      <FindMusicSidebar
        {...makeProps({
          libraryStatus: {
            phase: 'loading',
            summary: '14 / 62 playlists',
            detail: 'Continuing after Spotify rate limit',
            progress: 22,
          },
        })}
      />,
    );

    const library = screen.getByTestId('source-library');
    expect(within(library).getByRole('status')).toHaveTextContent(
      '14 / 62 playlists',
    );
    expect(
      within(library).getByRole('progressbar', {
        name: 'Spotify Library progress',
      }),
    ).toHaveAttribute('aria-valuenow', '22');
    expect(
      within(library).getByRole('button', {
        name: 'Spotify Library is loading',
      }),
    ).toBeDisabled();
    expect(library).toHaveTextContent('Continuing after Spotify rate limit');
  });

  it('exposes source errors as alerts with a retry action', () => {
    const onRefreshHistory = jest.fn();
    render(
      <FindMusicSidebar
        {...makeProps({
          historyStatus: {
            phase: 'error',
            summary: 'History files could not be read',
          },
          onRefreshHistory,
        })}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'History files could not be read',
    );
    fireEvent.click(screen.getByRole('button', {name: 'Try again'}));
    expect(onRefreshHistory).toHaveBeenCalledTimes(1);
  });
});
