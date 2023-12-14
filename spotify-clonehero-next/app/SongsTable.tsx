import {
  useCallback,
  useRef,
  useState,
  useReducer,
  useMemo,
  Fragment,
  useEffect,
} from 'react';
import {
  ColumnDef,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  Row,
  SortingState,
  useReactTable,
} from '@tanstack/react-table';
import {useVirtual} from 'react-virtual';
import {ChartResponse} from './chartSelection';
import {Dialog, Transition} from '@headlessui/react';

import {AiOutlineDash, AiOutlineCheck, AiFillCheckCircle} from 'react-icons/ai';
import {ThreeDots} from 'react-loading-icons';
import CompareView from './CompareView';
import {SongIniData} from '@/lib/scanLocalCharts';
import {SongWithRecommendation} from './SongsPicker';
import {removeStyleTags} from '@/lib/ui-utils';

type Recommendation =
  | {
      type: 'not-checked';
    }
  | {
      type: 'searching';
    }
  | {
      type: 'best-chart-installed';
    }
  | {
      type: 'better-chart-found';
      betterChart: ChartResponse;
    };

type RowType = {
  id: number;
  artist: string;
  song: string;
  charter: string;
  lastModified: Date;
  data: SongIniData;
  recommendedChart: Recommendation;
};

const columnHelper = createColumnHelper<RowType>();

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
      columnHelper.accessor('recommendedChart', {
        header: 'Updated Chart?',
        meta: {
          align: 'center',
        },
        size: 100,
        cell: props => {
          switch (props.getValue().type) {
            case 'not-checked':
              return <AiOutlineDash />;
            case 'searching':
              return <ThreeDots style={{height: '6px'}} />;
            case 'best-chart-installed':
              return <AiOutlineCheck />;
            case 'better-chart-found':
              const value = props;
              return (
                <button
                  className="px-3 py-2 text-sm font-medium text-center inline-flex items-center text-white bg-blue-700 rounded-lg hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300 dark:bg-blue-600 dark:hover:bg-blue-700 dark:focus:ring-blue-800"
                  onClick={() => {
                    setCurrentlyReviewing(value.row.original);
                  }}>
                  Review
                </button>
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

          const aType = (rowA.getValue(columnId) as Recommendation).type;
          const btype = (rowB.getValue(columnId) as Recommendation).type;

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

  const songState = useMemo(
    () =>
      songs.map((song, index) => ({
        id: index + 1,
        artist: song.data.artist,
        song: song.data.name,
        charter: song.data.charter,
        lastModified: new Date(song.lastModified),
        recommendedChart: song.recommendedChart,
        data: song.data,
      })),
    [songs],
  );

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

  return (
    <>
      {currentlyReviewing &&
        currentlyReviewing.recommendedChart.type == 'better-chart-found' && (
          <Transition.Root show={open} as={Fragment}>
            <Dialog
              as="div"
              className="relative z-10"
              initialFocus={cancelButtonRef}
              onClose={(...args) => {
                setCurrentlyReviewing(null);
                setOpen(false);
              }}>
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
                        currentChart={currentlyReviewing.data}
                        currentModified={currentlyReviewing.lastModified}
                        recommendedChart={
                          currentlyReviewing.recommendedChart.betterChart
                        }
                        recommendedModified={
                          new Date(
                            currentlyReviewing.recommendedChart.betterChart.uploadedAt,
                          )
                        }
                      />
                    </Dialog.Panel>
                  </Transition.Child>
                </div>
              </div>
            </Dialog>
          </Transition.Root>
        )}

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
