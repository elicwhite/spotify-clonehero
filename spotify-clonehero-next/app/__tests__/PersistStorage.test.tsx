/**
 * @jest-environment jsdom
 */

import {render} from '@testing-library/react';
import PersistStorage from '../PersistStorage';

const collectEarnedPersistence = jest.fn(async () => false);
const attachStorageContext = jest.fn(async () => undefined);

jest.mock('../../lib/browser-storage', () => ({
  collectEarnedPersistence: () => collectEarnedPersistence(),
}));

jest.mock('../../lib/sentry/storage-context', () => ({
  attachStorageContext: () => attachStorageContext(),
}));

/** Lets the effect's promise chain settle before asserting on it. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('PersistStorage', () => {
  beforeEach(() => {
    collectEarnedPersistence.mockClear();
    attachStorageContext.mockClear();
  });

  it('re-reports the storage state after newly winning persistence', async () => {
    collectEarnedPersistence.mockResolvedValueOnce(true);

    render(<PersistStorage />);
    await settle();

    expect(attachStorageContext).toHaveBeenCalledTimes(1);
  });

  it('does not re-report when there was nothing to collect', async () => {
    // The common case by far: an origin that is already persistent, or a
    // browser that will not be asked. `instrumentation-client` has already
    // read the quota this load, and estimate() is slowest on exactly the
    // large origins this feature is for, so a second read here would cost
    // those users on every load and write back what is already there.
    collectEarnedPersistence.mockResolvedValueOnce(false);

    render(<PersistStorage />);
    await settle();

    expect(attachStorageContext).not.toHaveBeenCalled();
  });

  it('renders nothing', () => {
    const {container} = render(<PersistStorage />);

    expect(container).toBeEmptyDOMElement();
  });
});
