/**
 * @jest-environment jsdom
 */
/**
 * The editor's single assist runner (plan 0074 Design B).
 *
 * Two surfaces (standing in for the Regenerate control and the Add Lyrics
 * dialog) share one `AssistRunnerProvider`, so these cover what "one active
 * run across the editor" and "abort on unmount" mean to a user: a second run
 * is refused with a visible message instead of silently killing the first,
 * closing the editor stops the workers, and a finished run's step list
 * clears itself.
 *
 * `lib/assist/tasks` is mocked down to two controllable tasks — the tasks'
 * own behavior has its own suite.
 */

import '@testing-library/jest-dom';
import {act, useState} from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import type {AssistTaskDef} from '@/lib/assist/tasks/types';

interface CapturedRun {
  signal: AbortSignal;
  resolve: (result: unknown) => void;
}

let runs: CapturedRun[] = [];

/** When set, `planSteps` blocks on it — lets a test hold a start inside its
 *  planning phase and issue a second start while it is still there. */
let mockPlanGate: Promise<void> | null = null;

function fakeTask(key: string, stepKey: string, stepLabel: string) {
  return {
    key,
    title: key,
    planSteps: async () => {
      if (mockPlanGate) await mockPlanGate;
      return [{key: stepKey, label: stepLabel}];
    },
    run: (_ctx: unknown, signal: AbortSignal, progress: any) =>
      new Promise((resolve, reject) => {
        progress({activeKey: stepKey, progress: 0.5});
        runs.push({signal, resolve});
        signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      }),
  };
}

jest.mock('../../../lib/assist/tasks/transcribe-drums', () => ({
  transcribeDrumsTask: fakeTask(
    'transcribe-drums',
    'transcribing',
    'Transcribing Drums',
  ),
}));
jest.mock('../../../lib/assist/tasks/add-lyrics', () => ({
  addLyricsTask: fakeTask('add-lyrics', 'align', 'Aligning syllables'),
}));

import {transcribeDrumsTask} from '@/lib/assist/tasks/transcribe-drums';
import {addLyricsTask} from '@/lib/assist/tasks/add-lyrics';
import {
  AssistRunnerProvider,
  useAssistRunnerContext,
} from '../AssistRunnerProvider';
import {ConnectedAssistRunCard} from '../AssistRunCard';

/** A surface that can start the shared run and shows whatever the runner
 *  told it when a start was refused. */
function StartSurface({
  label,
  task,
}: {
  label: string;
  task: AssistTaskDef<unknown, unknown>;
}) {
  const {start} = useAssistRunnerContext();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div>
      <button
        onClick={() => {
          setMessage(null);
          start(task, {}).catch((e: unknown) => {
            if (e instanceof DOMException && e.name === 'AbortError') return;
            setMessage(e instanceof Error ? e.message : String(e));
          });
        }}>
        {label}
      </button>
      {message && <p role="alert">{message}</p>}
    </div>
  );
}

/** The sidebar's drum-transcription card: scoped to that task, so a run
 *  started elsewhere in the editor doesn't light it up. */
function RegenerateRunCard() {
  const {store, cancel} = useAssistRunnerContext();
  return (
    <ConnectedAssistRunCard
      store={store}
      task="transcribe-drums"
      onCancel={cancel}
    />
  );
}

function Editor() {
  return (
    <AssistRunnerProvider>
      <StartSurface label="Regenerate" task={transcribeDrumsTask} />
      <StartSurface label="Align lyrics" task={addLyricsTask} />
      <RegenerateRunCard />
    </AssistRunnerProvider>
  );
}

beforeEach(() => {
  runs = [];
  mockPlanGate = null;
});

describe('AssistRunnerProvider', () => {
  it('refuses a second run while one is in flight, telling the user why and leaving the first alone', async () => {
    render(<Editor />);

    fireEvent.click(screen.getByRole('button', {name: 'Regenerate'}));
    await waitFor(() => expect(runs).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', {name: 'Align lyrics'}));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/already running/i);
    // The refused start never began a run, and never disturbed the first.
    expect(runs).toHaveLength(1);
    expect(runs[0].signal.aborted).toBe(false);
    expect(
      screen.getByRole('list', {name: /progress steps/i}),
    ).toBeInTheDocument();
  });

  it('refuses a second start issued while the first is still planning', async () => {
    let releasePlan!: () => void;
    mockPlanGate = new Promise<void>(resolve => {
      releasePlan = resolve;
    });

    render(<Editor />);

    fireEvent.click(screen.getByRole('button', {name: 'Regenerate'}));
    await act(async () => {
      await Promise.resolve();
    });
    // The first start is parked inside planSteps: no task.run yet, so a
    // guard that waited for planning to finish would let the next click by.
    expect(runs).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', {name: 'Align lyrics'}));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/already running/i);

    await act(async () => {
      releasePlan();
      await Promise.resolve();
    });

    // Exactly one run, and it is the first surface's — not orphaned, not
    // replaced by the refused one.
    await waitFor(() => expect(runs).toHaveLength(1));
    expect(runs[0].signal.aborted).toBe(false);
    expect(
      screen.getByRole('list', {name: /progress steps/i}),
    ).toBeInTheDocument();

    // The runner's controller still targets that run, so cancelling reaches
    // it rather than a controller the refused start took over.
    fireEvent.click(screen.getByRole('button', {name: /cancel/i}));
    await waitFor(() => expect(runs[0].signal.aborted).toBe(true));
  });

  it('allows a new run once the previous one has finished', async () => {
    render(<Editor />);

    fireEvent.click(screen.getByRole('button', {name: 'Regenerate'}));
    await waitFor(() => expect(runs).toHaveLength(1));
    await act(async () => {
      runs[0].resolve('done');
    });

    fireEvent.click(screen.getByRole('button', {name: 'Align lyrics'}));

    await waitFor(() => expect(runs).toHaveLength(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('leaves a task-scoped card quiet while a different task runs', async () => {
    render(<Editor />);

    fireEvent.click(screen.getByRole('button', {name: 'Align lyrics'}));
    await waitFor(() => expect(runs).toHaveLength(1));

    expect(
      screen.queryByRole('list', {name: /progress steps/i}),
    ).not.toBeInTheDocument();
  });

  it('aborts the in-flight run when the editor unmounts', async () => {
    const {unmount} = render(<Editor />);

    fireEvent.click(screen.getByRole('button', {name: 'Regenerate'}));
    await waitFor(() => expect(runs).toHaveLength(1));

    unmount();

    expect(runs[0].signal.aborted).toBe(true);
  });

  it('clears the finished step list after the success flash', async () => {
    jest.useFakeTimers();
    try {
      render(<Editor />);

      fireEvent.click(screen.getByRole('button', {name: 'Regenerate'}));
      await act(async () => {
        await Promise.resolve();
      });
      expect(runs).toHaveLength(1);

      await act(async () => {
        runs[0].resolve('done');
        await Promise.resolve();
      });
      expect(
        screen.getByRole('list', {name: /progress steps/i}),
      ).toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(10_000);
      });

      expect(
        screen.queryByRole('list', {name: /progress steps/i}),
      ).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
