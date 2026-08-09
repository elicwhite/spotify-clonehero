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

  it.each(['/apple-music-connect///', '/find-music/recommendations'])(
    'does not render Google Analytics on a taste-data route: %s',
    pathname => {
      mockPathname = pathname;
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
