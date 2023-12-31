import {
  useCallback,
  useRef,
  useState,
  useMemo,
  Fragment,
  useEffect,
} from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  Row,
  RowData,
  SortingState,
  useReactTable,
} from '@tanstack/react-table';
import {useVirtual} from 'react-virtual';
import {Dialog, Transition} from '@headlessui/react';

import {AiOutlineCheck} from 'react-icons/ai';
import CompareView from './CompareView';
import {SongWithRecommendation} from './SongsPicker';
import {removeStyleTags} from '@/lib/ui-utils';
import Button from '@/components/Button';
import pMap from 'p-map';
import {backupSong, downloadSong} from '@/lib/local-songs-folder';
import {flushSync} from 'react-dom';
import {sendGAEvent} from '@next/third-parties/google';

export type TableDownloadStates =
  | 'downloaded'
  | 'downloading'
  | 'not-downloading'
  | 'failed';

declare module '@tanstack/react-table' {
  interface TableMeta<TData extends RowData> {
    setDownloadState(index: number, state: TableDownloadStates): void;
  }
}

type RowType = {
  id: number;
  modifiedTime: Date;
  downloadState: TableDownloadStates;
  recommendationReasons: string[] | null;
} & Omit<Omit<SongWithRecommendation, 'modifiedTime'>, 'file'>;

const columnHelper = createColumnHelper<RowType>();

// Todo:
// - Progress indicator when clicking on update from same charter
// - Don't delete chart if download fails
// If a song fails to download, delete the new folder when restoring backup

export default function SongsTable({songs}: {songs: SongWithRecommendation[]}) {
  const [currentlyReviewing, setCurrentlyReviewing] = useState<RowType | null>(
    null,
  );

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
      columnHelper.accessor('charter', {
        header: 'Charter',
        minSize: 200,
        cell: props => {
          return removeStyleTags(props.getValue() || '');
        },
      }),
      columnHelper.accessor('recommendationReasons', {
        header: 'Reasons to Update',
        minSize: 300,
        cell: props => {
          const value = props.getValue();
          if (value != null) {
            return (
              <ul>
                {value.map(reason => {
                  return <li key={reason}>{reason}</li>;
                })}
              </ul>
            );
          }
        },
      }),
      columnHelper.accessor('recommendedChart', {
        header: 'Updated Chart?',
        meta: {
          align: 'center',
        },
        size: 100,
        cell: props => {
          if (props.row.original.downloadState == 'downloaded') {
            return <span>Downloaded</span>;
          }

          const value = props.getValue();
          switch (value.type) {
            case 'best-chart-installed':
              return <AiOutlineCheck />;
            case 'better-chart-found':
              return (
                <>
                  <button
                    className="px-3 py-2 text-sm font-medium text-center inline-flex items-center text-white bg-blue-700 rounded-lg hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
                    onClick={() => {
                      sendGAEvent({
                        event: 'review_chart',
                      });
                      setCurrentlyReviewing(props.row.original);
                    }}>
                    Review
                  </button>
                </>
              );
            default:
              throw new Error('Unexpected recommended type');
          }
        },
        sortingFn: (rowA, rowB, columnId): number => {
          const ordering = [
            'better-chart-found',
            'searching',
            'best-chart-installed',
            'not-checked',
          ];

          const aType = (rowA.getValue(columnId) as RowType['recommendedChart'])
            .type;
          const btype = (rowB.getValue(columnId) as RowType['recommendedChart'])
            .type;

          const aIndex = ordering.indexOf(aType);
          const bIndex = ordering.indexOf(btype);

          if (aIndex == -1 || bIndex == -1) {
            throw new Error('Unexpected recommendation ordering');
          }

          return bIndex - aIndex;
        },
      }),
    ],
    [],
  );

  const [downloadState, setDownloadState] = useState<{
    [key: number]: TableDownloadStates;
  }>(new Array(songs.length).fill('not-downloading'));

  const songsWithUpdates = useMemo(() => {
    return songs.filter(
      song => song.recommendedChart.type == 'better-chart-found',
    );
  }, [songs]);

  const songState = useMemo(
    () =>
      songsWithUpdates.map((song, index) => ({
        id: index,
        artist: song.data.artist,
        song: song.data.name,
        charter: song.data.charter,
        modifiedTime: new Date(song.modifiedTime),
        recommendationReasons:
          song.recommendedChart.type == 'better-chart-found'
            ? song.recommendedChart.reasons
            : null,
        recommendedChart: song.recommendedChart,
        fileHandle: song.fileHandle,
        data: song.data,
        downloadState: downloadState[index],
      })),
    [songsWithUpdates, downloadState],
  );

  const updatesWithSameCharter = useMemo(() => {
    return songsWithUpdates.filter(
      song =>
        song.recommendedChart.type == 'better-chart-found' &&
        song.recommendedChart.reasons.includes(
          'Chart from same charter is newer',
        ),
    );
  }, [songsWithUpdates]);

  const updateDownloadState = useCallback(
    (index: number, state: TableDownloadStates) => {
      setDownloadState(prev => {
        return {...prev, [index]: state};
      });
    },
    [],
  );

  const [updateStatus, setUpdateState] = useState<
    'not-started' | 'started' | 'done'
  >('not-started');
  const [numUpdated, setNumUpdated] = useState(0);

  const updateChartsWithSameCharter = useCallback(async () => {
    const before = Date.now();
    sendGAEvent({
      event: 'update_charts_with_same_charter',
    });
    setNumUpdated(0);
    setUpdateState('started');

    await pMap(
      songState,
      async song => {
        if (
          !(
            song.recommendedChart.type == 'better-chart-found' &&
            song.recommendedChart.reasons.includes(
              'Chart from same charter is newer',
            )
          )
        ) {
          return;
        }

        const {artist, song: name, charter} = song;
        if (artist == null || name == null || charter == null) {
          throw new Error('Artist, name, or charter is null in song.ini');
        }

        const id = song.id;

        updateDownloadState(id, 'downloading');

        const result = await backupSong(song.fileHandle);

        try {
          // @ts-expect-error Remove is only in Chrome > 110.
          await song.fileHandle.remove({recursive: true});
          await downloadSong(
            artist,
            name,
            charter,
            song.recommendedChart.betterChart.file,
          );
          updateDownloadState(id, 'downloaded');
          setNumUpdated(n => n + 1);
          await result.deleteBackup();
        } catch {
          await result.revert();
          console.log('Failed to download', artist, name, charter);
          updateDownloadState(id, 'failed');
        }
      },
      {concurrency: 3},
    );

    setUpdateState('done');
    const after = Date.now();
    console.log('Took', (after - before) / 1000, 'ss');
  }, [songState, updateDownloadState]);

  const [sorting, setSorting] = useState<SortingState>([
    {id: 'recommendedChart', desc: true},
    {id: 'artist', desc: false},
    {id: 'song', desc: false},
  ]);

  const table = useReactTable({
    data: songState,
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

  const [open, setOpen] = useState(true);
  const cancelButtonRef = useRef(null);

  useEffect(() => {
    setOpen(currentlyReviewing != null);
  }, [currentlyReviewing]);

  const close = useCallback(() => {
    setCurrentlyReviewing(null);
    setOpen(false);
  }, []);

  return (
    <>
      {currentlyReviewing &&
        currentlyReviewing.recommendedChart.type == 'better-chart-found' && (
          <Transition.Root show={open} as={Fragment}>
            <Dialog
              as="div"
              className="relative z-10"
              initialFocus={cancelButtonRef}
              onClose={close}>
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0"
                enterTo="opacity-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100"
                leaveTo="opacity-0">
                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
              </Transition.Child>

              <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
                <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
                  <Transition.Child
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
                    enterTo="opacity-100 translate-y-0 sm:scale-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100 translate-y-0 sm:scale-100"
                    leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95">
                    <Dialog.Panel className="relative transform rounded-lg shadow-xl ring-1 ring-slate-900/5 transition-all sm:my-8 sm:w-full sm:max-w-3xl">
                      <CompareView
                        id={currentlyReviewing.id}
                        fileHandle={currentlyReviewing.fileHandle}
                        currentChart={currentlyReviewing.data}
                        currentModified={currentlyReviewing.modifiedTime}
                        recommendedChart={
                          currentlyReviewing.recommendedChart.betterChart
                        }
                        recommendedModified={
                          new Date(
                            currentlyReviewing.recommendedChart.betterChart.modifiedTime,
                          )
                        }
                        recommendedChartUrl={
                          currentlyReviewing.recommendedChart.betterChart.file
                        }
                        updateDownloadState={updateDownloadState}
                        close={close}
                      />
                    </Dialog.Panel>
                  </Transition.Child>
                </div>
              </div>
            </Dialog>
          </Transition.Root>
        )}

      <div className="space-y-4 sm:space-y-0 sm:space-x-4 w-full text-start sm:text-end">
        <div>
          {songsWithUpdates.length} updates for {songs.length} songs found
        </div>

        {updateStatus == 'started' ? (
          <span>
            Updating, {numUpdated} of {updatesWithSameCharter.length}
          </span>
        ) : updateStatus == 'done' ? (
          <span>
            Updated {numUpdated} of {updatesWithSameCharter.length}
          </span>
        ) : (
          <Button
            onClick={updateChartsWithSameCharter}
            title="The recommended chart for these songs is a newer chart from the same charter you currently have installed. These updates likely don't need review.">
            Update {updatesWithSameCharter.length} songs from same charter
          </Button>
        )}
      </div>
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
                      className="bg-white dark:bg-slate-800 pt-8 font-medium px-8 pt-0 pb-3 text-slate-400 dark:text-slate-200 text-left"
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
