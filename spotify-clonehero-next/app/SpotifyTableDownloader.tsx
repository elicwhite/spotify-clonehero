import {
  memo,
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
import {downloadSong} from '@/lib/local-songs-folder';
import {useTrackUrls} from '@/lib/spotify-sdk/SpotifyFetching';
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
import {
  AllowedInstrument,
  ChartInstruments,
  InstrumentImage,
  RENDERED_INSTRUMENTS,
  preFilterInstruments,
} from '@/components/ChartInstruments';
import {RxExternalLink} from 'react-icons/rx';
import {NotesData} from '@eliwhite/scan-chart';

declare module '@tanstack/react-table' {
  interface TableMeta<TData extends RowData> {
    setDownloadState(index: string, state: TableDownloadStates): void;
  }
}

export type SpotifyChartData = {
  isInstalled: boolean;
} & Omit<ChartResponseEncore, 'notesData'> & {notesData?: NotesData};

export type SpotifyPlaysRecommendations = {
  artist: string;
  song: string;
  playCount?: number;
  spotifyUrl?: string | null;
  previewUrl?: string | null;
  matchingCharts: SpotifyChartData[];
};

type SongRow = {
  id: number;
  artist: string;
  song: string;
  playCount?: number;
  spotifyUrl?: string | null;
  previewUrl?: string | null;
  modifiedTime: Date; // Most recent chart from this song
  subRows: ChartRow[];
};

type ChartRow = {
  id: number;
  artist: string;
  song: string;
  charter: string;
  instruments: {[instrument: string]: number};
  modifiedTime: Date;
  isInstalled: boolean;
  download: {
    artist: string;
    song: string;
    charter: string;
    file: string;
    md5: string;
    state: TableDownloadStates;
  };
};

type RowType = Partial<SongRow> & Partial<ChartRow>;

const ALWAYS_TRUE = () => true;

const DEFAULT_SORTING = [
  {id: 'playCount', desc: true},
  {id: 'artist', desc: false},
  {id: 'song', desc: false},
];

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

const downloadedFilter: FilterFn<RowType> = (
  row,
  columnId,
  enabled: boolean,
  addMeta: any,
) => {
  if (!enabled) {
    // If the filter isn't enabled, all rows should be included
    return true;
  }

  if (row.subRows.some(subRow => subRow.original.isInstalled)) {
    return false;
  }
  return true;
};

const columnHelper = createColumnHelper<RowType>();

const columns = [
  columnHelper.accessor('artist', {
    header: 'Artist',
    minSize: 250,
    enableMultiSort: true,
    sortingFn: 'alphanumeric',
    cell: props => {
      const icon = props.row.getIsExpanded() ? (
        <AiFillCaretDown className="inline" />
      ) : (
        <AiFillCaretDown
          className={`inline opacity-0 ${
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
    enableMultiSort: true,
    sortingFn: 'alphanumeric',
    cell: props => {
      return props.getValue();
    },
  }),
  columnHelper.accessor('playCount', {
    header: '# Plays',
    minSize: 250,
    enableMultiSort: true,
    cell: props => {
      return props.getValue();
    },
  }),
  columnHelper.accessor('charter', {
    header: 'Charter',
    minSize: 200,
    enableMultiSort: true,
    sortingFn: 'alphanumeric',
    cell: props => {
      if (props.row.getIsExpanded()) {
        return null;
      }

      const value = props.getValue(); // as ChartRow['charter'] | undefined;

      if (value == null) {
        return null;
      }

      return removeStyleTags(value || '');
    },
  }),
  columnHelper.accessor('instruments', {
    header: 'Instruments',
    minSize: 300,
    enableSorting: false,
    cell: props => {
      if (props.row.getIsExpanded()) {
        return null;
      }

      const value = props.getValue(); // as ChartRow['instruments'] | undefined;

      if (value == null) {
        return null;
      }

      return <ChartInstruments instruments={value} size="md" />;
    },
    filterFn: instrumentFilter,
  }),
  columnHelper.accessor('modifiedTime', {
    header: 'Last Updated',
    minSize: 100,
    enableSorting: true,
    cell: props => {
      if (props.row.getIsExpanded()) {
        return null;
      }

      const value = props.getValue();
      if (value == null) {
        return null;
      }

      return value.toLocaleDateString();
    },
  }),
  columnHelper.accessor('download', {
    header: 'Download',
    minSize: 100,
    enableSorting: false,
    cell: props => {
      if (props.row.getIsExpanded()) {
        return null;
      }

      if (props.row.original.isInstalled) {
        return <span>Downloaded</span>;
      }

      const value = props.getValue(); // as ChartRow['download'] | undefined;

      if (value == null) {
        return null;
      }

      const {artist, song, charter, file, state} = value;
      const updateDownloadState = props.table.options.meta?.setDownloadState;
      function update(state: TableDownloadStates) {
        if (updateDownloadState != null) {
          const key = props.row.original.download?.md5;
          if (key != null) {
            updateDownloadState(key, state);
          }
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
    filterFn: downloadedFilter,
  }),
  columnHelper.accessor('previewUrl', {
    header: 'Preview',
    minSize: 100,
    enableSorting: false,
    cell: props => {
      if (!props.row.getIsExpanded()) {
        return null;
      }

      const url = props.getValue();
      const spotifyUrl = props.row.original.spotifyUrl;

      const {artist, song} = props.row.original;

      if (artist == null || song == null) {
        return null;
      }

      if (url == null || spotifyUrl == null) {
        return <LookUpPreviewButton artist={artist} song={song} />;
      }

      return (
        <PreviewButton
          artist={artist}
          song={song}
          url={url}
          spotifyUrl={spotifyUrl}
          autoplay={false}
        />
      );
    },
  }),
];

function LookUpPreviewButton({artist, song}: {artist: string; song: string}) {
  const getTrackUrls = useTrackUrls(artist, song);
  const [urls, setUrls] =
    useState<Awaited<ReturnType<typeof getTrackUrls>>>(null);
  const [fetched, setFetched] = useState(false);

  const handler = useCallback(async () => {
    const urls = await getTrackUrls();
    setUrls(urls);
    setFetched(true);
  }, [getTrackUrls]);

  return (
    <>
      {urls?.previewUrl == null ? (
        fetched == true ? (
          <div className="flex gap-4 items-center">
            No Preview
            <a href={urls?.spotifyUrl} target="_blank">
              <Button variant="outline">
                <RxExternalLink className="inline" />
              </Button>
            </a>
          </div>
        ) : (
          <Button onClick={handler}>
            <Icons.spotify className="h-4 w-4 mr-2" />
            Play
          </Button>
        )
      ) : (
        <PreviewButton
          artist={artist}
          song={song}
          url={urls.previewUrl}
          spotifyUrl={urls.spotifyUrl}
          autoplay={true}
        />
      )}
    </>
  );
}

function PreviewButton({
  artist,
  song,
  url,
  spotifyUrl,
  autoplay,
}: {
  artist: string;
  song: string;
  url: string;
  spotifyUrl: string;
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
    <div className="flex gap-4">
      <Button onClick={handler}>
        <Icons.spotify className="h-4 w-4 mr-2" />
        {thisTrackPlaying ? 'Stop' : 'Play'}
      </Button>

      <a href={spotifyUrl} target="_blank">
        <Button variant="outline">
          <RxExternalLink className="inline" />
        </Button>
      </a>
    </div>
  );
}

export default function SpotifyTableDownloader({
  tracks,
  showPreview,
  showPlayCount,
}: {
  tracks: SpotifyPlaysRecommendations[];
  showPreview: boolean;
  showPlayCount?: boolean;
}) {
  const hasPlayCount = showPlayCount ?? tracks[0].playCount != null;

  const [downloadState, setDownloadState] = useState<{
    [key: string]: TableDownloadStates;
  }>({}); //new Array(tracks.length).fill('not-downloading'));

  const trackState = useMemo(
    () =>
      tracks.map(
        (track, index): SongRow => ({
          id: index,
          artist: track.artist,
          song: track.song,
          ...(hasPlayCount ? {playCount: track.playCount} : {}),
          spotifyUrl: track.spotifyUrl,
          previewUrl: track.previewUrl,
          modifiedTime: track.matchingCharts.reduce((maxDate, chart) => {
            const chartDate = new Date(chart.modifiedTime);
            if (chartDate > maxDate) {
              return chartDate;
            }
            return maxDate;
          }, new Date(track.matchingCharts[0].modifiedTime)),
          subRows: track.matchingCharts.map((chart, subIndex) => ({
            id: subIndex,
            artist: chart.artist,
            song: chart.name,
            charter: chart.charter,
            instruments: preFilterInstruments(chart),
            modifiedTime: new Date(chart.modifiedTime),
            isInstalled: chart.isInstalled,
            download: {
              artist: chart.artist,
              song: chart.name,
              charter: chart.charter,
              file: chart.file,
              md5: chart.md5,
              state: downloadState[chart.md5] ?? 'not-downloading',
            },
          })),
        }),
      ),
    [tracks, hasPlayCount, downloadState],
  );

  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);

  const [instrumentFilters, setInstrumentFilters] = useState<
    AllowedInstrument[]
  >([]);

  const [hideDownloadedFilter, setHideDownloadedFilter] = useState(false);

  const columnFilters = useMemo(
    () => [
      {
        id: 'instruments',
        value: instrumentFilters,
      },
      {
        id: 'download',
        value: hideDownloadedFilter,
      },
    ],
    [instrumentFilters, hideDownloadedFilter],
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
    initialState: {
      sorting: DEFAULT_SORTING,
    },
    meta: {
      setDownloadState(index: string, state: TableDownloadStates) {
        setDownloadState(prev => {
          return {...prev, [index]: state};
        });
      },
    },
    enableExpanding: true,
    enableMultiSort: true,
    isMultiSortEvent: ALWAYS_TRUE,
    getIsRowExpanded: (row: Row<RowType>) => row.original.subRows != null,
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

  const downloadedFilterChangedCallback = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setHideDownloadedFilter(e.target.checked);
    },
    [],
  );

  const numMatchingCharts = useMemo(
    () =>
      rows
        .map(
          row =>
            row.original.subRows?.filter(chart => !chart.isInstalled).length ||
            0,
        )
        .reduce((acc, num) => acc + num, 0),
    [rows],
  );

  return (
    <>
      <div className="space-y-4 sm:space-y-0 sm:space-x-4 w-full text-start sm:text-end">
        <span>
          {instrumentFilters.length !== RENDERED_INSTRUMENTS.length &&
            `${numMatchingCharts} charts for `}
          {tracks.length} songs found
        </span>

        <div>
          Filters
          <div>
            <Filters filtersChanged={filtersChangedCallback} />
          </div>
          <label>
            <input onChange={downloadedFilterChangedCallback} type="checkbox" />
            Hide songs with downloaded charts
          </label>
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
                      className={`bg-card py-0 ${
                        header.column.getCanSort()
                          ? 'cursor-pointer select-none'
                          : ''
                      }`}
                      style={{
                        textAlign: (header.column.columnDef.meta as any)?.align,
                        width: header.getSize(),
                      }}
                      onClick={header.column.getToggleSortingHandler()}>
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {{
                        asc: ' 🔼',
                        desc: ' 🔽',
                      }[header.column.getIsSorted() as string] ?? null}
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
                        className={[
                          row.getIsExpanded() ? 'py-2 bg-secondary' : '',
                        ].join(' ')}
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

const Filters = memo(function Filters({
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
        return newFilter;
      }
    });
  }, []);

  return (
    <>
      {RENDERED_INSTRUMENTS.map((instrument: AllowedInstrument) => {
        return (
          <InstrumentImage
            size="md"
            instrument={instrument}
            key={instrument}
            classNames={
              `cursor-pointer ` +
              (selectedFilters.length === 0 ||
              selectedFilters.includes(instrument)
                ? 'opacity-100'
                : 'opacity-50')
            }
            onClick={callback}
          />
        );
      })}
    </>
  );
});

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
      await downloadSong(artist, song, charter, url, {asSng: true});
    } catch (err) {
      console.log('Error while downloading', artist, song, charter, url, err);
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
