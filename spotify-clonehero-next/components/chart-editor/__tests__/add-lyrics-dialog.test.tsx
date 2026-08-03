/**
 * @jest-environment jsdom
 */
/**
 * AddLyricsDialog <-> assist engine wiring (plan 0074 Phase 1, Suite 2).
 *
 * The dialog runs on the editor's shared assist runner, so these cover the
 * three things that wiring owes the user: the fingerprint it probes with is
 * the project's persisted one (not one re-derived from bytes), a run in
 * flight can be cancelled, and a successful cache-backed run tells the host
 * its vocals stem is available.
 *
 * `lib/assist/tasks` is mocked down to a controllable `add-lyrics` task —
 * the task's own behavior has its own suite; what's under test here is the
 * dialog. `ReplaceLyricsCommand` and `EditorSession` run for real.
 */

import '@testing-library/jest-dom';
import {act, useEffect} from 'react';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import {createEmptyChart} from '@eliwhite/scan-chart';
import type {ChartDocument} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '../scope';

jest.mock('../../../lib/drum-transcription/ml/roformer-separation', () => ({
  ensureProjectStemFingerprint: jest.fn(async () => 'persisted-fingerprint'),
  readProjectAudioBytes: jest.fn(async () => new ArrayBuffer(4)),
}));

interface CapturedRun {
  ctx: any;
  signal: AbortSignal;
  resolve: (result: unknown) => void;
  reject: (err: unknown) => void;
}

let captured: CapturedRun | null = null;
let usedCachedVocals = true;

jest.mock('../../../lib/assist/tasks', () => ({
  addLyricsTask: {
    key: 'add-lyrics',
    title: 'Lyrics / Vocals',
    planSteps: async () => [
      {key: 'align', label: 'Aligning syllables to audio'},
    ],
    run: (ctx: any, signal: AbortSignal) =>
      new Promise((resolve, reject) => {
        captured = {ctx, signal, resolve, reject};
        signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      }),
  },
}));

import AddLyricsDialog from '../AddLyricsDialog';
import {AssistRunnerProvider} from '@/components/assist/AssistRunnerProvider';
import {
  ensureProjectStemFingerprint,
  readProjectAudioBytes,
} from '@/lib/drum-transcription/ml/roformer-separation';

/** The project-backed wiring `/drum-transcription`'s editor hands the dialog:
 *  the project's persisted stem fingerprint, and its audio bytes behind a
 *  loader that only runs if the task actually needs them. */
const projectLoadAudio = async () => ({
  stemFingerprint: await ensureProjectStemFingerprint('proj-1'),
  loadOriginalBytes: async () =>
    new Uint8Array(await readProjectAudioBytes('proj-1')),
});

function makeDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  return {parsedChart: parsed, assets: []};
}

function Harness({
  onCachedVocals,
}: {
  onCachedVocals?: (() => void) | undefined;
}) {
  const {dispatch} = useChartEditorContext();
  useEffect(() => {
    dispatch({type: 'SET_CHART_DOC', chartDoc: makeDoc()});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <AddLyricsDialog
      loadAudio={projectLoadAudio}
      onAlignedFromCachedVocals={onCachedVocals}
    />
  );
}

function renderDialog(onCachedVocals?: () => void) {
  return render(
    <AssistRunnerProvider>
      <ChartEditorProvider activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
        <Harness onCachedVocals={onCachedVocals} />
      </ChartEditorProvider>
    </AssistRunnerProvider>,
  );
}

/** Opens the dialog, pastes lyrics, and starts the run. */
async function startAlign() {
  fireEvent.click(screen.getByRole('button', {name: /add lyrics/i}));
  fireEvent.change(screen.getByPlaceholderText(/paste the song lyrics/i), {
    target: {value: 'la la la'},
  });
  fireEvent.click(screen.getByRole('button', {name: /align/i}));
  await waitFor(() => expect(captured).not.toBeNull());
}

const alignedResult = () => ({
  syllables: [
    {text: 'la', startMs: 0, endMs: 100, joinNext: false, newLine: true},
  ],
  lowConfidence: false,
  lowConfidenceFrac: 0,
  usedCachedVocals,
});

beforeEach(() => {
  captured = null;
  usedCachedVocals = true;
  (ensureProjectStemFingerprint as jest.Mock).mockClear();
});

describe('AddLyricsDialog on the shared assist runner', () => {
  it('probes with the project persisted stem fingerprint and does not read audio bytes up front', async () => {
    renderDialog();
    await startAlign();

    expect(ensureProjectStemFingerprint).toHaveBeenCalledWith('proj-1');
    expect(captured!.ctx.audio.stemFingerprint).toBe('persisted-fingerprint');
    expect(captured!.ctx.audio.originalBytes).toBeUndefined();
    expect(typeof captured!.ctx.audio.loadOriginalBytes).toBe('function');

    await act(async () => {
      captured!.resolve(alignedResult());
    });
  });

  it('offers a cancel control during the run that aborts it and returns to the paste form', async () => {
    renderDialog();
    await startAlign();

    const cancel = await screen.findByRole('button', {name: /^cancel$/i});
    fireEvent.click(cancel);

    expect(captured!.signal.aborted).toBe(true);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText(/paste the song lyrics/i),
      ).toBeInTheDocument(),
    );
    // The pasted lyrics survive the cancel, ready to retry.
    expect(screen.getByPlaceholderText(/paste the song lyrics/i)).toHaveValue(
      'la la la',
    );
  });

  it('notifies the host when the run aligned against cached vocals', async () => {
    const onCachedVocals = jest.fn();
    renderDialog(onCachedVocals);
    await startAlign();

    await act(async () => {
      captured!.resolve(alignedResult());
    });

    await waitFor(() => expect(onCachedVocals).toHaveBeenCalledTimes(1));
  });

  it('does not notify the host when the run had to separate with Demucs', async () => {
    usedCachedVocals = false;
    const onCachedVocals = jest.fn();
    renderDialog(onCachedVocals);
    await startAlign();

    await act(async () => {
      captured!.resolve(alignedResult());
    });

    await waitFor(() =>
      expect(
        screen.queryByRole('button', {name: /^cancel$/i}),
      ).not.toBeInTheDocument(),
    );
    expect(onCachedVocals).not.toHaveBeenCalled();
  });
});
