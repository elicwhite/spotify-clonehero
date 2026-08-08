jest.mock('../../local-db/spotify-history', () => ({
  hasSpotifyHistory: jest.fn(),
  upsertSpotifyHistory: jest.fn(),
}));
jest.mock('../../local-db/client', () => ({getLocalDb: jest.fn()}));
jest.mock('../../fileSystemHelpers', () => ({
  readJsonFile: jest.fn(),
  writeFile: jest.fn(),
}));

import {tryProcessSpotifyDump} from '../HistoryDumpParsing';

describe('Spotify history import', () => {
  it('returns an invalid selection instead of throwing for nested folders', async () => {
    const handle = {
      async *values() {
        yield {kind: 'directory', name: 'Spotify Extended Streaming History'};
      },
    } as unknown as FileSystemDirectoryHandle;

    await expect(tryProcessSpotifyDump(handle)).resolves.toEqual({
      status: 'invalid-selection',
      message:
        'Spotify History: Did not expect to see subfolders. Found folder Spotify Extended Streaming History. Are you sure you selected your Spotify Extended Streaming History?',
    });
  });
});
