/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {fireEvent, render, screen} from '@testing-library/react';

import FindMusicWelcome, {
  type FindMusicWelcomeProps,
} from '../FindMusicWelcome';
import type {SourceStatus} from '../types';

const idle: SourceStatus = {phase: 'idle', summary: 'Not connected'};

function props(
  overrides: Partial<FindMusicWelcomeProps> = {},
): FindMusicWelcomeProps {
  return {
    authenticated: false,
    hasSpotify: false,
    historyStatus: {phase: 'idle', summary: 'No history folder loaded'},
    libraryStatus: idle,
    localStatus: {phase: 'idle', summary: 'No Songs folder scanned'},
    chorusStatus: {phase: 'loading', summary: 'Checking for new charts…'},
    onConnectSpotify: jest.fn(),
    onRefreshHistory: jest.fn(),
    onRefreshLibrary: jest.fn(),
    onScanLocal: jest.fn(),
    onRefreshChorus: jest.fn(),
    ...overrides,
  };
}

describe('FindMusicWelcome', () => {
  it('provides a private, local first-run path and explains both outcomes', () => {
    render(<FindMusicWelcome {...props()} />);

    expect(
      screen.getByRole('heading', {
        name: 'Bring in the music you already care about',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Local and private')).toBeInTheDocument();
    expect(
      screen.getByText(/never need to leave this device/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {name: 'Your music'}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {name: 'Recommendations'}),
    ).toBeInTheDocument();
    expect(screen.getByText('Optional', {exact: false})).toBeInTheDocument();
    expect(
      screen.getByRole('link', {
        name: 'Request your Spotify Extended Streaming History',
      }),
    ).toHaveAttribute('href', 'https://www.spotify.com/us/account/privacy/');
    expect(screen.getByTestId('welcome-spotify-history')).toHaveTextContent(
      'Import your Spotify Extended Streaming History to surface songs you listen to.',
    );
    expect(
      screen.getByText(/install charts directly and filter out songs/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('welcome-spotify-library')).not.toHaveClass(
      'min-h-[220px]',
    );
    expect(screen.getByTestId('find-music-welcome')).toHaveClass(
      'overflow-y-auto',
    );
  });

  it('uses the correct Spotify action for signed-out, signed-in, and connected people', () => {
    const signedOut = props();
    const {rerender} = render(<FindMusicWelcome {...signedOut} />);

    fireEvent.click(screen.getByRole('button', {name: 'Sign in with Spotify'}));
    expect(signedOut.onConnectSpotify).toHaveBeenCalledTimes(1);

    const signedIn = props({authenticated: true});
    rerender(<FindMusicWelcome {...signedIn} />);
    fireEvent.click(screen.getByRole('button', {name: 'Connect Spotify'}));
    expect(signedIn.onConnectSpotify).toHaveBeenCalledTimes(1);

    const connected = props({authenticated: true, hasSpotify: true});
    rerender(<FindMusicWelcome {...connected} />);
    fireEvent.click(screen.getByRole('button', {name: 'Load library'}));
    expect(connected.onRefreshLibrary).toHaveBeenCalledTimes(1);
  });

  it('shows source progress, errors, and retries with the owning callback', () => {
    const welcomeProps = props({
      historyStatus: {
        phase: 'loading',
        summary: 'Reading Spotify history…',
        progress: 42,
      },
      localStatus: {
        phase: 'error',
        summary: 'Local scan failed',
        detail: 'Folder permission was revoked',
      },
    });
    render(<FindMusicWelcome {...welcomeProps} />);

    expect(
      screen.getByRole('progressbar', {name: 'Spotify History progress'}),
    ).toHaveAttribute('aria-valuenow', '42');
    expect(
      screen.getByRole('button', {name: 'Spotify History is working'}),
    ).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Local scan failed');

    fireEvent.click(screen.getByRole('button', {name: 'Try again'}));
    expect(welcomeProps.onScanLocal).toHaveBeenCalledTimes(1);
  });

  it('only exposes a Chorus retry when its automatic refresh has failed', () => {
    const ready = props({
      chorusStatus: {phase: 'ready', summary: '34,000 charts'},
    });
    const {rerender} = render(<FindMusicWelcome {...ready} />);

    expect(
      screen.queryByRole('button', {name: 'Retry index'}),
    ).not.toBeInTheDocument();

    const failed = props({
      chorusStatus: {
        phase: 'error',
        summary: 'Index refresh failed',
        detail: 'Network unavailable',
      },
    });
    rerender(<FindMusicWelcome {...failed} />);

    fireEvent.click(screen.getByRole('button', {name: 'Retry index'}));
    expect(failed.onRefreshChorus).toHaveBeenCalledTimes(1);
  });
});
