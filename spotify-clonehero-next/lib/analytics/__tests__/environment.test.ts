import {analyticsEnabled, isLocalHostname} from '@/lib/analytics/environment';

describe('analyticsEnabled', () => {
  it.each(['production', 'preview'] as const)(
    'reports from the Vercel %s environment',
    environment => {
      expect(analyticsEnabled(environment, 'musiccharts.tools')).toBe(true);
    },
  );

  // The preview host is indexed and carries real users, so it is not a
  // staging environment to be filtered out.
  it('reports from the preview host', () => {
    expect(analyticsEnabled('preview', 'cloneherocharts.vercel.app')).toBe(
      true,
    );
  });

  it.each(['development', 'staging'])(
    'stays silent in the %p environment, whatever the hostname',
    environment => {
      expect(analyticsEnabled(environment, 'musiccharts.tools')).toBe(false);
    },
  );

  // `pnpm dev` sets no Vercel environment at all. This is the case that was
  // sending 38% of the property's pageviews.
  it.each(['localhost', '127.0.0.1', '::1', 'app.localhost'])(
    'stays silent on %p with no environment set',
    hostname => {
      expect(analyticsEnabled(undefined, hostname)).toBe(false);
    },
  );

  // An empty string is what a missing Vercel variable looks like once a shell
  // has passed it along, and it must not read as "some other environment".
  it.each([undefined, ''])(
    'reports from a real host when the environment is %p',
    environment => {
      expect(analyticsEnabled(environment, 'musiccharts.tools')).toBe(true);
    },
  );
});

describe('isLocalHostname', () => {
  it.each([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    '[::1]',
    'ch.localhost',
  ])('treats %p as local', hostname => {
    expect(isLocalHostname(hostname)).toBe(true);
  });

  // A production hostname that merely contains the word must not match.
  it.each(['musiccharts.tools', 'cloneherocharts.vercel.app', 'localhost.dev'])(
    'treats %p as remote',
    hostname => {
      expect(isLocalHostname(hostname)).toBe(false);
    },
  );
});
