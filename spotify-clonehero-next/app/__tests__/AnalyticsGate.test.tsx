/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {render, screen} from '@testing-library/react';
import {analyticsEnabled} from '../../lib/analytics/environment';
import AnalyticsGate from '../AnalyticsGate';

jest.mock('@next/third-parties/google', () => ({
  GoogleAnalytics: ({gaId}: {gaId: string}) => (
    <div data-testid="google-analytics">{gaId}</div>
  ),
}));

// jsdom will not let a test redefine `window.location`, and it serves every
// page from localhost — the exact case the gate stops. So the decision is
// mocked here and the rule behind it is tested for real in
// `lib/analytics/__tests__/environment.test.ts`.
jest.mock('../../lib/analytics/environment', () => ({
  analyticsEnabled: jest.fn(),
}));

const analyticsEnabledMock = analyticsEnabled as jest.MockedFunction<
  typeof analyticsEnabled
>;

describe('AnalyticsGate', () => {
  beforeEach(() => {
    document.cookie = 'gaRegion=other';
    analyticsEnabledMock.mockReset();
  });

  it('renders nothing when the environment does not report', () => {
    analyticsEnabledMock.mockReturnValue(false);

    render(<AnalyticsGate gaId="test-id" />);

    expect(screen.queryByTestId('google-analytics')).not.toBeInTheDocument();
  });

  it('asks about this page, not about the build alone', () => {
    analyticsEnabledMock.mockReturnValue(true);

    render(<AnalyticsGate gaId="test-id" />);

    expect(analyticsEnabledMock).toHaveBeenCalledWith(
      process.env['NEXT_PUBLIC_VERCEL_ENV'],
      window.location.hostname,
    );
  });

  it('hands a reporting environment to the region check', () => {
    analyticsEnabledMock.mockReturnValue(true);

    render(<AnalyticsGate gaId="test-id" />);

    expect(screen.getByTestId('google-analytics')).toHaveTextContent('test-id');
  });

  // The gate is not a second region check: a visitor the cookie excludes gets
  // no analytics from a reporting environment either.
  it('renders nothing when the region cookie excludes the visitor', () => {
    analyticsEnabledMock.mockReturnValue(true);
    document.cookie = 'gaRegion=eea';

    render(<AnalyticsGate gaId="test-id" />);

    expect(screen.queryByTestId('google-analytics')).not.toBeInTheDocument();
  });
});
