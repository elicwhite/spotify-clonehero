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
import {addDrumNote, addSection} from '@/lib/chart-edit';
import {
  computeTempoStamp,
  setTempoStamp,
  withAssistProvenance,
} from '@/lib/chart-editor-core';
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

jest.mock('../../../lib/assist/tasks/transcribe-drums', () => ({
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
}));

jest.mock('../../../lib/assist/tasks/generate-tempo-map', () => ({
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
    tempoDerived: {'drum-transcription': {tempoStamp: computeTempoStamp(doc)}},
  });
}

/**
 * A doc carrying section markers. `generated: true` stamps them as this
 * task's own output (what a `generate-sections` run writes); without it they
 * are the charter's hand-written titles, which is a different card state.
 */
function makeDocWithSections(
  names: string[],
  {generated}: {generated: boolean},
): ChartDocument {
  const doc = makeDocWithFreshProvenance();
  names.forEach((name, index) => addSection(doc, index * 1920, name));
  return generated ? setTempoStamp(doc, 'sections') : doc;
}

/** Every card `DRUM_EDIT_CAPABILITIES` + full wiring renders, by the
 *  accessible name of its `group`. */
const ALL_CARD_NAMES = [
  'Tempo map',
  'Sections',
  'Add leading silence',
  'Drum transcription',
  'Lyrics',
];

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
  audioBusyReason?: string | undefined;
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
 * What a host with the chart package's audio but neither padded playback nor
 * a drum-transcription project supplies — the difficulty-generation flow
 * (`components/difficulty-generation/DifficultyGenerationFlow.tsx`), whose
 * reasons these strings mirror. The leading-silence card still renders with
 * its action dead: the point of the disabled-with-a-reason path is that a
 * card's status and recommendation are worth showing even where its action
 * can't run. Drum transcription is the other case — it separates its own
 * drum stem out of `loadAudio`'s mix, so a host reason about missing stems
 * doesn't apply to it and its action stays live.
 */
const DISABLED_ACTIONS_WIRING: Wiring = {
  loadAudio: async () => ({
    loadOriginalBytes: async () => new Uint8Array(4),
  }),
  audioSampleRate: 44100,
  leadingSilenceDisabledReason:
    "Can't pad this editor's audio to match a shifted chart yet.",
  drumRerunDisabledReason: 'No separated drum audio to re-run from.',
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
    for (const name of ALL_CARD_NAMES) {
      expect(screen.getByRole('group', {name})).toBeInTheDocument();
    }
    // Nothing beyond the enumerated set, so a card added without a test
    // fails here instead of shipping unasserted.
    expect(screen.getAllByRole('group')).toHaveLength(ALL_CARD_NAMES.length);
  });

  it('renders Tempo map + Sections + Add leading silence under TEMPO_CAPABILITIES', () => {
    renderChartAssist(makeDocWithFreshProvenance(), TEMPO_CAPABILITIES);
    expect(screen.getByRole('group', {name: 'Tempo map'})).toBeInTheDocument();
    // Sections rides the same wiring as Tempo map (a runner plus the song's
    // audio), so a tempo-only host gets it too.
    expect(screen.getByRole('group', {name: 'Sections'})).toBeInTheDocument();
    expect(
      screen.getByRole('group', {name: 'Add leading silence'}),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('group', {name: 'Drum transcription'}),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('group', {name: 'Lyrics'}),
    ).not.toBeInTheDocument();
  });

  it('renders only the Lyrics card under ADD_LYRICS_CAPABILITIES', () => {
    renderChartAssist(makeDocWithFreshProvenance(), ADD_LYRICS_CAPABILITIES);
    expect(screen.getByRole('group', {name: 'Lyrics'})).toBeInTheDocument();
    expect(screen.getAllByRole('group')).toHaveLength(1);
  });

  it('renders nothing under PREVIEW_CAPABILITIES', () => {
    renderChartAssist(makeDocWithFreshProvenance(), PREVIEW_CAPABILITIES);
    expect(screen.queryByText('Chart Assist')).not.toBeInTheDocument();
  });
});

/**
 * A chart loaded from a file, with its own audio but no drum-transcription
 * project behind it and no way to pad the audio it plays and exports (the
 * difficulty-generation flow). The audio-backed cards run; the one action
 * this host can't perform renders disabled with a reason, and no card is
 * silently missing.
 */
describe('ChartAssist where the host disables an action', () => {
  function renderTrackEdit(doc = makeDoc()) {
    return renderChartAssist(
      doc,
      DRUM_EDIT_CAPABILITIES,
      DISABLED_ACTIONS_WIRING,
    );
  }

  it('renders every card', () => {
    renderTrackEdit();
    for (const name of ALL_CARD_NAMES) {
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
      /can't pad this editor's audio/i,
    );
  });

  it('keeps drum transcription live despite a host reason about missing stems', () => {
    renderTrackEdit();
    const button = screen.getByRole('button', {name: /^run$/i});
    expect(button).toBeEnabled();
    expect(button).not.toHaveAccessibleDescription(/no separated drum audio/i);
  });

  // The run separates its drums out of the host's audio, so it waits out a
  // padded-audio rebuild exactly like the tempo map does.
  it('disables drum transcription while the host rebuilds its audio', () => {
    renderChartAssist(makeDoc(), DRUM_EDIT_CAPABILITIES, {
      ...DISABLED_ACTIONS_WIRING,
      audioBusyReason: 'Rebuilding audio',
    });
    const button = screen.getByRole('button', {name: /^run$/i});
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/rebuilding audio/i);
  });

  it('keeps the staleness prompt and Keep as-is working', () => {
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

/**
 * The Sections card (plan 0076 item 23). Sections are their own artifact now,
 * so the card has three states a tempo-map run no longer decides for it: no
 * markers at all, markers the charter wrote, and markers this task generated
 * (which alone can go stale).
 */
describe('ChartAssist Sections card', () => {
  function sectionsCard(): HTMLElement {
    return screen.getByRole('group', {name: 'Sections'});
  }

  it('offers Generate on a chart that has no sections', () => {
    renderChartAssist(makeDocWithFreshProvenance());
    const card = sectionsCard();
    expect(within(card).getByText('0 sections')).toBeInTheDocument();
    expect(
      within(card).getByRole('button', {name: /^generate$/i}),
    ).toBeEnabled();
    expect(within(card).queryByText(/already has section titles/i)).toBeNull();
  });

  it('keeps the same Generate label and warns about hand-written titles', () => {
    renderChartAssist(makeDocWithSections(['Intro'], {generated: false}));
    const card = sectionsCard();
    expect(within(card).getByText('1 section')).toBeInTheDocument();
    expect(
      within(card).getByRole('button', {name: /^generate$/i}),
    ).toBeEnabled();
    expect(
      within(card).getByText(/already has section titles you wrote/i),
    ).toBeInTheDocument();
    // Titles the charter wrote are not this task's to claim.
    expect(within(card).queryByText(/ai-labeled/i)).toBeNull();
  });

  it('claims an AI origin only for sections it generated, and says nothing about replacing them', () => {
    renderChartAssist(
      makeDocWithSections(['Intro', 'Verse 1'], {generated: true}),
    );
    const card = sectionsCard();
    // The badge and the count share one line, so the count is matched
    // within it rather than as an element of its own.
    expect(within(card).getByText(/2 sections/)).toBeInTheDocument();
    expect(within(card).getByText(/ai-labeled/i)).toBeInTheDocument();
    expect(within(card).queryByText(/already has section titles/i)).toBeNull();
  });

  it('flags generated sections stale after a tempo edit, and "Keep as-is" dismisses it', () => {
    renderChartAssist(makeDocWithSections(['Intro'], {generated: true}));
    expect(
      within(sectionsCard()).queryByText(/may sit on the wrong bars/i),
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', {name: /edit tempo/i}));
    expect(
      within(sectionsCard()).getByText(/may sit on the wrong bars/i),
    ).toBeInTheDocument();

    fireEvent.click(
      within(sectionsCard()).getByRole('button', {name: /keep as-is/i}),
    );
    expect(
      within(sectionsCard()).queryByText(/may sit on the wrong bars/i),
    ).toBeNull();
  });

  it('leaves hand-written sections unflagged by a tempo edit', () => {
    // No provenance for them, so there is no generated artifact to call
    // stale — the charter placed those markers deliberately.
    renderChartAssist(makeDocWithSections(['Intro'], {generated: false}));
    fireEvent.click(screen.getByRole('button', {name: /edit tempo/i}));
    expect(
      within(sectionsCard()).queryByText(/may sit on the wrong bars/i),
    ).toBeNull();
  });
});

describe('ChartAssist Lyrics card copy (plan 0076 item 13)', () => {
  it('is titled just "Lyrics", never says karaoke or calls itself vocals', () => {
    renderChartAssist(makeDocWithFreshProvenance());
    const card = screen.getByRole('group', {name: 'Lyrics'});
    expect(within(card).queryByText(/karaoke/i)).not.toBeInTheDocument();
    expect(within(card).queryByText(/\bvocals\b/i)).not.toBeInTheDocument();
    // Uses the shared vocals.png icon (item 9), not a lucide glyph.
    const img = card.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toContain(
      encodeURIComponent('/assets/instruments/vocals.png'),
    );
  });
});

/**
 * Every card lays its CTA row and its "Learn more" row out the same way, no
 * matter how long the CTA label is or how many actions the card offers. The
 * observable contract is that "Learn more" never shares a parent with any
 * other button: if it did, whether it wrapped to a second line would depend
 * on the CTA's label width, which is exactly the inconsistency the split row
 * removes.
 */
describe('ChartAssist card action layout', () => {
  it('gives "Learn more" a row of its own on every card', () => {
    renderChartAssist(makeDocWithFreshProvenance());

    const cards = screen.getAllByRole('group');
    expect(cards).toHaveLength(ALL_CARD_NAMES.length);

    for (const card of cards) {
      const learnMore = within(card).getByRole('button', {
        name: /learn more/i,
      });
      const row = learnMore.parentElement;
      expect(row).not.toBeNull();
      expect(row!.querySelectorAll('button')).toHaveLength(1);
      // ...and the card's own actions all live in a different row.
      const actions = within(card)
        .getAllByRole('button')
        .filter(button => button !== learnMore);
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(row!.contains(action)).toBe(false);
      }
    }
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
      screen.getByText(/we isolate the drums out of the mix/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /got it/i}));
    expect(
      screen.queryByRole('heading', {name: /drum transcription/i}),
    ).not.toBeInTheDocument();
  });
});

describe('ChartAssist inline run', () => {
  it('Run expands the Drum transcription card into a step list, keeps siblings interactive, applies the result, and clears staleness', async () => {
    renderChartAssist(makeDocWithFreshProvenance());

    clickAndConfirm(/^run$/i, /^run$/i);

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

    clickAndConfirm(/^run$/i, /^run$/i);
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

    clickAndConfirm(/^run$/i, /^run$/i);
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
