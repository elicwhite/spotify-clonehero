jest.mock('../../local-db/spotify-history', () => ({
  hasSpotifyHistory: jest.fn(),
  upsertSpotifyHistory: jest.fn(),
}));
jest.mock('../../local-db/client', () => ({getLocalDb: jest.fn()}));
jest.mock('../../fileSystemHelpers', () => ({
  readJsonFile: jest.fn(),
  writeFile: jest.fn(),
}));

import {upsertSpotifyHistory} from '../../local-db/spotify-history';
import {getLocalDb} from '../../local-db/client';
import {readJsonFile, writeFile} from '../../fileSystemHelpers';
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

  it('captures timestamps, listen time, and skips alongside the play count', async () => {
    const entries = [
      {
        ts: '2024-03-02T00:00:00Z',
        ms_played: 210_000,
        reason_end: 'trackdone',
        master_metadata_album_artist_name: 'Artist',
        master_metadata_track_name: 'Song',
      },
      {
        ts: '2022-01-05T00:00:00Z',
        ms_played: 200_000,
        reason_end: 'trackdone',
        master_metadata_album_artist_name: 'Artist',
        master_metadata_track_name: 'Song',
      },
      {
        ts: '2026-05-05T00:00:00Z',
        ms_played: 4_000,
        reason_end: 'fwdbtn',
        master_metadata_album_artist_name: 'Artist',
        master_metadata_track_name: 'Song',
      },
    ];
    (readJsonFile as jest.Mock).mockResolvedValue(entries);
    (writeFile as jest.Mock).mockResolvedValue(undefined);
    (getLocalDb as jest.Mock).mockResolvedValue({
      transaction: () => ({
        execute: (run: (trx: unknown) => Promise<void>) => run({}),
      }),
    });
    (globalThis as unknown as {navigator: {storage: unknown}}).navigator = {
      storage: {
        getDirectory: async () => ({
          getFileHandle: async () => ({}),
        }),
      },
    } as never;

    const handle = {
      async *values() {
        yield {kind: 'file', name: 'ReadMeFirst_ExtendedStreamingHistory.pdf'};
        yield {kind: 'file', name: 'Streaming_History_Audio_2024.json'};
      },
    } as unknown as FileSystemDirectoryHandle;

    const result = await tryProcessSpotifyDump(handle);
    expect(result.status).toBe('imported');

    const stats = (upsertSpotifyHistory as jest.Mock).mock.calls.at(-1)?.[2];
    expect(stats.get('Artist').get('Song')).toEqual({
      // A skipped play still contributes its timestamp and listen time
      firstPlayedAt: '2022-01-05T00:00:00Z',
      lastPlayedAt: '2026-05-05T00:00:00Z',
      totalMsPlayed: 414_000,
      skipCount: 1,
    });
    // ...but only finished plays are counted as plays
    expect(
      (upsertSpotifyHistory as jest.Mock).mock.calls.at(-1)?.[1].get('Artist'),
    ).toEqual(new Map([['Song', 2]]));
  });
});
