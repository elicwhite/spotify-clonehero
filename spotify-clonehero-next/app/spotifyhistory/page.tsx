'use client';

import scanLocalCharts, {
  SongAccumulator,
  createIsInstalledFilter,
} from '@/lib/local-songs-folder/scanLocalCharts';
import {useCallback, useMemo, useRef, useState} from 'react';
import chorusChartDb, {findMatchingCharts} from '@/lib/chorusChartDb';
import {ChartResponse, selectChart} from '../chartSelection';
import {
  Row,
  SortingState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {useVirtual} from 'react-virtual';
import {removeStyleTags} from '@/lib/ui-utils';
import {
  getCachedInstalledCharts,
  getInstalledCharts,
  getSongsDirectoryHandle,
  scanForInstalledCharts,
  setSongsDirectoryHandle,
} from '@/lib/local-songs-folder';

type SpotifyPlaysRecommendations = {
  artist: string;
  song: string;
  playCount: number;
  recommendedChart: ChartResponse;
};

type Falsy = false | 0 | '' | null | undefined;
const _Boolean = <T extends any>(v: T): v is Exclude<typeof v, Falsy> =>
  Boolean(v);

export default function Page() {
  const [songs, setSongs] = useState<SpotifyPlaysRecommendations[] | null>(
    null,
  );
  const handler = useCallback(async () => {
    let spotifyDataHandle;

    try {
      spotifyDataHandle = await window.showDirectoryPicker({
        id: 'spotify-dump',
      });
    } catch {
      console.log('User canceled picker');
      return;
    }

    let installedSongs: SongAccumulator[] | undefined =
      await getCachedInstalledCharts();

    if (installedSongs == null) {
      alert('Now select your Clone Hero songs directory');

      try {
        installedSongs = await scanForInstalledCharts();
      } catch {
        console.log('User canceled picker');
        return;
      }
    }

    const results = await getAllSpotifyPlays(spotifyDataHandle);
    const artistTrackPlays = createPlaysMapOfSpotifyData(results);

    const isInstalled = await createIsInstalledFilter(installedSongs);
    const notInstalledSongs = filterInstalledSongs(
      artistTrackPlays,
      isInstalled,
    );
    const allChorusCharts = await chorusChartDb();

    const recommendedCharts = notInstalledSongs
      .map(([artist, song, playCount]) => {
        const matchingCharts = findMatchingCharts(
          artist,
          song,
          allChorusCharts,
        );

        const recommendedChart: ChartResponse | undefined = selectChart(
          matchingCharts
            .filter(chart => chart.diff_drums_real > 0 || chart.diff_drums > 0)
            .map(chart => ({
              ...chart,
              uploadedAt: chart.modifiedTime,
              lastModified: chart.modifiedTime,
              file: `https://files.enchor.us/${chart.md5}.sng`,
            })),
        );

        if (recommendedChart == null) {
          return null;
        }

        return {
          artist,
          song,
          playCount,
          recommendedChart,
        };
      })
      .filter(_Boolean);

    if (recommendedCharts.length > 0) {
      setSongs(recommendedCharts);
      console.log(recommendedCharts);
    }
  }, []);

  return (
    <main className="flex max-h-screen flex-col items-center justify-between p-24">
      <button
        className="bg-blue-500 text-white px-4 py-2 rounded-md transition-all ease-in-out duration-300 hover:bg-blue-600 dark:bg-blue-400 dark:hover:bg-blue-500"
        onClick={handler}>
        Scan Spotify Dump
      </button>

      {songs && <Table tracks={songs} />}
    </main>
  );
}

function filterInstalledSongs(
  spotifySongs: Map<string, Map<string, number>>,
  isInstalled: (artist: string, song: string) => boolean,
): [artist: string, song: string, playCount: number][] {
  const filtered: Map<string, Map<string, number>> = new Map();

  for (const [artist, songs] of spotifySongs.entries()) {
    for (const [song, playCount] of songs.entries()) {
      if (!isInstalled(artist, song)) {
        if (filtered.get(artist) == null) {
          filtered.set(artist, new Map());
        }

        filtered.get(artist)!.set(song, playCount);
      }
    }
  }

  const artistsSortedByListens = [...filtered.entries()]
    .toSorted((a, b) => {
      const aTotal = [...a[1].values()].reduce((a, b) => a + b, 0);
      const bTotal = [...b[1].values()].reduce((a, b) => a + b, 0);

      return bTotal - aTotal;
    })
    .map(([artist]) => artist);

  console.log('artists', artistsSortedByListens.length);

  const results: [artist: string, song: string, playCount: number][] = [];

  for (const [artist, songs] of spotifySongs.entries()) {
    for (const [song, playCount] of songs.entries()) {
      if (!isInstalled(artist, song)) {
        results.push([artist, song, playCount]);
      }
    }
  }

  results.sort((a, b) => {
    return b[2] - a[2];
  });

  return results;
}

async function getAllSpotifyPlays(handle: FileSystemDirectoryHandle) {
  let hasPdf = false;
  const results = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file') {
      throw new Error('Select the folder with your Spotify streaming history.');
    }

    if (entry.name.endsWith('.pdf') && entry.name.startsWith('ReadMeFirst')) {
      hasPdf = true;
      continue;
    }

    if (!entry.name.endsWith('.json')) {
      throw new Error('Select the folder with your Spotify streaming history.');
    }

    const file = await entry.getFile();
    const text = await file.text();
    const json = JSON.parse(text);

    json;
    results.push(...json);
  }

  if (!hasPdf) {
    throw new Error('Select the folder with your Spotify streaming history.');
  }

  return results;
}

type SpotifyHistoryEntry = {
  reason_end: 'fwdbtn' | 'trackdone' | 'backbtn' | 'clickrow'; // There are other options, but it doesn't matter
  master_metadata_album_artist_name: string;
  master_metadata_track_name: string;
};

function createPlaysMapOfSpotifyData(history: SpotifyHistoryEntry[]) {
  const artistsTracks = new Map<string, Map<string, number>>();

  for (const song of history) {
    if (song.reason_end != 'trackdone') {
      continue;
    }

    const artist = song.master_metadata_album_artist_name;
    if (artist == null) {
      // For some reason these don't have any information about what played
      continue;
    }
    const track = song.master_metadata_track_name;

    let tracksPlays = artistsTracks.get(artist);
    if (tracksPlays == null) {
      tracksPlays = new Map();
      artistsTracks.set(artist, tracksPlays);
    }
    tracksPlays.set(track, (tracksPlays.get(track) ?? 0) + 1);
  }

  return artistsTracks;
}

type RowType = {
  id: number;
  artist: string;
  song: string;
  playCount: number;
  charter: string;
  instruments: string;
};

const columnHelper = createColumnHelper<RowType>();

function Table({tracks}: {tracks: SpotifyPlaysRecommendations[]}) {
  const columns = useMemo(
    () => [
      {
        accessorKey: 'artist',
        header: 'Artist',
        minSize: 250,
      },
      {
        accessorKey: 'song',
        header: 'Song',
        minSize: 250,
      },
      {
        accessorKey: 'playCount',
        header: '# Plays',
        minSize: 250,
      },
      columnHelper.accessor('charter', {
        header: 'Charter',
        minSize: 200,
        cell: props => {
          return removeStyleTags(props.getValue() || '');
        },
      }),
      {
        accessorKey: 'instruments',
        header: 'Instruments',
        minSize: 250,
      },
    ],
    [],
  );

  const trackState = useMemo(
    () =>
      tracks.map((track, index) => ({
        id: index + 1,
        artist: track.artist,
        song: track.song,
        playCount: track.playCount,
        charter: track.recommendedChart.charter,
        instruments: JSON.stringify(
          Object.keys(track.recommendedChart)
            .filter(
              key =>
                key.startsWith('diff_') &&
                (track.recommendedChart[
                  key as keyof ChartResponse
                ] as number) >= 0,
            )
            .map(key => ({
              [key.replace('diff_', '')]: track.recommendedChart[
                key as keyof ChartResponse
              ] as number,
            }))
            .reduce((a, b) => ({...a, ...b}), {}),
        ),
      })),
    [tracks],
  );

  const [sorting, setSorting] = useState<SortingState>([
    {id: 'playCount', desc: true},
    {id: 'artist', desc: false},
    {id: 'song', desc: false},
  ]);

  const table = useReactTable({
    data: trackState,
    columns,
    state: {
      sorting,
    },
    enableMultiSort: true,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    debugTable: false,
  });

  const tableContainerRef = useRef<HTMLDivElement>(null);

  const {rows} = table.getRowModel();
  const rowVirtualizer = useVirtual({
    parentRef: tableContainerRef,
    size: rows.length,
    overscan: 10,
  });
  const {virtualItems: virtualRows, totalSize} = rowVirtualizer;

  const paddingTop = virtualRows.length > 0 ? virtualRows?.[0]?.start || 0 : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - (virtualRows?.[virtualRows.length - 1]?.end || 0)
      : 0;

  return (
    <>
      <div
        className="bg-white dark:bg-slate-800 rounded-lg ring-1 ring-slate-900/5 shadow-xl overflow-y-auto ph-8"
        ref={tableContainerRef}>
        <table className="border-collapse table-auto w-full text-sm">
          <thead className="sticky top-0">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => {
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      className="bg-white dark:bg-slate-800 pt-8 font-medium p-4 pl-8 pt-0 pb-3 text-slate-400 dark:text-slate-200 text-left"
                      style={{
                        textAlign: (header.column.columnDef.meta as any)?.align,
                        width: header.getSize(),
                      }}>
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
            <tr>
              <th
                className="h-px bg-slate-100 dark:bg-slate-600 p-0"
                colSpan={5}></th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-slate-800">
            {paddingTop > 0 && (
              <tr>
                <td style={{height: `${paddingTop}px`}} />
              </tr>
            )}
            {virtualRows.map(virtualRow => {
              const row = rows[virtualRow.index] as Row<RowType>;
              return (
                <tr key={row.id}>
                  {row.getVisibleCells().map(cell => {
                    return (
                      <td
                        className="border-b border-slate-100 dark:border-slate-700 p-4 pl-8 text-slate-500 dark:text-slate-400"
                        key={cell.id}
                        style={{
                          textAlign: (cell.column.columnDef.meta as any)?.align,
                        }}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td style={{height: `${paddingBottom}px`}} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
