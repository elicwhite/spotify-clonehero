/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {render, screen} from '@testing-library/react';
import RegionAwareAnalytics from '../RegionAwareAnalytics';

let mockPathname = '/find-music';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('@next/third-parties/google', () => ({
  GoogleAnalytics: ({gaId}: {gaId: string}) => (
    <div data-testid="google-analytics">{gaId}</div>
  ),
}));

describe('RegionAwareAnalytics', () => {
  beforeEach(() => {
    document.cookie = 'gaRegion=other';
  });

  // Funnel data from Find Music stopped flowing when 7b621ddc added the route to
  // one shared privacy predicate. `track()` takes a closed union with no song or
  // artist name in it, so there was never anything here to protect.
  it.each([
    '/find-music',
    '/find-music/recommendations',
    '/apple-music-connect',
  ])('renders Google Analytics on a taste-data route: %s', pathname => {
    mockPathname = pathname;
    render(<RegionAwareAnalytics gaId="test-id" />);

    expect(screen.getByTestId('google-analytics')).toHaveTextContent('test-id');
  });

  it.each(['', 'gaRegion=eea'])(
    'renders nothing when the region cookie is %p',
    cookie => {
      document.cookie = 'gaRegion=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      if (cookie) document.cookie = cookie;
      mockPathname = '/find-music';
      render(<RegionAwareAnalytics gaId="test-id" />);

      expect(screen.queryByTestId('google-analytics')).not.toBeInTheDocument();
    },
  );

  it('keeps Google Analytics on an eligible ordinary route', () => {
    mockPathname = '/chart-editor';
    render(<RegionAwareAnalytics gaId="test-id" />);

    expect(screen.getByTestId('google-analytics')).toHaveTextContent('test-id');
  });
});
