const addIntegration = jest.fn();
const replayIntegration = jest.fn(() => ({name: 'Replay'}));

jest.mock('@sentry/nextjs', () => ({
  addIntegration: (...args: unknown[]) => addIntegration(...args),
  replayIntegration: () => replayIntegration(),
}));

/**
 * The bug this guards: `TasteDataPrivacyBoundary` used a falsy `Sentry.getReplay()`
 * to mean "Replay was never registered". `getReplay()` is
 * `getClient()?.getIntegrationByName('Replay')`, so it is also falsy whenever no
 * client is available at that moment — and `replayIntegration()` throws
 * "Multiple Sentry Session Replay instances are not supported" on a second call.
 * Loading the home page hit exactly that.
 */
describe('replay registration', () => {
  beforeEach(() => {
    jest.resetModules();
    delete (globalThis as {__musicChartsReplayRegistered?: boolean})
      .__musicChartsReplayRegistered;
    addIntegration.mockClear();
    replayIntegration.mockClear();
  });

  it('registers Replay once when init did not', async () => {
    const {ensureReplayRegistered} = await import('../replay');

    ensureReplayRegistered();
    ensureReplayRegistered();
    ensureReplayRegistered();

    expect(replayIntegration).toHaveBeenCalledTimes(1);
    expect(addIntegration).toHaveBeenCalledTimes(1);
  });

  // Registering twice must never break the page; that crash is why this exists.
  it('survives a double registration instead of throwing', async () => {
    jest.resetModules();
    replayIntegration.mockImplementationOnce(() => {
      throw new Error(
        'Multiple Sentry Session Replay instances are not supported',
      );
    });
    const {ensureReplayRegistered} = await import('../replay');

    expect(() => ensureReplayRegistered()).not.toThrow();
  });

  it('does not register again when init already did', async () => {
    const {markReplayRegistered, ensureReplayRegistered} = await import(
      '../replay'
    );

    markReplayRegistered();
    ensureReplayRegistered();

    expect(replayIntegration).not.toHaveBeenCalled();
    expect(addIntegration).not.toHaveBeenCalled();
  });
});
