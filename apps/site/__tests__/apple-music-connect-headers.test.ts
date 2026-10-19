type HeaderRule = {
  source: string;
  headers: Array<{key: string; value: string}>;
};

function loadHeaders(): Promise<HeaderRule[]> {
  const previous = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = 'development';
  try {
    jest.resetModules();
    const config = require('../next.config.js');
    return config.headers();
  } finally {
    (process.env as any).NODE_ENV = previous;
  }
}

describe('Apple Music connector response headers', () => {
  it('overrides cross-origin isolation only for the exact connector route', async () => {
    const headers = await loadHeaders();
    const globalRuleIndex = headers.findIndex(
      rule => rule.source === '/:path*',
    );
    const connectorRuleIndex = headers.findIndex(
      rule => rule.source === '/apple-music-connect',
    );

    expect(connectorRuleIndex).toBeGreaterThan(globalRuleIndex);
    expect(headers[connectorRuleIndex]).toEqual({
      source: '/apple-music-connect',
      headers: [
        {key: 'Cross-Origin-Embedder-Policy', value: 'unsafe-none'},
        {
          key: 'Cross-Origin-Opener-Policy',
          value: 'same-origin-allow-popups',
        },
      ],
    });
  });
});
