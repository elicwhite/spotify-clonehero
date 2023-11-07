import {songIniOrder} from './SongsDownloader';
import {SongIniData} from './SongsPicker';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';

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
                Current Chart's Value
              </th>
              <th className="pt-8 font-medium p-4 pl-8 pt-0 pb-3 text-slate-400 dark:text-slate-200 text-left">
                New Chart's Value
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
                      {currentValue ?? ''}
                    </td>
                    <td className="border-b border-slate-100 dark:border-slate-700 p-1 pl-8 text-slate-500 dark:text-slate-400 text-left">
                      {recommendedValue ?? ''}
                    </td>
                  </tr>
                );
              })
              .filter(Boolean)}
          </tbody>
        </table>
      </div>
      <div className="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
        {/* <button
            type="button"
            className="inline-flex w-full justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 sm:ml-3 sm:w-auto"
            onClick={() => setOpen(false)}>
            Deactivate
          </button>
          <button
            type="button"
            className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
            onClick={() => setOpen(false)}
            ref={cancelButtonRef}>
            Cancel
          </button> */}
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
