'use client';

import {useCallback, useEffect, useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {getTodayQueue, type FillWithSrs} from '@/lib/drum-fills/db';
import PracticeView from './PracticeView';

/**
 * The "Today" spaced-repetition queue: pulls due reviews + new fills from the DB
 * and walks the player through them one at a time, launching a PracticeView per
 * fill and advancing on completion (Next / Back-to-queue).
 */
export default function TodayQueue({onExit}: {onExit: () => void}) {
  const [queue, setQueue] = useState<FillWithSrs[] | null>(null);
  const [index, setIndex] = useState(0);

  const load = useCallback(() => {
    getTodayQueue(Date.now(), 20)
      .then(rows => {
        setQueue(rows);
        setIndex(0);
      })
      .catch(err => {
        console.error('Failed to build today queue', err);
        toast.error('Could not build the Today queue.');
        setQueue([]);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const advance = useCallback(() => {
    setIndex(i => i + 1);
  }, []);

  if (queue === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Building today&apos;s queue…
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Nothing due today</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground">
              You have no reviews due and no new fills queued. Scan your library
              or practice fills from the Library to build your schedule.
            </p>
            <Button variant="outline" onClick={onExit}>
              Back to Library
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (index >= queue.length) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Session complete</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground">
              You worked through all {queue.length} fills in today&apos;s queue.
            </p>
            <div className="flex gap-2">
              <Button onClick={load}>Rebuild queue</Button>
              <Button variant="outline" onClick={onExit}>
                Back to Library
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const current = queue[index];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between text-sm text-muted-foreground">
        <span>
          Today queue — {index + 1} / {queue.length}
        </span>
        <Button variant="ghost" size="sm" onClick={onExit}>
          Exit queue
        </Button>
      </div>
      <PracticeView
        key={current.id}
        fillId={current.id}
        onExit={onExit}
        onNext={advance}
      />
    </div>
  );
}
