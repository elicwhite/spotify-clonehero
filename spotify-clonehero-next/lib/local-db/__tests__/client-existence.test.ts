/** @jest-environment jsdom */

jest.mock('sqlocal/kysely', () => ({SQLocalKysely: jest.fn()}));

import {LOCAL_DB_PATH, localDbExists} from '../client';

const {SQLocalKysely} = jest.requireMock('sqlocal/kysely') as {
  SQLocalKysely: jest.Mock;
};

describe('localDbExists', () => {
  const getFileHandle = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        getDirectory: jest.fn(async () => ({getFileHandle})),
      },
    });
  });

  it('finds the existing OPFS file without constructing SQLocal', async () => {
    getFileHandle.mockResolvedValue({kind: 'file'});

    await expect(localDbExists()).resolves.toBe(true);
    expect(getFileHandle).toHaveBeenCalledWith(LOCAL_DB_PATH);
    expect(SQLocalKysely).not.toHaveBeenCalled();
  });

  it('reports a missing file without creating it', async () => {
    getFileHandle.mockRejectedValue(
      new DOMException('File does not exist', 'NotFoundError'),
    );

    await expect(localDbExists()).resolves.toBe(false);
    expect(getFileHandle).toHaveBeenCalledWith(LOCAL_DB_PATH);
    expect(SQLocalKysely).not.toHaveBeenCalled();
  });
});
