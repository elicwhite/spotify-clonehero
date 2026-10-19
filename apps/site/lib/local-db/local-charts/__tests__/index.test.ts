const mockExistingRows = jest.fn();
const mockDeleteExecute = jest.fn(async () => undefined);
const mockInsertExecute = jest.fn(async () => undefined);

const transaction = {
  selectFrom: jest.fn(() => ({
    select: jest.fn(() => ({execute: () => mockExistingRows()})),
  })),
  insertInto: jest.fn(() => ({
    values: jest.fn(() => ({
      onConflict: jest.fn(() => ({execute: mockInsertExecute})),
    })),
  })),
  deleteFrom: jest.fn(() => ({
    where: jest.fn(() => ({execute: mockDeleteExecute})),
  })),
};

jest.mock('../../client', () => ({
  getLocalDb: jest.fn(async () => ({
    transaction: jest.fn(() => ({
      execute: (callback: (trx: typeof transaction) => Promise<void>) =>
        callback(transaction),
    })),
  })),
}));

import {upsertLocalCharts} from '../index';
import type {SongAccumulator} from '@/lib/local-songs-folder/scanLocalCharts';

const chart = {
  artist: 'New Artist',
  song: 'New Song',
  charter: 'Charter',
  modifiedTime: '2026-08-08T00:00:00.000Z',
  genre: '',
  data: {name: 'New Song', artist: 'New Artist', charter: 'Charter'},
} as SongAccumulator;

describe('upsertLocalCharts pruning policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExistingRows.mockResolvedValue([
      {
        id: 42,
        artist: 'Existing Artist',
        song: 'Existing Song',
        charter: 'Charter',
        modified_time: '2025-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('preserves missing rows after an incomplete scan', async () => {
    await upsertLocalCharts([chart], {pruneMissing: false});

    expect(mockInsertExecute).toHaveBeenCalled();
    expect(transaction.deleteFrom).not.toHaveBeenCalled();
  });

  it('prunes missing rows after a complete scan, including an empty scan', async () => {
    await upsertLocalCharts([], {pruneMissing: true});

    expect(transaction.deleteFrom).toHaveBeenCalledWith('local_charts');
    expect(mockDeleteExecute).toHaveBeenCalled();
  });
});
