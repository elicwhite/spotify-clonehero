import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {ChartResponseEncore} from '../lib/chartSelection';
import {
  FilterFn,
  Row,
  RowData,
  SortingState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getExpandedRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {useVirtual} from 'react-virtual';
import {removeStyleTags} from '@/lib/ui-utils';
import Image from 'next/image';
import {downloadSong} from '@/lib/local-songs-folder';
import {useTrackPreviewUrl} from '@/lib/spotify-sdk/SpotifyFetching';
import {AudioContext} from './AudioProvider';
import {TableDownloadStates} from './SongsTable';
import {Button} from '@/components/ui/button';
import {Icons} from '@/components/icons';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {AiFillCaretDown} from 'react-icons/ai';

declare module '@tanstack/react-table' {
  interface TableMeta<TData extends RowData> {
    setDownloadState(index: number, state: TableDownloadStates): void;
  }
}

export type SpotifyPlaysRecommendations = {
  artist: string;
  song: string;
  playCount?: number;
  previewUrl?: string | null;
  matchingCharts: ChartResponseEncore[];
};

type RowType = {
  id: number;
  artist: string;
  song: string;
  playCount?: number;
  numCharts: number;
  charter: string;
  instruments: {[instrument: string]: number};
  download: {
    artist: string;
    song: string;
    charter: string;
    file: string;
    state: TableDownloadStates;
  };
  previewUrl?: string | null;
  subRows: RowType[];
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
  addMeta: any,
) => {
  if (row.subRows.length > 0) {
    const subRowsIncluded = row.subRows.some(subRow => {
      return instrumentFilter(subRow, columnId, value, addMeta);
    });

    return subRowsIncluded;
  }

  const songInstruments = Object.keys(row.getValue(columnId));
  const allInstrumentsIncluded = value.every(instrument =>
    songInstruments.includes(instrument),
  );

  return allInstrumentsIncluded;
};

const columnHelper = createColumnHelper<RowType>();

const columns = [
  columnHelper.accessor('artist', {
    header: 'Artist',
    minSize: 250,
    cell: props => {
      const icon = props.row.getIsExpanded() ? (
        <AiFillCaretDown />
      ) : (
        <AiFillCaretDown
          className={`opacity-0 ${
            props.row.getParentRow() != null ? 'pr-10' : ''
          }`}
        />
      );

      return (
        <>
          {icon} {props.getValue()}
        </>
      );
    },
  }),
  columnHelper.accessor('song', {
    header: 'Song',
    minSize: 250,
    cell: props => {
      return props.getValue();
    },
  }),
  columnHelper.accessor('playCount', {
    header: '# Plays',
    minSize: 250,
    cell: props => {
      return props.getValue();
    },
  }),
  columnHelper.accessor('charter', {
    header: 'Charter',
    minSize: 200,
    cell: props => {
      if (props.row.getIsExpanded()) {
        return null;
      }

      return removeStyleTags(props.getValue() || '');
    },
  }),
  columnHelper.accessor('instruments', {
    header: 'Instruments',
    minSize: 300,
    cell: props => {
      if (props.row.getIsExpanded()) {
        return null;
      }

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
      if (props.row.getIsExpanded()) {
        return null;
      }

      const {artist, song, charter, file, state} = props.getValue();
      const updateDownloadState = props.table.options.meta?.setDownloadState;
      function update(state: TableDownloadStates) {
        if (updateDownloadState != null) {
          updateDownloadState(props.row.index, state);
        }
      }
      return (
        <DownloadButton
          artist={artist}
          song={song}
          charter={charter}
          url={file}
          state={state}
          updateDownloadState={update}
        />
      );
    },
  }),
  columnHelper.accessor('previewUrl', {
    header: 'Preview',
    minSize: 100,
    cell: props => {
      if (props.row.getIsExpanded()) {
        return null;
      }

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
          <Button onClick={handler}>
            <Icons.spotify className="h-4 w-4 mr-2" />
            Play
          </Button>
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
      <Button onClick={handler}>
        <Icons.spotify className="h-4 w-4 mr-2" />
        {thisTrackPlaying ? 'Stop' : 'Play'}
      </Button>
    </>
  );
}

export default function SpotifyTableDownloader({
  tracks,
  showPreview,
}: {
  tracks: SpotifyPlaysRecommendations[];
  showPreview: boolean;
}) {
  const hasPlayCount = tracks[0].playCount != null;

  const [downloadState, setDownloadState] = useState<{
    [key: number]: TableDownloadStates;
  }>(new Array(tracks.length).fill('not-downloading'));

  const trackState = useMemo(
    () =>
      tracks.map(
        (track, index): RowType => ({
          id: index,
          artist: track.artist,
          song: track.song,
          ...(hasPlayCount ? {playCount: track.playCount} : {}),
          numCharts: track.matchingCharts.length,
          charter: track.matchingCharts[0].charter,
          instruments: Object.keys(track.matchingCharts[0])
            .filter(
              key =>
                key.startsWith('diff_') &&
                (track.matchingCharts[0][
                  key as keyof ChartResponseEncore
                ] as number) >= 0,
            )
            .map(key => ({
              [key.replace('diff_', '')]: track.matchingCharts[0][
                key as keyof ChartResponseEncore
              ] as number,
            }))
            .reduce((a, b) => ({...a, ...b}), {}),
          download: {
            artist: track.artist,
            song: track.song,
            charter: track.matchingCharts[0].charter,
            file: track.matchingCharts[0].file,
            state: downloadState[index],
          },
          previewUrl: track.previewUrl,
          subRows:
            track.matchingCharts.length == 1
              ? []
              : track.matchingCharts.map((chart, subIndex) => ({
                  id: index,
                  artist: track.artist,
                  song: track.song,
                  ...(hasPlayCount ? {playCount: track.playCount} : {}),
                  charter: chart.charter,
                  numCharts: 1,
                  subRows: [],
                  instruments: Object.keys(chart)
                    .filter(
                      key =>
                        key.startsWith('diff_') &&
                        (chart[key as keyof ChartResponseEncore] as number) >=
                          0,
                    )
                    .map(key => ({
                      [key.replace('diff_', '')]: chart[
                        key as keyof ChartResponseEncore
                      ] as number,
                    }))
                    .reduce((a, b) => ({...a, ...b}), {}),
                  download: {
                    artist: track.artist,
                    song: track.song,
                    charter: chart.charter,
                    file: chart.file,
                    state: downloadState[index],
                  },
                  previewUrl: track.previewUrl,
                })),
        }),
      ),
    [tracks, hasPlayCount, downloadState],
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
        previewUrl: showPreview,
      },
      columnFilters,
      expanded: true,
    },
    meta: {
      setDownloadState(index: number, state: TableDownloadStates) {
        setDownloadState(prev => {
          return {...prev, [index]: state};
        });
      },
    },
    enableExpanding: true,
    enableMultiSort: true,
    getIsRowExpanded: (row: Row<RowType>) => row.original.numCharts > 1,
    onSortingChange: setSorting,
    getSubRows: row => row.subRows,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
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
        className="bg-card text-card-foreground rounded-lg ring-1 ring-slate-900/5 shadow-xl overflow-y-auto ph-8"
        ref={tableContainerRef}>
        <Table>
          <TableHeader className="sticky top-0">
            {table.getHeaderGroups().map(headerGroup => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map(header => {
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      className="bg-card py-0"
                      style={{
                        textAlign: (header.column.columnDef.meta as any)?.align,
                        width: header.getSize(),
                      }}>
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {paddingTop > 0 && (
              <TableRow>
                <TableCell style={{height: `${paddingTop}px`}}></TableCell>
              </TableRow>
            )}
            {virtualRows.map(virtualRow => {
              const row = rows[virtualRow.index] as Row<RowType>;
              return (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map(cell => {
                    return (
                      <TableCell
                        className={row.getIsExpanded() ? 'py-2' : ''}
                        key={cell.id}
                        style={{
                          textAlign: (cell.column.columnDef.meta as any)?.align,
                        }}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
            {paddingBottom > 0 && (
              <TableRow>
                <TableCell style={{height: `${paddingBottom}px`}} />
              </TableRow>
            )}
          </TableBody>
        </Table>
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
  state,
  updateDownloadState,
}: {
  artist: string;
  song: string;
  charter: string;
  url: string;
  state: TableDownloadStates;
  updateDownloadState: (state: TableDownloadStates) => void;
}) {
  const handler = useCallback(async () => {
    if (state != 'not-downloading') {
      return;
    }

    try {
      updateDownloadState('downloading');
      await downloadSong(artist, song, charter, url);
    } catch {
      console.log('Error while downloading', artist, song, charter, url);
      updateDownloadState('failed');
      return;
    }

    updateDownloadState('downloaded');
  }, [state, updateDownloadState, artist, song, charter, url]);

  switch (state) {
    case 'downloaded':
      return <span>Downloaded</span>;
    case 'downloading':
      return <span>Downloading...</span>;
    case 'failed':
      return <span>Failed</span>;
    case 'not-downloading':
      return <Button onClick={handler}>Download</Button>;
  }
}
