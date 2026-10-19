/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import type {AppleMusicClient} from '@/lib/apple-music/client';
import AppleMusicConnectClient from '../AppleMusicConnectClient';

const mockLoad = jest.fn(async () => undefined);
const mockConfigure = jest.fn();
const mockNavigate = jest.fn();

jest.mock('../../../lib/apple-music', () => ({
  prepareAppleMusicClient: async () => {
    await mockLoad();
    return {client: await mockConfigure(), developerTokenExpiresAt: Infinity};
  },
}));

jest.mock('../../../lib/apple-music/navigation', () => ({
  navigateToAppleMusicPath: (path: string) => mockNavigate(path),
}));

function client(authorized = false): AppleMusicClient {
  return {
    isAuthorized: jest.fn(() => authorized),
    authorize: jest.fn(async () => undefined),
    unauthorize: jest.fn(async () => undefined),
  };
}

function renderConnector(returnTo?: string) {
  return render(
    <AppleMusicConnectClient {...(returnTo === undefined ? {} : {returnTo})} />,
  );
}

describe('AppleMusicConnectClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('waits for a second user click before authorizing and hard-navigating', async () => {
    const configured = client();
    mockConfigure.mockResolvedValue(configured);
    renderConnector('/find-music/recommendations');

    const continueButton = await screen.findByRole('button', {
      name: 'Continue with Apple Music',
    });
    expect(configured.authorize).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.click(continueButton);

    await waitFor(() => expect(configured.authorize).toHaveBeenCalledTimes(1));
    expect(mockNavigate).toHaveBeenCalledWith('/find-music/recommendations');
  });

  it('reports restored authorization and does not authorize again', async () => {
    const configured = client(true);
    mockConfigure.mockResolvedValue(configured);
    renderConnector('/find-music');

    expect(
      await screen.findByText(
        'Apple Music authorization was restored in this browser.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Return to Find Music'}));

    expect(configured.authorize).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/find-music');
  });

  it('uses the safe fallback when canceling an unapproved return path', async () => {
    mockConfigure.mockResolvedValue(client());
    renderConnector('https://attacker.example');

    await screen.findByRole('button', {name: 'Continue with Apple Music'});
    fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));

    expect(mockNavigate).toHaveBeenCalledWith('/find-music');
  });

  it('offers a setup retry without invoking authorization', async () => {
    mockLoad
      .mockRejectedValueOnce(new Error('blocked'))
      .mockResolvedValueOnce(undefined);
    mockConfigure.mockResolvedValue(client());
    renderConnector();

    fireEvent.click(await screen.findByRole('button', {name: 'Retry setup'}));

    expect(
      await screen.findByRole('button', {name: 'Continue with Apple Music'}),
    ).toBeInTheDocument();
    expect(mockLoad).toHaveBeenCalledTimes(2);
  });
});
