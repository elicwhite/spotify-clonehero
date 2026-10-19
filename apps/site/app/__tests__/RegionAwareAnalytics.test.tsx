/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {render, screen} from '@testing-library/react';
import RegionAwareAnalytics from '../RegionAwareAnalytics';

jest.mock('@next/third-parties/google', () => ({
  GoogleAnalytics: ({gaId}: {gaId: string}) => (
    <div data-testid="google-analytics">{gaId}</div>
  ),
}));

describe('RegionAwareAnalytics', () => {
  beforeEach(() => {
    document.cookie = 'gaRegion=other';
  });

  // The cookie is the whole decision: no route is excluded, Find Music
  // included. `track()` takes a closed union with no song, artist or
  // playlist name in any member, so there is nothing on those pages to
  // protect by withholding analytics.
  it('renders Google Analytics when the cookie says the visitor may be processed', () => {
    render(<RegionAwareAnalytics gaId="test-id" />);

    expect(screen.getByTestId('google-analytics')).toHaveTextContent('test-id');
  });

  it.each(['', 'gaRegion=eea'])(
    'renders nothing when the region cookie is %p',
    cookie => {
      document.cookie = 'gaRegion=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      if (cookie) document.cookie = cookie;
      render(<RegionAwareAnalytics gaId="test-id" />);

      expect(screen.queryByTestId('google-analytics')).not.toBeInTheDocument();
    },
  );
});
