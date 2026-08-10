/**
 * @jest-environment jsdom
 */

import {render, waitFor} from '@testing-library/react';
import WebMCPInit from '../WebMCPInit';

let mockPathname = '/find-music';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('@mcp-b/global', () => ({
  initializeWebModelContext: jest.fn(),
}));

const getInitializeWebModelContext = async () =>
  (await import('@mcp-b/global')).initializeWebModelContext;

describe('WebMCPInit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    '/apple-music-connect',
    '/apple-music-connect/',
    '/find-music',
    '/find-music/recommendations',
  ])('does not initialize WebMCP on %s', async pathname => {
    mockPathname = pathname;
    render(<WebMCPInit />);

    await Promise.resolve();
    expect(await getInitializeWebModelContext()).not.toHaveBeenCalled();
  });

  it('initializes WebMCP on ordinary routes', async () => {
    mockPathname = '/chart-editor';
    render(<WebMCPInit />);

    const initializeWebModelContext = await getInitializeWebModelContext();
    await waitFor(() =>
      expect(initializeWebModelContext).toHaveBeenCalledTimes(1),
    );
  });
});
