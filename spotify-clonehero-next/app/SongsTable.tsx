import {useCallback, useRef, useState, useReducer, useMemo} from 'react';
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
import {SongAccumulator} from './SongsPicker';
import {ChartResponse} from './chartSelection';

import {AiOutlineDash, AiOutlineCheck, AiFillCheckCircle} from 'react-icons/ai';
import {ThreeDots} from 'react-loading-icons';

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
  recommendedChart: Recommendation;
};

const columnHelper = createColumnHelper<RowType>();

const columns = [
  {
    accessorKey: 'artist',
    header: 'Artist',
    minSize: 200,
    // sortingFn: 'alphanumeric',
  },
  {
    accessorKey: 'song',
    header: 'Song',
    // sortingFn: 'alphanumeric',
  },
  {
    accessorKey: 'charter',
    header: 'Charter',
    // sortingFn: 'text',
  },
  columnHelper.accessor('lastModified', {
    header: 'Last Modified',
    cell: props => {
      return props.getValue().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    },
  }),
  columnHelper.accessor('recommendedChart', {
    header: 'Updated Chart?',
    meta: {
      align: 'center',
    },
    cell: props => {
      switch (props.getValue().type) {
        case 'not-checked':
          return <AiOutlineDash />;
        case 'searching':
          return <ThreeDots style={{height: '6px'}} />;
        case 'best-chart-installed':
          return <AiOutlineCheck />;
        case 'better-chart-found':
          return (
            <button className="bg-transparent hover:bg-blue-500 text-blue-700 font-semibold hover:text-white py-2 px-4 border border-blue-500 hover:border-transparent rounded">
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
    minSize: 300,
  }),
];

export default function SongsTable({songs}: {songs: SongAccumulator[]}) {
  const songState = useMemo(
    () =>
      songs.map((song, index) => ({
        id: index + 1,
        artist: song.data.artist,
        song: song.data.name,
        charter: song.data.charter,
        lastModified: new Date(song.lastModified),
        recommendedChart: song.recommendedChart,
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
    debugTable: true,
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
    <div className="p-2 overflow-y-auto" ref={tableContainerRef}>
      <table className="w-full">
        <thead>
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => {
                return (
                  <th
                    key={header.id}
                    colSpan={header.colSpan}
                    className="sticky top-0"
                    style={{
                      width: header.getSize(),
                    }}>
                    {header.isPlaceholder ? null : (
                      <div
                        {...{
                          className: header.column.getCanSort()
                            ? 'cursor-pointer select-none'
                            : '',
                          onClick: header.column.getToggleSortingHandler(),
                        }}>
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {{
                          asc: ' 🔼',
                          desc: ' 🔽',
                        }[header.column.getIsSorted() as string] ?? null}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
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
  );
}
