jest.mock('../../local-db/spotify-history', () => ({
  upsertSpotifyHistory: jest.fn(),
}));
jest.mock('../../local-db/client', () => ({getLocalDb: jest.fn()}));

import {upsertSpotifyHistory} from '../../local-db/spotify-history';
import {getLocalDb} from '../../local-db/client';
import type {FolderSource} from '../../file-access/folderSource';
import {tryProcessSpotifyDump} from '../HistoryDumpParsing';

function folder(
  name: string,
  files: Array<{name: string; text?: string}>,
  subfolders: FolderSource[] = [],
): FolderSource {
  return {
    kind: 'folder',
    name,
    handle: null,
    list: async () => ({
      files: files.map(file => ({
        kind: 'file' as const,
        name: file.name,
        file: async () => ({text: async () => file.text ?? ''}) as File,
      })),
      subfolders,
    }),
  };
}

describe('Spotify history import', () => {
  it('returns an invalid selection instead of throwing for nested folders', async () => {
    const download = folder(
      'my_spotify_data',
      [],
      [folder('Spotify Extended Streaming History', [])],
    );

    await expect(tryProcessSpotifyDump(download)).resolves.toEqual({
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
    (getLocalDb as jest.Mock).mockResolvedValue({
      transaction: () => ({
        execute: (run: (trx: unknown) => Promise<void>) => run({}),
      }),
    });

    const history = folder('Spotify Extended Streaming History', [
      {name: 'ReadMeFirst_ExtendedStreamingHistory.pdf'},
      {
        name: 'Streaming_History_Audio_2024.json',
        text: JSON.stringify(entries),
      },
    ]);

    const result = await tryProcessSpotifyDump(history);
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
