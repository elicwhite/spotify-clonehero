/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom';
import {render, screen} from '@testing-library/react';
import ContextProviders from '../ContextProviders';

let mockPathname = '/find-music';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('../AudioProvider', () => ({
  AudioProvider: ({children}: {children: React.ReactNode}) => (
    <div data-testid="audio-provider">{children}</div>
  ),
}));

jest.mock('nuqs/adapters/next/app', () => ({
  NuqsAdapter: ({children}: {children: React.ReactNode}) => <>{children}</>,
}));

jest.mock('../../lib/supabase/AuthProvider', () => ({
  AuthProvider: ({children}: {children: React.ReactNode}) => (
    <div data-testid="auth-provider">{children}</div>
  ),
}));

describe('ContextProviders', () => {
  it('bypasses AuthProvider on the Apple Music connector route', () => {
    mockPathname = '/apple-music-connect/';
    render(
      <ContextProviders>
        <div>Connector content</div>
      </ContextProviders>,
    );

    expect(screen.getByText('Connector content')).toBeInTheDocument();
    expect(screen.queryByTestId('auth-provider')).not.toBeInTheDocument();
  });

  it('keeps AuthProvider on ordinary routes', () => {
    mockPathname = '/find-music';
    render(
      <ContextProviders>
        <div>App content</div>
      </ContextProviders>,
    );

    expect(screen.getByTestId('auth-provider')).toHaveTextContent(
      'App content',
    );
  });
});
