/**
 * @jest-environment jsdom
 */
/**
 * What the assist runner reports about a run (plan 0105 Stage 3).
 *
 * The runner is the one place every long-running task passes through, so
 * these are the assertions that keep the funnel's middle honest: one start
 * and exactly one terminal event per run, the real step a failure ended on,
 * and silence from a start the busy guard refused. The last one matters
 * most — counting a refused start would inflate the started total with work
 * that never began, and counting an unmount as a completion would report
 * work the user never received.
 */

import {act} from 'react';
import {renderHook} from '@testing-library/react';
import type {AssistTaskDef} from '@/lib/assist/tasks/types';
import type {AnalyticsEvent} from '@/lib/analytics/track';

const trackMock = jest.fn();
jest.mock('../../../lib/analytics/track', () => ({
  track: (payload: unknown) => trackMock(payload),
}));

import {
  useAssistRunnerControls,
  type AssistRunContext,
} from '../useAssistRunner';

const CONTEXT: AssistRunContext = {origin: 'tempo', entrypoint: 'assist-card'};

/** Events of one kind, in the order they were reported. */
function eventsNamed(name: AnalyticsEvent['event']) {
  return trackMock.mock.calls
    .map(([payload]) => payload as AnalyticsEvent)
    .filter(e => e.event === name);
}

/**
 * A task whose `run` is resolved or rejected by the test. `progress` is
 * pushed as soon as the run begins, so the runner has an active step to
 * report when the test then ends the run.
 */
function controllableTask({honoursAbort = true, reportsProgress = true} = {}): {
  task: AssistTaskDef<string, Record<string, never>>;
  finish: (result: string) => void;
  fail: (error: unknown) => void;
  started: Promise<void>;
} {
  let finish!: (result: string) => void;
  let fail!: (error: unknown) => void;
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => {
    markStarted = resolve;
  });
  const task = {
    key: 'generate-tempo-map',
    title: 'Tempo map',
    // Two steps, so the reported step has to come from the progress the run
    // actually made. With one step it would match whatever `planSteps`
    // returned and the tracking would be untested.
    planSteps: async () => [
      {key: 'beats', label: 'Finding beats'},
      {key: 'meter', label: 'Finding the meter'},
    ],
    run: (_input: unknown, signal: AbortSignal, progress: any) =>
      new Promise<string>((resolve, reject) => {
        if (reportsProgress) {
          progress({activeKey: 'beats', progress: 1});
          progress({activeKey: 'meter', progress: 0.5});
        }
        finish = resolve;
        fail = reject;
        if (honoursAbort) {
          signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }
        markStarted();
      }),
  } as unknown as AssistTaskDef<string, Record<string, never>>;
  // Wrapped rather than returned directly: `run` has not executed yet, so
  // returning the bindings themselves would hand back `undefined`.
  return {
    task,
    finish: (result: string) => finish(result),
    fail: (error: unknown) => fail(error),
    started,
  };
}

beforeEach(() => {
  trackMock.mockClear();
});

test('a successful run reports one start and one completion, with its dimensions', async () => {
  const {task, finish, started} = controllableTask();
  const {result} = renderHook(() => useAssistRunnerControls());

  let run!: Promise<string>;
  act(() => {
    run = result.current.start(task, {}, CONTEXT);
  });
  await act(async () => {
    await started;
  });

  expect(eventsNamed('assist_run_started')).toEqual([
    {
      event: 'assist_run_started',
      task: 'generate-tempo-map',
      origin: 'tempo',
      entrypoint: 'assist-card',
    },
  ]);

  await act(async () => {
    finish('done');
    await run;
  });

  const completed = eventsNamed('assist_run_completed');
  expect(completed).toHaveLength(1);
  expect(completed[0]).toMatchObject({
    task: 'generate-tempo-map',
    origin: 'tempo',
    entrypoint: 'assist-card',
  });
  // No second terminal event of any kind.
  expect(eventsNamed('assist_run_failed')).toHaveLength(0);
  expect(eventsNamed('assist_run_cancelled')).toHaveLength(0);
});

test('a failed run reports the step it was on, and never the error message', async () => {
  const {task, fail, started} = controllableTask();
  const {result} = renderHook(() => useAssistRunnerControls());

  let run!: Promise<string>;
  act(() => {
    run = result.current.start(task, {}, CONTEXT);
  });
  await act(async () => {
    await started;
  });
  await act(async () => {
    fail(new Error('could not read /Users/someone/My Song.ogg'));
    await run.catch(() => {});
  });

  const failed = eventsNamed('assist_run_failed');
  expect(failed).toHaveLength(1);
  // This is the field `add_lyrics_align_failed` reported as "unknown" for 90
  // days. It has to be the real step.
  expect(failed[0]).toMatchObject({step: 'meter', task: 'generate-tempo-map'});
  expect(JSON.stringify(failed[0])).not.toContain('My Song');
});

test('a cancelled run is reported as cancelled, not as a failure', async () => {
  const {task, started} = controllableTask();
  const {result} = renderHook(() => useAssistRunnerControls());

  let run!: Promise<string>;
  act(() => {
    run = result.current.start(task, {}, CONTEXT);
  });
  await act(async () => {
    await started;
  });
  await act(async () => {
    result.current.cancel();
    await run.catch(() => {});
  });

  expect(eventsNamed('assist_run_cancelled')).toHaveLength(1);
  expect(eventsNamed('assist_run_failed')).toHaveLength(0);
});

test('a run refused because another is in flight reports nothing', async () => {
  const {task, started} = controllableTask();
  const {result} = renderHook(() => useAssistRunnerControls());

  act(() => {
    void result.current.start(task, {}, CONTEXT).catch(() => {});
  });
  await act(async () => {
    await started;
  });
  trackMock.mockClear();

  await act(async () => {
    await result.current.start(task, {}, CONTEXT).catch(() => {});
  });

  // A refused run never began, so counting it would inflate the started
  // total with work that did not happen.
  expect(trackMock).not.toHaveBeenCalled();
});

// The fixture deliberately IGNORES its abort signal, so this exercises the
// runner's own `signal.aborted` guard rather than the task's cooperation.
// With a cooperative task the pre-existing catch would report the
// cancellation and the guard could be deleted without any test noticing.
test('a task that ignores its abort signal still reports a cancellation', async () => {
  const {task, finish, started} = controllableTask({honoursAbort: false});
  const {result, unmount} = renderHook(() => useAssistRunnerControls());

  let run!: Promise<string>;
  act(() => {
    run = result.current.start(task, {}, CONTEXT);
  });
  await act(async () => {
    await started;
  });
  trackMock.mockClear();

  // Unmounting aborts the controller. The task's own promise settles
  // afterwards, which must not produce a second, contradicting terminal
  // event — a completion counted here would be work the user walked away
  // from and never received.
  unmount();
  await act(async () => {
    finish('done');
    await run.catch(() => {});
  });

  expect(eventsNamed('assist_run_cancelled')).toHaveLength(1);
  expect(eventsNamed('assist_run_completed')).toHaveLength(0);
  expect(eventsNamed('assist_run_failed')).toHaveLength(0);
});

test('a cancel before the first progress tick reports the first step, not a planning failure', async () => {
  // Real tasks do slow work — loading and decoding audio — before their
  // first progress report, and a cancel in that window is the commonest
  // cancel there is. Reporting it as `plan-steps` would blame planning for
  // a failure that never happened there.
  const {task, started} = controllableTask({reportsProgress: false});
  const {result} = renderHook(() => useAssistRunnerControls());

  let run!: Promise<string>;
  act(() => {
    run = result.current.start(task, {}, CONTEXT);
  });
  await act(async () => {
    await started;
  });
  await act(async () => {
    result.current.cancel();
    await run.catch(() => {});
  });

  const cancelled = eventsNamed('assist_run_cancelled');
  expect(cancelled).toHaveLength(1);
  expect(cancelled[0]).toMatchObject({step: 'beats'});
});
