/**
 * @jest-environment jsdom
 */

import {render} from '@testing-library/react';
import TasteDataPrivacyBoundary from '../TasteDataPrivacyBoundary';

let mockPathname = '/chart-editor';
const stop = jest.fn(async () => undefined);
const startBuffering = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('@sentry/nextjs', () => ({
  getReplay: () => ({stop, startBuffering}),
}));

describe('TasteDataPrivacyBoundary', () => {
  beforeEach(() => {
    mockPathname = '/chart-editor';
    stop.mockClear();
    startBuffering.mockClear();
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
});
