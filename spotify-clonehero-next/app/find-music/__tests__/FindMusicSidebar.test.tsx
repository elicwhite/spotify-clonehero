/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {fireEvent, render, screen, within} from '@testing-library/react';

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
    minPlays: 0,
    evidence: new Set(),
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
  it('switches between Your music and Radar and displays their counts', () => {
    const onViewChange = jest.fn();
    render(<FindMusicSidebar {...makeProps({onViewChange})} />);

    expect(
      screen.getByLabelText('Navigation, filters and sources'),
    ).toHaveClass('max-h-[40vh]', '[contain:paint]', 'lg:max-h-full');

    expect(screen.getByRole('button', {name: /your music/i})).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText('3,783')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /radar/i}));
    expect(onViewChange).toHaveBeenCalledWith('radar');
    fireEvent.click(screen.getByRole('button', {name: /your music/i}));
    expect(onViewChange).toHaveBeenLastCalledWith('music');
  });

  it('emits immutable install, instrument, minimum-play and evidence filters', () => {
    const onFiltersChange = jest.fn();
    const filters = makeFilters({instruments: new Set(['drums'])});
    render(<FindMusicSidebar {...makeProps({filters, onFiltersChange})} />);

    expect(
      screen.getByRole('button', {name: 'Require Guitar'}).querySelector('img'),
    ).toHaveAttribute('src', expect.stringContaining('guitar.png'));

    fireEvent.click(
      screen.getByRole('radio', {
        name: 'Hide songs with installed charts',
      }),
    );
    expect(onFiltersChange).toHaveBeenCalledWith({
      ...filters,
      install: 'hide-installed',
    });

    fireEvent.click(screen.getByRole('button', {name: 'Require Drums'}));
    const instrumentUpdate = onFiltersChange.mock.calls[1][0];
    expect(instrumentUpdate.instruments).toEqual(new Set());
    expect(instrumentUpdate.instruments).not.toBe(filters.instruments);

    fireEvent.change(screen.getByRole('slider', {name: 'Minimum play count'}), {
      target: {value: '25'},
    });
    expect(onFiltersChange).toHaveBeenCalledWith({...filters, minPlays: 25});

    fireEvent.click(screen.getByRole('checkbox', {name: 'Playlists'}));
    const evidenceUpdate = onFiltersChange.mock.calls[3][0];
    expect(evidenceUpdate.evidence).toEqual(new Set(['playlist']));
    expect(evidenceUpdate.evidence).not.toBe(filters.evidence);
  });

  it('clears active filters through the provided callback', () => {
    const onClearFilters = jest.fn();
    render(
      <FindMusicSidebar
        {...makeProps({
          filters: makeFilters({minPlays: 10}),
          onClearFilters,
        })}
      />,
    );

    expect(screen.getByText('1 active')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Clear all'}));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('keeps install and instrument filters enabled on Radar but disables direct-evidence filters', () => {
    render(<FindMusicSidebar {...makeProps({view: 'radar'})} />);

    expect(screen.getByRole('radio', {name: 'Only installed'})).toBeEnabled();
    expect(screen.getByRole('button', {name: 'Require Guitar'})).toBeEnabled();
    expect(
      screen.getByRole('slider', {name: 'Minimum play count'}),
    ).toBeDisabled();
    expect(screen.getByRole('checkbox', {name: 'History'})).toBeDisabled();
    expect(
      screen.getByText(
        /play-count and evidence filters do not apply to radar/i,
      ),
    ).toBeInTheDocument();
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
