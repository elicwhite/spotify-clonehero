import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {ChartResponseEncore} from './chartSelection';
import {
  FilterFn,
  Row,
  SortingState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {useVirtual} from 'react-virtual';
import {removeStyleTags} from '@/lib/ui-utils';
import Image from 'next/image';
import {downloadSong} from '@/lib/local-songs-folder';
import {useTrackPreviewUrl} from '@/lib/spotify-sdk/SpotifyFetching';
import {AudioContext} from './AudioProvider';

export type SpotifyPlaysRecommendations = {
  artist: string;
  song: string;
  playCount?: number;
  previewUrl?: string | null;
  recommendedChart: ChartResponseEncore;
};

type RowType = {
  id: number;
  artist: string;
  song: string;
  playCount?: number;
  charter: string;
  instruments: {[instrument: string]: number};
  download: {
    artist: string;
    song: string;
    charter: string;
    file: string;
  };
  previewUrl?: string | null;
};

const RENDERED_INSTRUMENTS = [
  'bass',
  'bassghl',
  'drums',
  'guitar',
  'guitarghl',
  'keys',
  'rhythm',
  'rhythmghl',
  'vocals',
] as const;

type AllowedInstrument = (typeof RENDERED_INSTRUMENTS)[number];

function InstrumentImage({
  instrument,
  classNames,
  onClick,
}: {
  instrument: AllowedInstrument;
  classNames?: string;
  onClick?: (instrument: AllowedInstrument) => void;
}) {
  const clickCallback = useCallback(() => {
    if (onClick) {
      onClick(instrument);
    }
  }, [instrument, onClick]);
  return (
    <Image
      className={`inline-block mr-1 ${classNames}`}
      key={instrument}
      alt={`Icon for instrument ${instrument}`}
      src={`/assets/instruments/${instrument}.png`}
      width={32}
      height={32}
      onClick={clickCallback}
    />
  );
}

const instrumentFilter: FilterFn<RowType> = (
  row,
  columnId,
  value: AllowedInstrument[],
) => {
  const songInstruments = Object.keys(row.getValue(columnId));
  const allInstrumentsIncluded = value.every(instrument =>
    songInstruments.includes(instrument),
  );
  return allInstrumentsIncluded;
};

const columnHelper = createColumnHelper<RowType>();

const columns = [
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
  columnHelper.accessor('instruments', {
    header: 'Instruments',
    minSize: 300,
    cell: props => {
      return (
        <>
          {Object.keys(props.getValue())
            // @ts-ignore Don't know how to force TS to know
            .filter(instrument => RENDERED_INSTRUMENTS.includes(instrument))
            // @ts-ignore Don't know how to force TS to know
            .map((instrument: AllowedInstrument) => {
              return (
                <InstrumentImage instrument={instrument} key={instrument} />
              );
            })}
        </>
      );
    },
    filterFn: instrumentFilter,
  }),
  columnHelper.accessor('download', {
    header: 'Download',
    minSize: 100,
    cell: props => {
      const {artist, song, charter, file} = props.getValue();
      return (
        <DownloadButton
          artist={artist}
          song={song}
          charter={charter}
          url={file}
        />
      );
    },
  }),
  columnHelper.accessor('previewUrl', {
    header: 'Preview',
    minSize: 100,
    cell: props => {
      const {artist, song} = props.row.original;
      const url = props.getValue();

      if (url == null) {
        return <LookUpPreviewButton artist={artist} song={song} />;
      }

      return (
        <PreviewButton artist={artist} song={song} url={url} autoplay={false} />
      );
    },
  }),
];

function LookUpPreviewButton({artist, song}: {artist: string; song: string}) {
  const getTrackPreviewUrl = useTrackPreviewUrl(artist, song);
  const [url, setUrl] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const handler = useCallback(async () => {
    const url = await getTrackPreviewUrl();
    setUrl(url);
    setFetched(true);
  }, [getTrackPreviewUrl]);

  return (
    <>
      {url == null ? (
        fetched == true ? (
          'No Preview'
        ) : (
          <button
            className="bg-blue-500 text-blue-700 font-semibold text-white py-2 px-4 border border-blue-500 hover:border-transparent rounded"
            onClick={handler}>
            Play
          </button>
        )
      ) : (
        <PreviewButton artist={artist} song={song} url={url} autoplay={true} />
      )}
    </>
  );
}

function PreviewButton({
  artist,
  song,
  url,
  autoplay,
}: {
  artist: string;
  song: string;
  url: string;
  autoplay: boolean;
}) {
  const {isPlaying, currentTrack, playTrack, pause} = useContext(AudioContext);

  const thisTrackPlaying =
    isPlaying && currentTrack?.artist === artist && currentTrack?.song === song;
  useEffect(() => {
    if (autoplay) {
      playTrack(artist, song, url);
    }

    () => {
      pause();
    };
  }, [autoplay, artist, song, url, playTrack, pause]);

  const handler = useCallback(() => {
    if (thisTrackPlaying) {
      pause();
    } else {
      playTrack(artist, song, url);
    }
  }, [artist, thisTrackPlaying, pause, playTrack, song, url]);

  return (
    <>
      <button
        className="bg-blue-500 text-blue-700 font-semibold text-white py-2 px-4 border border-blue-500 hover:border-transparent rounded"
        onClick={handler}>
        {thisTrackPlaying ? 'Stop' : 'Play'}
      </button>
    </>
  );
}

export default function SpotifyTableDownloader({
  tracks,
}: {
  tracks: SpotifyPlaysRecommendations[];
}) {
  const hasPlayCount = tracks[0].playCount != null;
  const hasPreview = tracks[0].hasOwnProperty('previewUrl');

  const trackState = useMemo(
    () =>
      tracks.map((track, index) => ({
        id: index + 1,
        artist: track.artist,
        song: track.song,
        ...(hasPlayCount ? {playCount: track.playCount} : {}),
        charter: track.recommendedChart.charter,
        instruments: Object.keys(track.recommendedChart)
          .filter(
            key =>
              key.startsWith('diff_') &&
              (track.recommendedChart[
                key as keyof ChartResponseEncore
              ] as number) >= 0,
          )
          .map(key => ({
            [key.replace('diff_', '')]: track.recommendedChart[
              key as keyof ChartResponseEncore
            ] as number,
          }))
          .reduce((a, b) => ({...a, ...b}), {}),
        download: {
          artist: track.artist,
          song: track.song,
          charter: track.recommendedChart.charter,
          file: track.recommendedChart.file,
        },
        ...(hasPreview ? {previewUrl: track.previewUrl} : {}),
      })),
    [tracks, hasPlayCount, hasPreview],
  );

  const [sorting, setSorting] = useState<SortingState>([
    {id: 'playCount', desc: true},
    {id: 'artist', desc: false},
    {id: 'song', desc: false},
  ]);

  const [instrumentFilters, setInstrumentFilters] = useState<
    AllowedInstrument[]
  >([]);

  const columnFilters = useMemo(
    () => [
      {
        id: 'instruments',
        value: instrumentFilters,
      },
    ],
    [instrumentFilters],
  );

  const table = useReactTable({
    data: trackState,
    columns,
    state: {
      sorting,
      columnVisibility: {
        playCount: hasPlayCount,
      },
      columnFilters,
    },
    enableMultiSort: true,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
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

  const filtersChangedCallback = useCallback((filters: AllowedInstrument[]) => {
    setInstrumentFilters(filters);
  }, []);

  return (
    <>
      <div className="space-y-4 sm:space-y-0 sm:space-x-4 w-full text-start sm:text-end">
        <span>
          {instrumentFilters.length !== RENDERED_INSTRUMENTS.length &&
            `${table.getRowModel().rows.length} of `}
          {tracks.length} songs found
        </span>

        <div>
          Filters
          <div>
            <Filters filtersChanged={filtersChangedCallback} />
          </div>
        </div>
      </div>
      <div
        className="bg-white dark:bg-slate-800 rounded-lg ring-1 ring-slate-900/5 shadow-xl overflow-y-auto"
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
                colSpan={6}></th>
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

function Filters({
  filtersChanged,
}: {
  filtersChanged: (instrument: AllowedInstrument[]) => void;
}) {
  const [selectedFilters, setSelectedFilters] = useState<AllowedInstrument[]>(
    [],
  );

  useEffect(() => {
    filtersChanged(selectedFilters);
  }, [filtersChanged, selectedFilters]);

  const callback = useCallback((instrument: AllowedInstrument) => {
    setSelectedFilters(prev => {
      if (prev.includes(instrument)) {
        return prev.filter(i => i != instrument);
      } else {
        const newFilter = [...prev, instrument];
        // if (newFilter.length === RENDERED_INSTRUMENTS.length) {
        //   return [];
        // }
        return newFilter;
      }
    });
  }, []);

  return (
    <>
      {RENDERED_INSTRUMENTS.map((instrument: AllowedInstrument) => {
        return (
          <InstrumentImage
            instrument={instrument}
            key={instrument}
            classNames={
              selectedFilters.length === 0 ||
              selectedFilters.includes(instrument)
                ? 'opacity-100'
                : 'opacity-50'
            }
            onClick={callback}
          />
        );
      })}
    </>
  );
}

function DownloadButton({
  artist,
  song,
  charter,
  url,
}: {
  artist: string;
  song: string;
  charter: string;
  url: string;
}) {
  const [downloadState, setDownloadState] = useState<
    'downloaded' | 'downloading' | 'not-downloading' | 'failed'
  >('not-downloading');

  const handler = useCallback(async () => {
    if (downloadState != 'not-downloading') {
      return;
    }

    try {
      setDownloadState('downloading');
      await downloadSong(artist, song, charter, url);
    } catch {
      console.log('Error while downloading', artist, song, charter, url);
      setDownloadState('failed');
      return;
    }

    setDownloadState('downloaded');
  }, [artist, song, charter, url, downloadState]);

  switch (downloadState) {
    case 'downloaded':
      return <span>Downloaded</span>;
    case 'downloading':
      return <span>Downloading...</span>;
    case 'failed':
      return <span>Failed</span>;
    case 'not-downloading':
      return (
        <button
          className="bg-blue-500 text-blue-700 font-semibold text-white py-2 px-4 border border-blue-500 hover:border-transparent rounded"
          onClick={handler}>
          Download
        </button>
      );
  }
}
