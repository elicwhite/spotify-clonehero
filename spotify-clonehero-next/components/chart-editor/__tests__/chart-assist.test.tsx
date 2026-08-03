/**
 * @jest-environment jsdom
 */
/**
 * Chart Assist sidebar section (plan 0074 Phase 2, Design C/F, task 2e).
 *
 * `lib/assist/tasks` is mocked down to controllable `transcribe-drums` /
 * `generate-tempo-map` tasks (the tasks' own pipeline behavior, including
 * its worker seams, has its own suites elsewhere; what a task run does to
 * the card is what matters here) — under test is `ChartAssist` itself:
 * card visibility as a function of capability variant AND host wiring, the
 * staleness/ack wiring against the real reducer +
 * `ReplaceDrumTrackCommand`/content-stamps machinery, the leading-silence
 * detector's call-to-action, the Learn More modal, and the inline run card
 * taking over a card without freezing its siblings.
 */

import '@testing-library/jest-dom';
import {useEffect, useRef} from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import {createEmptyChart, noteTypes} from '@eliwhite/scan-chart';
import type {ChartDocument} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {addDrumNote} from '@/lib/chart-edit';
import {computeTempoStamp, withAssistProvenance} from '@/lib/chart-editor-core';
import {TooltipProvider} from '@/components/ui/tooltip';

import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {useExecuteCommand} from '../hooks/useEditCommands';
import {AddBPMCommand} from '../commands';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '../scope';
import {
  DRUM_EDIT_CAPABILITIES,
  ADD_LYRICS_CAPABILITIES,
  TEMPO_CAPABILITIES,
  PREVIEW_CAPABILITIES,
} from '../capabilities';

interface CapturedRun {
  ctx: unknown;
  signal: AbortSignal;
  resolve: (result: unknown) => void;
  reject: (err: unknown) => void;
}

let capturedTranscribe: CapturedRun | null = null;
let capturedTempo: CapturedRun | null = null;

jest.mock('../../../lib/assist/tasks', () => ({
  transcribeDrumsTask: {
    key: 'transcribe-drums',
    title: 'Drum transcription',
    planSteps: async () => [{key: 'transcribing', label: 'Transcribing drums'}],
    run: (ctx: unknown, signal: AbortSignal) =>
      new Promise((resolve, reject) => {
        capturedTranscribe = {ctx, signal, resolve, reject};
        signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      }),
  },
  generateTempoMapTask: {
    key: 'generate-tempo-map',
    title: 'Tempo map',
    planSteps: async () => [{key: 'convert', label: 'Building the tempo map'}],
    run: (ctx: unknown, signal: AbortSignal) =>
      new Promise((resolve, reject) => {
        capturedTempo = {ctx, signal, resolve, reject};
        signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      }),
  },
}));

import ChartAssist from '../sidebar/ChartAssist';
import {AssistRunnerProvider} from '@/components/assist/AssistRunnerProvider';

function makeDoc(noteCount = 1): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  for (let i = 0; i < noteCount; i++) {
    addDrumNote(doc.parsedChart.trackData[0], {
      tick: i * 480,
      type: noteTypes.kick,
    });
  }
  return doc;
}

/** A doc whose drum-transcription provenance is fresh against its own
 *  current tempo stamp — i.e. not stale until something edits the tempo. */
function makeDocWithFreshProvenance(): ChartDocument {
  const doc = makeDoc();
  return withAssistProvenance(doc, {
    drumTranscription: {tempoStamp: computeTempoStamp(doc)},
  });
}

interface Wiring {
  projectId?: string | undefined;
  loadAudio?:
    | (() => Promise<{
        loadOriginalBytes: () => Promise<Uint8Array>;
        stemFingerprint?: string | undefined;
      }>)
    | undefined;
  audioSampleRate?: number | undefined;
  detectedAudioOnsetMs?: number | undefined;
  leadingSilenceDisabledReason?: string | undefined;
  drumRerunDisabledReason?: string | undefined;
}

/** What a fully project-backed host supplies, so every card renders. */
const FULL_WIRING: Wiring = {
  projectId: 'proj-1',
  loadAudio: async () => ({
    loadOriginalBytes: async () => new Uint8Array(4),
  }),
  audioSampleRate: 44100,
};

/**
 * What the shared `TrackEditPage` shell (`/chart-editor`, `/guitar-edit`,
 * `/bass-edit`, `/drum-edit`) supplies: the chart package's audio, and a
 * reason for each of the two cards whose action that surface can't perform.
 */
const TRACK_EDIT_WIRING: Wiring = {
  loadAudio: async () => ({
    loadOriginalBytes: async () => new Uint8Array(4),
  }),
  audioSampleRate: 44100,
  leadingSilenceDisabledReason:
    "This editor plays and exports the chart's audio files as they are, so it cannot pad the audio to match the shifted chart.",
  drumRerunDisabledReason:
    'Re-running transcription needs the separated drum audio from the drum transcription tool. This chart was loaded from a file, so there is nothing to re-run here.',
};

function Harness({doc, wiring}: {doc: ChartDocument; wiring: Wiring}) {
  const {dispatch} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();
  const tempoEditTick = useRef(1000);
  useEffect(() => {
    dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div>
      <button
        onClick={() => {
          // A distinct tick each click, so repeated clicks each produce a
          // genuinely different tempo-map content stamp (re-inserting the
          // exact same marker twice would leave the stamp unchanged).
          executeCommand(new AddBPMCommand(tempoEditTick.current, 150, 'grid'));
          tempoEditTick.current += 480;
        }}>
        edit tempo
      </button>
      <ChartAssist {...wiring} />
    </div>
  );
}

function renderChartAssist(
  doc: ChartDocument,
  capabilities = DRUM_EDIT_CAPABILITIES,
  wiring: Wiring = FULL_WIRING,
) {
  return render(
    <TooltipProvider>
      <AssistRunnerProvider>
        <ChartEditorProvider
          capabilities={capabilities}
          activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
          <Harness doc={doc} wiring={wiring} />
        </ChartEditorProvider>
      </AssistRunnerProvider>
    </TooltipProvider>,
  );
}

/** Clicks a card's action and confirms any confirmation dialog it raises. */
function clickAndConfirm(name: RegExp, confirmName: RegExp) {
  fireEvent.click(screen.getByRole('button', {name}));
  fireEvent.click(screen.getByRole('button', {name: confirmName}));
}

beforeEach(() => {
  capturedTranscribe = null;
  capturedTempo = null;
});

describe('ChartAssist capability gating', () => {
  it('renders every card under DRUM_EDIT_CAPABILITIES', () => {
    renderChartAssist(makeDocWithFreshProvenance(), DRUM_EDIT_CAPABILITIES);
    expect(screen.getByText('Chart Assist')).toBeInTheDocument();
    for (const name of [
      'Tempo map',
      'Add leading silence',
      'Drum transcription',
      'Lyrics / Vocals',
    ]) {
      expect(screen.getByRole('group', {name})).toBeInTheDocument();
    }
  });

  it('renders only Tempo map + Add leading silence under TEMPO_CAPABILITIES', () => {
    renderChartAssist(makeDocWithFreshProvenance(), TEMPO_CAPABILITIES);
    expect(screen.getByRole('group', {name: 'Tempo map'})).toBeInTheDocument();
    expect(
      screen.getByRole('group', {name: 'Add leading silence'}),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('group', {name: 'Drum transcription'}),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('group', {name: 'Lyrics / Vocals'}),
    ).not.toBeInTheDocument();
  });

  it('renders only the Lyrics card under ADD_LYRICS_CAPABILITIES', () => {
    renderChartAssist(makeDocWithFreshProvenance(), ADD_LYRICS_CAPABILITIES);
    expect(
      screen.getByRole('group', {name: 'Lyrics / Vocals'}),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('group', {name: 'Tempo map'}),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('group', {name: 'Add leading silence'}),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('group', {name: 'Drum transcription'}),
    ).not.toBeInTheDocument();
  });

  it('renders nothing under PREVIEW_CAPABILITIES', () => {
    renderChartAssist(makeDocWithFreshProvenance(), PREVIEW_CAPABILITIES);
    expect(screen.queryByText('Chart Assist')).not.toBeInTheDocument();
  });
});

/**
 * The `TrackEditPage` surface: a chart loaded from a file, with its own
 * audio but no drum-transcription project behind it and no way to pad the
 * audio it plays and exports. Two cards run, two render with a disabled
 * action and a reason, and none of the four is silently missing.
 */
describe('ChartAssist on the TrackEditPage surface', () => {
  function renderTrackEdit(doc = makeDoc()) {
    return renderChartAssist(doc, DRUM_EDIT_CAPABILITIES, TRACK_EDIT_WIRING);
  }

  it('renders all four cards', () => {
    renderTrackEdit();
    for (const name of [
      'Tempo map',
      'Add leading silence',
      'Drum transcription',
      'Lyrics / Vocals',
    ]) {
      expect(screen.getByRole('group', {name})).toBeInTheDocument();
    }
  });

  it('offers the two audio-only actions', () => {
    renderTrackEdit();
    expect(
      screen.getByRole('button', {name: /generate tempo map/i}),
    ).toBeEnabled();
    // The Lyrics card's action is the Add Lyrics dialog's trigger.
    expect(screen.getByRole('button', {name: /add lyrics/i})).toBeEnabled();
  });

  it('disables Add leading silence and says why', () => {
    renderTrackEdit();
    const button = screen.getByRole('button', {name: /add leading silence/i});
    expect(button).toBeDisabled();
    // The reason reaches a sighted user through the tooltip and everyone
    // else through the button's accessible description.
    expect(button).toHaveAccessibleDescription(
      /cannot pad the audio to match/i,
    );
  });

  it('disables the transcription re-run and says why', () => {
    renderTrackEdit();
    const button = screen.getByRole('button', {name: /^re-run$/i});
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      /needs the separated drum audio/i,
    );
  });

  it('keeps the staleness prompt and Keep as-is working without a re-run', () => {
    renderTrackEdit(makeDocWithFreshProvenance());
    fireEvent.click(screen.getByRole('button', {name: /edit tempo/i}));
    expect(
      screen.getByText(/tempo grid changed after transcription/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /keep as-is/i}));
    expect(
      screen.queryByText(/tempo grid changed after transcription/i),
    ).not.toBeInTheDocument();
  });

  it('does not call a chart AI-transcribed unless it carries that record', () => {
    renderTrackEdit();
    const card = screen.getByRole('group', {name: 'Drum transcription'});
    expect(within(card).getByText(/1 notes on drums · expert/i)).toBeVisible();
    expect(within(card).queryByText(/ai-transcribed/i)).not.toBeInTheDocument();
  });

  it('does call it AI-transcribed when the chart carries the record', () => {
    renderTrackEdit(makeDocWithFreshProvenance());
    const card = screen.getByRole('group', {name: 'Drum transcription'});
    expect(within(card).getByText(/ai-transcribed/i)).toBeInTheDocument();
  });
});

describe('ChartAssist drum-transcription staleness', () => {
  it('shows no staleness recommendation right after generation', () => {
    renderChartAssist(makeDocWithFreshProvenance());
    expect(
      screen.queryByText(/tempo grid changed after transcription/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: /keep as-is/i}),
    ).not.toBeInTheDocument();
  });

  it('a tempo edit flags the transcription card stale', () => {
    renderChartAssist(makeDocWithFreshProvenance());
    fireEvent.click(screen.getByRole('button', {name: /edit tempo/i}));
    expect(
      screen.getByText(/tempo grid changed after transcription/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {name: /keep as-is/i}),
    ).toBeInTheDocument();
  });

  it('Keep as-is dismisses the recommendation until the next tempo edit', () => {
    renderChartAssist(makeDocWithFreshProvenance());
    fireEvent.click(screen.getByRole('button', {name: /edit tempo/i}));
    expect(
      screen.getByText(/tempo grid changed after transcription/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /keep as-is/i}));
    expect(
      screen.queryByText(/tempo grid changed after transcription/i),
    ).not.toBeInTheDocument();

    // A second tempo edit re-flags it — the ack only covers the stamp it
    // was clicked against.
    fireEvent.click(screen.getByRole('button', {name: /edit tempo/i}));
    expect(
      screen.getByText(/tempo grid changed after transcription/i),
    ).toBeInTheDocument();
  });
});

describe('ChartAssist leading-silence recommendation', () => {
  /** A chart whose opening tempo marker is a synthetic collapse construct —
   *  the detector's `first-bpm-outlier` trigger. */
  function makeCollapsedLeadInDoc(): ChartDocument {
    const doc = makeDoc();
    doc.parsedChart.tempos = [
      {tick: 0, beatsPerMinute: 6000, msTime: 0},
      {tick: 480, beatsPerMinute: 120, msTime: 0},
    ];
    return doc;
  }

  it('calls out a collapsed lead-in on the Add leading silence card', () => {
    renderChartAssist(makeCollapsedLeadInDoc());
    const card = screen.getByRole('group', {name: 'Add leading silence'});
    expect(
      within(card).getByText(/collapsed lead-in rather than real tempo/i),
    ).toBeInTheDocument();
  });

  it('says nothing on a chart that already has its lead-in', () => {
    renderChartAssist(makeDoc());
    const card = screen.getByRole('group', {name: 'Add leading silence'});
    expect(
      within(card).queryByText(/collapsed lead-in/i),
    ).not.toBeInTheDocument();
  });

  it('adding leading silence does not flag the drum transcription stale', () => {
    // The whole grid shifts by one fixed pad and the drums shift with it, so
    // nothing landed on a different beat — flagging staleness here would be
    // a false alarm on a routine action.
    renderChartAssist(makeDocWithFreshProvenance());
    fireEvent.click(screen.getByRole('button', {name: /add leading silence/i}));
    expect(
      screen.queryByText(/tempo grid changed after transcription/i),
    ).not.toBeInTheDocument();
  });
});

describe('ChartAssist Learn more', () => {
  it('opens and closes with the Drum transcription copy', () => {
    renderChartAssist(makeDocWithFreshProvenance());
    const drumsCard = screen.getByRole('group', {name: 'Drum transcription'});
    fireEvent.click(
      within(drumsCard).getByRole('button', {name: /learn more/i}),
    );

    expect(
      screen.getByRole('heading', {name: /drum transcription/i}),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/writes the expert drum chart for you/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /got it/i}));
    expect(
      screen.queryByRole('heading', {name: /drum transcription/i}),
    ).not.toBeInTheDocument();
  });
});

describe('ChartAssist inline run', () => {
  it('Re-run expands the Drum transcription card into a step list, keeps siblings interactive, applies the result, and clears staleness', async () => {
    renderChartAssist(makeDocWithFreshProvenance());

    clickAndConfirm(/^re-run$/i, /^re-run$/i);

    await waitFor(() =>
      expect(
        screen.getByRole('list', {name: /progress steps/i}),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/transcribing drums/i)).toBeInTheDocument();

    // Sibling card stays interactive while the run is in flight (wired with
    // `loadAudio` above so its action isn't disabled for an unrelated
    // reason).
    expect(
      screen.getByRole('button', {name: /generate tempo map/i}),
    ).toBeEnabled();

    expect(capturedTranscribe).not.toBeNull();
    const resolution = 480;
    capturedTranscribe!.resolve({
      notes: [
        {tick: 0, type: noteTypes.kick},
        {tick: 480, type: noteTypes.redDrum},
      ],
      sync: {
        resolution,
        tempos: [{tick: 0, beatsPerMinute: 150}],
        timeSignatures: [{tick: 0, numerator: 4, denominator: 4}],
      },
    });

    await waitFor(() =>
      expect(
        screen.getByText(/2 notes on drums · expert/i),
      ).toBeInTheDocument(),
    );
    // Freshly re-transcribed against the tempo map it just used: not stale.
    expect(
      screen.queryByText(/tempo grid changed after transcription/i),
    ).not.toBeInTheDocument();
  });

  it('Generate tempo map runs the task on loaded audio and applies the resulting sync track', async () => {
    let loadedBytes: Uint8Array | null = null;
    renderChartAssist(makeDocWithFreshProvenance(), DRUM_EDIT_CAPABILITIES, {
      ...FULL_WIRING,
      loadAudio: async () => ({
        loadOriginalBytes: async () => {
          loadedBytes = new Uint8Array([1, 2, 3, 4]);
          return loadedBytes;
        },
      }),
    });

    fireEvent.click(screen.getByRole('button', {name: /generate tempo map/i}));

    await waitFor(() => expect(capturedTempo).not.toBeNull());
    await waitFor(() =>
      expect(screen.getByText(/building the tempo map/i)).toBeInTheDocument(),
    );

    capturedTempo!.resolve({
      synctrack: {
        origin_ms: 0,
        tempos: [{ms: 0, bpm: 128}],
        timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
      },
      meterStats: null,
      drumOnsetOffsetMs: null,
    });

    // Tempo edit invalidates the (fresh) drum transcription, per Design C —
    // this doubles as proof `ReplaceTempoMapCommand` actually applied.
    await waitFor(() =>
      expect(
        screen.getByText(/tempo grid changed after transcription/i),
      ).toBeInTheDocument(),
    );
    // The host's audio reached the task lazily: nothing was read to start
    // the run, and the loader the task got is the host's.
    const ctxAudio = (
      capturedTempo!.ctx as {
        audio: {loadOriginalBytes: () => Promise<Uint8Array>};
      }
    ).audio;
    expect(loadedBytes).toBeNull();
    await expect(ctxAudio.loadOriginalBytes()).resolves.toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it('a completed run records provenance, so a later tempo edit flags staleness', async () => {
    // The doc starts with NO provenance (a chart that reached the editor
    // without one): nothing is stale, because nothing claims to have been
    // generated. The run itself is what writes the record — no separate
    // bookkeeping command at the call site.
    renderChartAssist(makeDoc());

    fireEvent.click(screen.getByRole('button', {name: /edit tempo/i}));
    expect(
      screen.queryByText(/tempo grid changed after transcription/i),
    ).not.toBeInTheDocument();

    clickAndConfirm(/^re-run$/i, /^re-run$/i);
    await waitFor(() => expect(capturedTranscribe).not.toBeNull());
    capturedTranscribe!.resolve({
      notes: [{tick: 0, type: noteTypes.kick}],
      sync: {
        resolution: 480,
        tempos: [{tick: 0, beatsPerMinute: 150}],
        timeSignatures: [{tick: 0, numerator: 4, denominator: 4}],
      },
    });
    await waitFor(() =>
      expect(
        screen.getByText(/1 notes on drums · expert/i),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', {name: /edit tempo/i}));
    expect(
      screen.getByText(/tempo grid changed after transcription/i),
    ).toBeInTheDocument();
  });

  it('cancel shows "Cancelled." inline and applies nothing', async () => {
    renderChartAssist(makeDocWithFreshProvenance());

    clickAndConfirm(/^re-run$/i, /^re-run$/i);
    await waitFor(() =>
      expect(
        screen.getByRole('list', {name: /progress steps/i}),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', {name: /^cancel$/i}));

    await waitFor(() =>
      expect(screen.getByText(/^cancelled\.$/i)).toBeInTheDocument(),
    );
    // Nothing applied: note count and staleness are unchanged.
    expect(screen.getByText(/1 notes on drums · expert/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/tempo grid changed after transcription/i),
    ).not.toBeInTheDocument();
  });
});
