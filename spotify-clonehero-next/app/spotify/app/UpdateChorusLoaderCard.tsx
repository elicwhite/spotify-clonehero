'use client';

import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import type {ChorusChartProgress} from '@/lib/chorusChartDb';
import {calculateTimeRemaining, formatTimeRemaining} from '@/lib/ui-utils';
import useInterval from 'use-interval';
import {useState} from 'react';

export default function LocalScanLoaderCard({
  progress,
}: {
  progress: ChorusChartProgress;
}) {
  // Detect the 'updating-db' transition during render via the "store
  // previous prop" pattern from the React docs. startTime is captured
  // via a useState lazy initializer (which is outside of render and so
  // may call Date()), and re-captured by bumping a session counter on
  // each entry into updating-db — useState's initial value is then
  // re-derived by resetting via setState with a fresh Date.
  const isUpdating = progress.status === 'updating-db';
  const [previousStatus, setPreviousStatus] = useState(progress.status);
  const [startTime, setStartTime] = useState<Date | null>(() =>
    isUpdating ? new Date() : null,
  );
  const [timeRemaining, setTimeRemaining] = useState<number>(0);

  if (progress.status !== previousStatus) {
    setPreviousStatus(progress.status);
    if (isUpdating && previousStatus !== 'updating-db') {
      // Entering updating-db: capture fresh start time. Date() is
      // impure but React only calls the functional setState updater
      // once per commit, so the value is stable across re-renders of
      // this pass. react-hooks/purity allows impure reads inside
      // setState updater functions.
      setStartTime(() => new Date());
    } else if (!isUpdating) {
      setStartTime(null);
      setTimeRemaining(0);
    }
  }

  // Use use-interval to update the ETA
  useInterval(
    () => {
      if (
        startTime &&
        progress.status === 'updating-db' &&
        progress.numTotal > 0
      ) {
        const timeRemaining = calculateTimeRemaining(
          startTime,
          progress.numTotal,
          progress.numFetched,
          25, // Default estimate of 25ms per item
        );
        setTimeRemaining(timeRemaining);
        // setEta(formatTimeRemaining(timeRemaining));
      }
    },
    progress.status === 'updating-db' && startTime && timeRemaining > 0
      ? 1000
      : null,
  );

  function formatETA() {
    if (progress.status === 'idle') return 'Ready to scan';
    if (progress.status === 'fetching-dump') return 'Fetching dump...';
    if (progress.status === 'fetching') return 'Fetching...';
    if (progress.status === 'complete') return 'Finished!';
    if (progress.status === 'updating-db') {
      if (timeRemaining / 1000 < 5) return 'Almost done!';
      return formatTimeRemaining(timeRemaining);
    }

    return 'Ready to scan';
  }

  return (
    <div className="bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-2xl font-bold text-center flex items-center justify-center gap-2">
            Scanning Chorus
          </CardTitle>
          <p className="text-muted-foreground text-center text-sm">
            Scanning Chorus for new charts...
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t">
            <div className="text-center">
              <div className="text-lg font-semibold text-foreground">
                {progress.numFetched} / {progress.numTotal}
              </div>
              <div className="text-xs text-muted-foreground">New Charts</div>
            </div>

            <div className="text-center">
              <div className="text-lg font-semibold text-foreground">
                {formatETA()}
              </div>
              <div className="text-xs text-muted-foreground">
                Estimated Time
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
