/**
 * @jest-environment jsdom
 */
/**
 * Difficulty generation, end to end through the Chart Matrix row and the
 * Chart Assist recommendation card (plan 0074 Phase 4, task 4c).
 *
 * `generateDifficultiesTask` and `buildDifficultyGenerationInput` are mocked
 * down to a controllable stub — the task's own reduction/worker behavior has
 * its own suites
 * (`lib/assist/__tests__/difficulty-client.test.ts`,
 * `difficulty-worker-logic.test.ts`) and `GenerateDifficultiesCommand`'s own
 * doc mutation has its own suite (`generate-difficulties-command.test.ts`).
 * What's under test here is the wiring: the matrix row's Generate/
 * Re-generate affordances, the Chart Assist recommendation card, the
 * shared assist runner driving both through the same run, and the
 * undo/staleness/ack behavior that follows from a real run applying a real
 * command against the real reducer.
 *
 * Delete H/M/E is not offered from the matrix row: it lives on the
 * difficulty-generation Chart Assist card (plan 0076 item 8), asserted
 * below alongside the card's other actions.
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
import {noteTypes} from '@eliwhite/scan-chart';
import type {ChartDocument} from '@/lib/chart-edit';
import {TooltipProvider} from '@/components/ui/tooltip';

import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {useExecuteCommand, useUndoRedo} from '../hooks/useEditCommands';
import {AddNoteCommand, GenerateDifficultiesCommand} from '../commands';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '../scope';
import {DRUM_EDIT_CAPABILITIES} from '../capabilities';
import {emptyTrackData, makeFixtureDoc} from './fixtures';
import {computeTrackStamp} from '@/lib/chart-editor-core/content-stamps';

interface CapturedRun {
  ctx: unknown;
  signal: AbortSignal;
  resolve: (result: unknown) => void;
  reject: (err: unknown) => void;
}

let captured: CapturedRun | null = null;
let buildInputCalls: Array<{instrument: string}> = [];

jest.mock('../../../lib/assist/difficulty-input', () => ({
  buildDifficultyGenerationInput: (_doc: unknown, instrument: string) => {
    buildInputCalls.push({instrument});
    return {ok: true, input: {instrument, stub: true}};
  },
}));

jest.mock('../../../lib/assist/tasks/generate-difficulties', () => ({
  generateDifficultiesTask: {
    key: 'generate-difficulties',
    title: 'Difficulty generation',
    planSteps: async () => [
      {key: 'reduce', label: 'Reducing Expert to Hard, Medium, Easy'},
    ],
    run: (ctx: unknown, signal: AbortSignal) =>
      new Promise((resolve, reject) => {
        captured = {ctx, signal, resolve, reject};
        signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      }),
  },
}));

import ChartMatrix from '../sidebar/ChartMatrix';
import ChartAssist from '../sidebar/ChartAssist';
import {AssistRunnerProvider} from '@/components/assist/AssistRunnerProvider';

function tier() {
  return {
    notes: [{tick: 0, type: noteTypes.kick, length: 0, flags: 0}],
    starPowerSections: [],
    rejectedStarPowerSections: [],
    soloSections: [],
    flexLanes: [],
  };
}

function tiers() {
  return {hard: tier(), medium: tier(), easy: tier()};
}

/** `makeFixtureDoc` with Drums Hard/Medium/Easy already generated from its
 *  current Expert track, so staleness starts false. */
function makeGeneratedDoc(): ChartDocument {
  const doc = makeFixtureDoc();
  return new GenerateDifficultiesCommand(
    'drums',
    tiers(),
    computeTrackStamp(doc.parsedChart.trackData[0]),
  ).execute(doc);
}

/** `makeFixtureDoc` plus an Expert track for `instrument`, so its matrix row
 *  renders with a Generate affordance. */
function makeDocWith(instrument: 'guitar' | 'bass'): ChartDocument {
  const doc = makeFixtureDoc();
  const track = emptyTrackData(instrument, 'expert');
  track.noteEventGroups.push([
    {
      tick: 0,
      msTime: 0,
      length: 0,
      msLength: 0,
      type: noteTypes.green,
      flags: 0,
    },
  ]);
  doc.parsedChart.trackData.push(track);
  return doc;
}

function Harness({doc}: {doc: ChartDocument}) {
  const {dispatch} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();
  const {undo, redo} = useUndoRedo();
  // A distinct tick each click, so repeated clicks each produce a genuinely
  // different Expert content stamp (re-inserting the exact same note twice
  // would leave the stamp unchanged, per `computeTrackStamp`'s note-content
  // hash, and never re-flag staleness after a "Keep as-is" ack).
  const editTick = useRef(2400);
  useEffect(() => {
    dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div>
      <button
        onClick={() => {
          executeCommand(
            new AddNoteCommand(
              {
                tick: editTick.current,
                type: noteTypes.kick,
                length: 0,
                flags: 0,
              },
              {instrument: 'drums', difficulty: 'expert'},
            ),
          );
          editTick.current += 480;
        }}>
        edit expert
      </button>
      <button onClick={undo}>undo</button>
      <button onClick={redo}>redo</button>
      <ChartMatrix />
      <ChartAssist />
    </div>
  );
}

function renderEditor(doc: ChartDocument) {
  return render(
    <TooltipProvider>
      <AssistRunnerProvider>
        <ChartEditorProvider
          capabilities={DRUM_EDIT_CAPABILITIES}
          activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
          <Harness doc={doc} />
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
  captured = null;
  buildInputCalls = [];
});

describe('Generate H · M · E', () => {
  it('fills the H/M/E cells (visible, toggleable), and undo removes them with their provenance', async () => {
    renderEditor(makeFixtureDoc());

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Generate Drums Hard, Medium, Easy difficulties',
      }),
    );

    expect(buildInputCalls).toEqual([{instrument: 'drums'}]);
    await waitFor(() => expect(captured).not.toBeNull());

    captured!.resolve({tiers: tiers()});

    const hardCell = await screen.findByRole('button', {name: 'Drums Hard'});
    expect(hardCell).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', {name: 'Drums Medium'})).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', {name: 'Drums Easy'})).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Toggleable like any other cell.
    fireEvent.click(hardCell);
    expect(hardCell).toHaveAttribute('aria-pressed', 'false');

    // Undo removes the generated tracks (and, per
    // `generate-difficulties-command.test.ts`, their provenance) in one
    // step — the Generate affordance comes back.
    fireEvent.click(screen.getByRole('button', {name: 'undo'}));
    expect(
      screen.queryByRole('button', {name: 'Drums Hard'}),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Generate Drums Hard, Medium, Easy difficulties',
      }),
    ).toBeInTheDocument();
  });

  it('shows the inline run card with Cancel while running', async () => {
    renderEditor(makeFixtureDoc());

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Generate Drums Hard, Medium, Easy difficulties',
      }),
    );
    await waitFor(() => expect(captured).not.toBeNull());

    await waitFor(() =>
      expect(
        screen.getByRole('list', {name: /progress steps/i}),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/reducing expert to hard, medium, easy/i),
    ).toBeInTheDocument();
    // The Expert cell stays interactive; the row has no other cells yet.
    expect(
      screen.getByRole('button', {name: 'Drums Expert'}),
    ).not.toBeDisabled();
  });

  it('locks the H/M/E cells (not Expert) while a re-generation is running', async () => {
    renderEditor(makeGeneratedDoc());
    fireEvent.click(screen.getByRole('button', {name: 'edit expert'}));

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Re-generate Drums Hard, Medium, Easy difficulties',
      }),
    );
    await waitFor(() => expect(captured).not.toBeNull());

    await waitFor(() =>
      expect(screen.getByRole('button', {name: 'Drums Hard'})).toBeDisabled(),
    );
    expect(screen.getByRole('button', {name: 'Drums Medium'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Drums Easy'})).toBeDisabled();
    expect(
      screen.getByRole('button', {name: 'Drums Expert'}),
    ).not.toBeDisabled();
  });

  it('redo after undo reinstalls the generated set', async () => {
    renderEditor(makeFixtureDoc());

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Generate Drums Hard, Medium, Easy difficulties',
      }),
    );
    await waitFor(() => expect(captured).not.toBeNull());
    captured!.resolve({tiers: tiers()});
    await screen.findByRole('button', {name: 'Drums Hard'});

    fireEvent.click(screen.getByRole('button', {name: 'undo'}));
    expect(
      screen.queryByRole('button', {name: 'Drums Hard'}),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'redo'}));
    expect(
      screen.getByRole('button', {name: 'Drums Hard'}),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Generate Drums Hard, Medium, Easy difficulties',
      }),
    ).not.toBeInTheDocument();
  });

  it('refuses a second instruments run while one is in flight, leaving the first run card and Cancel alone', async () => {
    renderEditor(makeDocWith('guitar'));

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Generate Drums Hard, Medium, Easy difficulties',
      }),
    );
    await waitFor(() => expect(captured).not.toBeNull());
    const drumsRun = captured!;

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Generate Guitar Hard, Medium, Easy difficulties',
      }),
    );

    // No second run was started, and the first run keeps its progress card
    // and its only Cancel affordance.
    expect(buildInputCalls).toEqual([{instrument: 'drums'}]);
    expect(captured).toBe(drumsRun);
    expect(screen.getByRole('button', {name: /^cancel$/i})).toBeInTheDocument();
  });

  it('offers Generate for an instrument with only part of the lower set charted', () => {
    const doc = makeFixtureDoc();
    doc.parsedChart.trackData.push(emptyTrackData('drums', 'hard'));
    renderEditor(doc);

    expect(
      screen.getByRole('button', {
        name: 'Generate Drums Hard, Medium, Easy difficulties',
      }),
    ).toBeEnabled();
  });

  it('enables Generate for bass (owner-validated guitar-reducer reuse, 2026-08-03)', async () => {
    renderEditor(makeDocWith('bass'));

    const generate = screen.getByRole('button', {
      name: 'Generate Bass Hard, Medium, Easy difficulties',
    });
    expect(generate).toBeEnabled();

    fireEvent.click(generate);
    await waitFor(() =>
      expect(buildInputCalls).toEqual([{instrument: 'bass'}]),
    );
    expect(captured).not.toBeNull();
  });

  it('cancel mid-generation applies nothing and unlocks the row', async () => {
    renderEditor(makeFixtureDoc());

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Generate Drums Hard, Medium, Easy difficulties',
      }),
    );
    await waitFor(() => expect(captured).not.toBeNull());
    await waitFor(() =>
      expect(
        screen.getByRole('button', {name: /^cancel$/i}),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', {name: /^cancel$/i}));

    await waitFor(() =>
      expect(screen.getByText(/^cancelled\.$/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', {name: 'Drums Hard'}),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Generate Drums Hard, Medium, Easy difficulties',
      }),
    ).toBeInTheDocument();
  });
});

describe('Staleness: Expert edit after generation', () => {
  it('shows no Re-generate bar or Chart Assist card right after generation', () => {
    renderEditor(makeGeneratedDoc());
    expect(
      screen.queryByRole('button', {name: /re-generate drums/i}),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('group', {name: 'Drums difficulty'}),
    ).not.toBeInTheDocument();
  });

  it('an Expert edit flags the row amber and shows the Chart Assist card', () => {
    renderEditor(makeGeneratedDoc());

    fireEvent.click(screen.getByRole('button', {name: 'edit expert'}));

    expect(
      screen.getByRole('button', {
        name: 'Re-generate Drums Hard, Medium, Easy difficulties',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', {name: 'Drums difficulty'}),
    ).toBeInTheDocument();
  });

  it('uses the shared drums.png icon (plan 0076 item 9), not a generic glyph', () => {
    renderEditor(makeGeneratedDoc());
    fireEvent.click(screen.getByRole('button', {name: 'edit expert'}));

    const card = screen.getByRole('group', {name: 'Drums difficulty'});
    // Decorative (`alt=""`, `aria-hidden`), so it's outside the accessibility
    // tree `getByRole` would query — assert on the DOM directly.
    const img = card.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toContain(
      encodeURIComponent('/assets/instruments/drums.png'),
    );
  });

  it('Keep as-is dismisses both until the next Expert edit', () => {
    renderEditor(makeGeneratedDoc());
    fireEvent.click(screen.getByRole('button', {name: 'edit expert'}));
    expect(
      screen.getByRole('group', {name: 'Drums difficulty'}),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /keep as-is/i}));

    expect(
      screen.queryByRole('group', {name: 'Drums difficulty'}),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: /re-generate drums/i}),
    ).not.toBeInTheDocument();

    // A second edit re-flags it — the ack only covers the stamp it was
    // clicked against.
    fireEvent.click(screen.getByRole('button', {name: 'edit expert'}));
    expect(
      screen.getByRole('group', {name: 'Drums difficulty'}),
    ).toBeInTheDocument();
  });

  it('Re-generate from the CARD locks the rows cells', async () => {
    // The matrix row and the assist card are separately mounted consumers of
    // the same run. A run started on one has to be visible to the other, so
    // the row's H/M/E cells lock while the card's run is in flight.
    renderEditor(makeGeneratedDoc());
    fireEvent.click(screen.getByRole('button', {name: 'edit expert'}));

    fireEvent.click(screen.getByRole('button', {name: /^re-generate$/i}));
    await waitFor(() => expect(captured).not.toBeNull());

    await waitFor(() =>
      expect(screen.getByRole('button', {name: 'Drums Hard'})).toBeDisabled(),
    );
    expect(screen.getByRole('button', {name: 'Drums Medium'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Drums Easy'})).toBeDisabled();

    captured!.resolve({tiers: tiers()});
    await waitFor(() =>
      expect(
        screen.getByRole('button', {name: 'Drums Hard'}),
      ).not.toBeDisabled(),
    );
  });

  it('Re-generate (from the row) clears the staleness prompt', async () => {
    renderEditor(makeGeneratedDoc());
    fireEvent.click(screen.getByRole('button', {name: 'edit expert'}));

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Re-generate Drums Hard, Medium, Easy difficulties',
      }),
    );
    await waitFor(() => expect(captured).not.toBeNull());
    captured!.resolve({tiers: tiers()});

    await waitFor(() =>
      expect(
        screen.queryByRole('group', {name: 'Drums difficulty'}),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', {name: /re-generate drums/i}),
    ).not.toBeInTheDocument();
  });
});

// Delete H/M/E moved off the matrix row (plan 0076 item 8) onto the
// difficulty-generation Chart Assist card, which owns its own delete suite.
describe('Delete H/M/E from the Chart Assist card', () => {
  it('offers Delete alongside Re-generate/Keep-as-is once the card is showing', () => {
    renderEditor(makeGeneratedDoc());
    fireEvent.click(screen.getByRole('button', {name: 'edit expert'}));

    const card = screen.getByRole('group', {name: 'Drums difficulty'});
    expect(
      within(card).getByRole('button', {name: /^delete$/i}),
    ).toBeInTheDocument();
  });

  it('cancelling the confirm leaves the generated set untouched', () => {
    renderEditor(makeGeneratedDoc());
    fireEvent.click(screen.getByRole('button', {name: 'edit expert'}));

    fireEvent.click(screen.getByRole('button', {name: /^delete$/i}));
    fireEvent.click(screen.getByRole('button', {name: /^cancel$/i}));

    expect(
      screen.getByRole('button', {name: 'Drums Hard'}),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', {name: 'Drums difficulty'}),
    ).toBeInTheDocument();
  });

  it('confirming deletes the H/M/E tracks, drops their visibility, and clears the card', () => {
    renderEditor(makeGeneratedDoc());
    fireEvent.click(screen.getByRole('button', {name: 'edit expert'}));

    clickAndConfirm(/^delete$/i, /^delete$/i);

    expect(
      screen.queryByRole('button', {name: 'Drums Hard'}),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: 'Drums Medium'}),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: 'Drums Easy'}),
    ).not.toBeInTheDocument();
    // Nothing left to be stale about: the card is gone, and the matrix row's
    // Generate affordance is back (the same state as never having generated).
    expect(
      screen.queryByRole('group', {name: 'Drums difficulty'}),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Generate Drums Hard, Medium, Easy difficulties',
      }),
    ).toBeInTheDocument();
  });

  it('undo restores the deleted tracks', () => {
    renderEditor(makeGeneratedDoc());
    fireEvent.click(screen.getByRole('button', {name: 'edit expert'}));

    clickAndConfirm(/^delete$/i, /^delete$/i);
    expect(
      screen.queryByRole('button', {name: 'Drums Hard'}),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'undo'}));
    expect(
      screen.getByRole('button', {name: 'Drums Hard'}),
    ).toBeInTheDocument();
  });
});
