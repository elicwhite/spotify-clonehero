import {getSentryEnvironment, isSentryEnabled} from '@/lib/sentry/environment';

describe('Sentry environment', () => {
  it.each(['production', 'preview'] as const)(
    'preserves the Vercel %s environment',
    environment => {
      expect(getSentryEnvironment(environment)).toBe(environment);
      expect(isSentryEnabled(environment)).toBe(true);
    },
  );

  it.each([undefined, 'development', 'staging', ''])(
    'treats %p as local development',
    environment => {
      expect(getSentryEnvironment(environment)).toBe('development');
    },
  );

  it('disables Sentry in development', () => {
    expect(isSentryEnabled('development')).toBe(false);
  });
});
