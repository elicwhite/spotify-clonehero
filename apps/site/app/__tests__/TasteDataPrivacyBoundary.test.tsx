/**
 * @jest-environment jsdom
 */

import {render} from '@testing-library/react';
import TasteDataPrivacyBoundary from '../TasteDataPrivacyBoundary';

let mockPathname = '/chart-editor';
let mockReplay: {stop: jest.Mock; startBuffering: jest.Mock} | undefined;
const stop = jest.fn(async () => undefined);
const startBuffering = jest.fn();
const ensureReplayRegistered = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('@sentry/nextjs', () => ({
  getReplay: () => mockReplay,
}));

jest.mock('../../lib/sentry/replay', () => ({
  ensureReplayRegistered: () => ensureReplayRegistered(),
}));

describe('TasteDataPrivacyBoundary', () => {
  beforeEach(() => {
    mockPathname = '/chart-editor';
    mockReplay = {stop, startBuffering};
    stop.mockClear();
    startBuffering.mockClear();
    ensureReplayRegistered.mockClear();
  });

  it('stops Replay before a private-route session and resumes after leaving', () => {
    const {rerender} = render(<TasteDataPrivacyBoundary />);
    expect(stop).not.toHaveBeenCalled();
    expect(startBuffering).not.toHaveBeenCalled();

    mockPathname = '/find-music';
    rerender(<TasteDataPrivacyBoundary />);
    expect(stop).toHaveBeenCalledTimes(1);

    mockPathname = '/chart-editor';
    rerender(<TasteDataPrivacyBoundary />);
    expect(startBuffering).toHaveBeenCalledTimes(1);
  });

  // A first load on a taste-data route registers no Replay integration at all,
  // so there is no buffer holding the user's songs. Leaving that route is the
  // first moment one may exist.
  it('registers Replay on leaving a private route', () => {
    mockReplay = undefined;
    mockPathname = '/find-music';
    const {rerender} = render(<TasteDataPrivacyBoundary />);
    expect(ensureReplayRegistered).not.toHaveBeenCalled();

    mockPathname = '/chart-editor';
    rerender(<TasteDataPrivacyBoundary />);
    expect(ensureReplayRegistered).toHaveBeenCalledTimes(1);
  });

  it('never registers Replay while a private route is open', () => {
    mockReplay = undefined;
    mockPathname = '/find-music';
    const {rerender} = render(<TasteDataPrivacyBoundary />);
    mockPathname = '/find-music/recommendations';
    rerender(<TasteDataPrivacyBoundary />);

    expect(ensureReplayRegistered).not.toHaveBeenCalled();
  });
});
