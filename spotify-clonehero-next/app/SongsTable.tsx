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

type RowType = {
  id: number;
  artist: string;
  song: string;
  charter: string;
  lastModified: string;
  recommendedChart:
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
};

const columnHelper = createColumnHelper<RowType>();

const columns = [
  {
    accessorKey: 'artist',
    header: 'Artist',
    minSize: 200,
  },
  {
    accessorKey: 'song',
    header: 'Song',
  },
  {
    accessorKey: 'charter',
    header: 'Charter',
  },
  {
    accessorKey: 'lastModified',
    header: 'Last Modified',
  },
  columnHelper.accessor('recommendedChart', {
    header: 'Updated Chart?',
    cell: props => props.getValue().type,
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
        lastModified: new Date(song.lastModified).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }),
        recommendedChart: song.recommendedChart,
      })),
    [songs],
  );

  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: songState,
    columns,
    state: {
      sorting,
    },
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
                    <td key={cell.id}>
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
