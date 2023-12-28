import {SongIniData} from '@/lib/local-songs-folder/scanLocalCharts';
import {songIniOrder} from '../SongsDownloader';
import {useCallback} from 'react';
import {downloadSong} from '@/lib/local-songs-folder';
import Button from '@/components/Button';
import {TableDownloadStates} from './SongsTable';

const DEBUG = true;

type NullableSongIniData = {
  [P in keyof SongIniData]: SongIniData[P] | null;
};

export default function CompareView<
  T extends NullableSongIniData,
  U extends NullableSongIniData,
>({
  id,
  currentChart,
  currentModified,
  recommendedChart,
  recommendedModified,
  fileHandle,
  recommendedChartUrl,
  close,
  updateDownloadState,
}: {
  id: number;
  currentChart: T;
  currentModified: Date;
  recommendedChart: U;
  recommendedModified: Date;
  fileHandle: FileSystemHandle;
  recommendedChartUrl: string;
  close: () => void;
  updateDownloadState: (id: number, state: TableDownloadStates) => void;
}) {
  if (DEBUG) {
    console.log(
      currentChart,
      currentModified.getTime(),
      recommendedChart,
      recommendedModified.getTime(),
    );
  }

  const browserSupportsRemove: boolean =
    typeof (fileHandle as any).remove === 'function';

  const keepCurrentCallback = useCallback(async () => {
    close();
  }, [close]);

  const replaceCallback = useCallback(async () => {
    const {artist, name, charter} = recommendedChart;
    if (artist == null || name == null || charter == null) {
      throw new Error('Artist, name, or charter is null in song.ini');
    }

    updateDownloadState(id, 'downloading');
    close();
    // @ts-expect-error Remove is only in Chrome > 110.
    await fileHandle.remove({recursive: true});
    await downloadSong(artist, name, charter, recommendedChartUrl);
    updateDownloadState(id, 'downloaded');
  }, [
    fileHandle,
    id,
    recommendedChart,
    recommendedChartUrl,
    updateDownloadState,
    close,
  ]);

  const downloadKeepBothCallback = useCallback(async () => {
    const {artist, name, charter} = recommendedChart;

    if (currentChart.charter == charter) {
      throw new Error(
        'Cannot download both charts if they have the same charter',
      );
    }

    if (artist == null || name == null || charter == null) {
      throw new Error('Artist, name, or charter is null in song.ini');
    }

    updateDownloadState(id, 'downloading');
    close();
    await downloadSong(artist, name, charter, recommendedChartUrl);
    updateDownloadState(id, 'downloaded');
  }, [
    currentChart.charter,
    id,
    recommendedChart,
    recommendedChartUrl,
    updateDownloadState,
    close,
  ]);

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

                if (
                  key.startsWith('diff_') &&
                  (currentValue == -1 || currentValue == null) &&
                  (recommendedValue == -1 || recommendedValue == null)
                ) {
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
      <div className="bg-white dark:bg-slate-800 px-4 py-3 flex sm:px-6 space-x-4">
        <Button onClick={keepCurrentCallback}>Keep current chart</Button>
        {browserSupportsRemove && (
          <Button onClick={replaceCallback}>Replace current chart</Button>
        )}
        <Button
          onClick={downloadKeepBothCallback}
          disabled={currentChart.charter == recommendedChart.charter}>
          Download and keep both
        </Button>
      </div>
    </div>
  );
}
