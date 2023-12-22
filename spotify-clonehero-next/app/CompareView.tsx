import {SongIniData} from '@/lib/local-songs-folder/scanLocalCharts';
import {songIniOrder} from './SongsDownloader';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';

const DEBUG = true;

type NullableSongIniData = {
  [P in keyof SongIniData]: SongIniData[P] | null;
};
// type NullableSongIniData = {
//   [K in (typeof songIniOrder)[number]]: SongIniData[K] | null;
// };

export default function CompareView<
  T extends NullableSongIniData,
  U extends NullableSongIniData,
>({
  currentChart,
  currentModified,
  recommendedChart,
  recommendedModified,
}: {
  currentChart: T;
  currentModified: Date;
  recommendedChart: U;
  recommendedModified: Date;
}) {
  if (DEBUG) {
    console.log(
      currentChart,
      currentModified.getTime(),
      recommendedChart,
      recommendedModified.getTime(),
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 overflow-y-auto">
      <div className="px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
        <table>
          <thead>
            <tr>
              <th className="pt-8 font-medium p-4 pl-8 pt-0 pb-3 text-slate-400 dark:text-slate-200 text-left">
                Key
              </th>
              <th className="pt-8 font-medium p-4 pl-8 pt-0 pb-3 text-slate-400 dark:text-slate-200 text-left">
                Current Chart&apos;s Value
              </th>
              <th className="pt-8 font-medium p-4 pl-8 pt-0 pb-3 text-slate-400 dark:text-slate-200 text-left">
                New Chart&apos;s Value
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border-b border-slate-100 dark:border-slate-700 p-1 pl-8 text-slate-500 dark:text-slate-400 text-left">
                Last Modified
              </td>
              <td className="border-b border-slate-100 dark:border-slate-700 p-1 pl-8 text-slate-500 dark:text-slate-400 text-left">
                {currentModified.toISOString()}
              </td>
              <td className="border-b border-slate-100 dark:border-slate-700 p-1 pl-8 text-slate-500 dark:text-slate-400 text-left">
                {recommendedModified.toISOString()}
              </td>
            </tr>
            {songIniOrder
              // .slice(0, songIniOrder.indexOf('preview_start_time'))
              .map(key => {
                // @ts-ignore Need to fix the types of the chart data
                const currentValue = currentChart[key];
                // @ts-ignore Need to fix the types of the chart data
                const recommendedValue = recommendedChart[key];

                if (currentValue == null && recommendedValue == null) {
                  return;
                }

                return (
                  <tr key={key}>
                    <td className="border-b border-slate-100 dark:border-slate-700 p-1 pl-8 text-slate-500 dark:text-slate-400 text-left">
                      {key}
                    </td>
                    <td className="border-b border-slate-100 dark:border-slate-700 p-1 pl-8 text-slate-500 dark:text-slate-400 text-left">
                      {currentValue === true
                        ? 'True'
                        : currentValue === false
                        ? 'False'
                        : currentValue ?? ''}
                    </td>
                    <td className="border-b border-slate-100 dark:border-slate-700 p-1 pl-8 text-slate-500 dark:text-slate-400 text-left">
                      {recommendedValue === true
                        ? 'True'
                        : recommendedValue === false
                        ? 'False'
                        : recommendedValue ?? ''}
                    </td>
                  </tr>
                );
              })
              .filter(Boolean)}
          </tbody>
        </table>
      </div>
      <div className="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
        <button className="bg-transparent hover:bg-blue-500 text-blue-700 font-semibold hover:text-white py-2 px-4 border border-blue-500 hover:border-transparent rounded">
          Keep current chart
        </button>
        <button className="bg-transparent hover:bg-blue-500 text-blue-700 font-semibold hover:text-white py-2 px-4 border border-blue-500 hover:border-transparent rounded">
          Replace current chart
        </button>
        <button className="bg-transparent hover:bg-blue-500 text-blue-700 font-semibold hover:text-white py-2 px-4 border border-blue-500 hover:border-transparent rounded">
          Download and keep both
        </button>
      </div>
    </div>
  );
}
