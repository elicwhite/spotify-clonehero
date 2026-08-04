/**
 * @jest-environment jsdom
 */
/**
 * Chart Matrix (plan 0074 Phase 3, Design C, task 3a).
 *
 * Under test: `ChartMatrix` itself — rows as a function of the chart's
 * present instruments and the `showChartMatrix` capability variant, the
 * single toggle interaction (`SET_TRACK_VISIBILITY`), "+ Add instrument" offering only absent instruments via
 * `AddTrackCommand`, and the disabled Phase-4 "Generate H · M · E"
 * affordance carrying its reason. Generation/deletion FLOWS are out of
 * scope this phase — the buttons are inert by design (Design D, Phase 4).
 *
 * `state.visibleTrackKeys` is the same state the stacked piano roll already
 * reads to decide which rows render (`PianoRollTimeline.tsx`) — asserting
 * against it here is asserting the exact thing that adds/removes a
 * piano-roll row, without pulling the canvas-based piano roll into this
 * suite.
 */

import '@testing-library/jest-dom';
import {useEffect} from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import {createEmptyChart, noteTypes} from '@eliwhite/scan-chart';
import type {ChartDocument} from '@/lib/chart-edit';
import {addDrumNote} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {TooltipProvider} from '@/components/ui/tooltip';

import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {
  DRUM_EDIT_CAPABILITIES,
  ADD_LYRICS_CAPABILITIES,
  PREVIEW_CAPABILITIES,
  TEMPO_CAPABILITIES,
  type EditorCapabilities,
} from '../capabilities';
import {DEFAULT_DRUMS_EXPERT_SCOPE, trackKeyId} from '../scope';
import ChartMatrix from '../sidebar/ChartMatrix';
import {GENERATION_NOT_WIRED_REASON} from '../hooks/useDifficultyGeneration';

/** Drums Expert (5 notes) + Guitar Expert (2 notes) — two rows, no lower
 *  difficulties on either, both fixture inputs the Generate/Add-instrument
 *  cases need. */
function makeTwoInstrumentDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  parsed.trackData.push(emptyTrackData('guitar', 'expert'));
  const doc: ChartDocument = {parsedChart: parsed, assets: []};
  addDrumNote(doc.parsedChart.trackData[0], {tick: 0, type: noteTypes.kick});
  addDrumNote(doc.parsedChart.trackData[0], {
    tick: 480,
    type: noteTypes.redDrum,
  });
  return doc;
}

function makeDrumsOnlyDoc(): ChartDocument {
  const parsed = createEmptyChart({bpm: 120, resolution: 480});
  parsed.trackData.push(emptyTrackData('drums', 'expert'));
  return {parsedChart: parsed, assets: []};
}

interface HarnessTrack {
  instrument: string;
  difficulty: string;
}

function Harness({
  doc,
  initialVisible = null,
}: {
  doc: ChartDocument;
  /** Overrides the doc-load default (the "preferred" track) wholesale, so
   *  tests can pin an exact starting visibility set regardless of which
   *  track `SET_CHART_DOC` would otherwise default to. */
  initialVisible?: HarnessTrack[] | null;
}) {
  const {dispatch, state} = useChartEditorContext();
  useEffect(() => {
    dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
    if (initialVisible) {
      dispatch({
        type: 'SET_VISIBLE_TRACKS',
        tracks: new Set(initialVisible.map(track => trackKeyId(track as any))),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div>
      <div data-testid="visible-tracks">
        {Array.from(state.visibleTrackKeys).sort().join(',')}
      </div>
      <ChartMatrix />
    </div>
  );
}

function renderMatrix(
  doc: ChartDocument,
  capabilities: EditorCapabilities = DRUM_EDIT_CAPABILITIES,
  initialVisible: HarnessTrack[] | null = null,
) {
  return render(
    <TooltipProvider>
      <ChartEditorProvider
        capabilities={capabilities}
        activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
        <Harness doc={doc} initialVisible={initialVisible} />
      </ChartEditorProvider>
    </TooltipProvider>,
  );
}

describe('ChartMatrix capability gating', () => {
  it('renders a row per present instrument under DRUM_EDIT (all)', () => {
    renderMatrix(makeTwoInstrumentDoc());
    expect(screen.getByText('Chart Matrix')).toBeInTheDocument();
    expect(screen.getByText('Drums')).toBeInTheDocument();
    expect(screen.getByText('Guitar')).toBeInTheDocument();
  });

  it('renders nothing under PREVIEW/TEMPO/ADD_LYRICS (showChartMatrix: false)', () => {
    for (const capabilities of [
      PREVIEW_CAPABILITIES,
      TEMPO_CAPABILITIES,
      ADD_LYRICS_CAPABILITIES,
    ]) {
      const {unmount} = renderMatrix(makeTwoInstrumentDoc(), capabilities);
      expect(screen.queryByText('Chart Matrix')).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe('ChartMatrix visibility toggle', () => {
  it('toggling a hidden cell adds it to visibleTrackKeys', () => {
    // A doc load defaults to one visible row (its "preferred" track — guitar
    // Expert here, since guitar Expert outranks drums Expert). Drums Expert
    // starts hidden.
    renderMatrix(makeTwoInstrumentDoc());
    expect(screen.getByTestId('visible-tracks')).toHaveTextContent(
      'guitar:expert',
    );
    expect(screen.getByRole('button', {name: 'Drums Expert'})).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    fireEvent.click(screen.getByRole('button', {name: 'Drums Expert'}));

    expect(screen.getByTestId('visible-tracks')).toHaveTextContent(
      'drums:expert,guitar:expert',
    );
    expect(screen.getByRole('button', {name: 'Drums Expert'})).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('toggling a visible cell removes it from visibleTrackKeys', () => {
    renderMatrix(makeTwoInstrumentDoc(), DRUM_EDIT_CAPABILITIES, [
      {instrument: 'guitar', difficulty: 'expert'},
      {instrument: 'drums', difficulty: 'expert'},
    ]);
    expect(screen.getByTestId('visible-tracks')).toHaveTextContent(
      'drums:expert,guitar:expert',
    );

    fireEvent.click(screen.getByRole('button', {name: 'Guitar Expert'}));

    expect(screen.getByTestId('visible-tracks')).toHaveTextContent(
      'drums:expert',
    );
    expect(screen.getByRole('button', {name: 'Guitar Expert'})).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('hides the last visible track too (visibility is unconditional)', () => {
    renderMatrix(makeTwoInstrumentDoc(), DRUM_EDIT_CAPABILITIES, [
      {instrument: 'drums', difficulty: 'expert'},
    ]);
    expect(screen.getByTestId('visible-tracks')).toHaveTextContent(
      'drums:expert',
    );

    fireEvent.click(screen.getByRole('button', {name: 'Drums Expert'}));

    expect(screen.getByTestId('visible-tracks')).toHaveTextContent('');
    expect(screen.getByRole('button', {name: 'Drums Expert'})).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('ChartMatrix instrument icons and no overflow menu (plan 0076 items 8/9)', () => {
  it('renders an instrument icon per row and no per-row overflow menu', () => {
    renderMatrix(makeTwoInstrumentDoc());

    // One InstrumentIcon per row, each pointed at that instrument's PNG.
    const drumsIcon = document.querySelector(
      'img[src*="drums.png"]',
    ) as HTMLImageElement | null;
    const guitarIcon = document.querySelector(
      'img[src*="guitar.png"]',
    ) as HTMLImageElement | null;
    expect(drumsIcon).not.toBeNull();
    expect(guitarIcon).not.toBeNull();

    // No overflow ("...") menu button on either row (plan 0076 item 8
    // removed it, along with the truncated name it caused).
    expect(
      screen.queryByRole('button', {name: /options$/i}),
    ).not.toBeInTheDocument();
  });

  it('renders the instrument name untruncated', () => {
    renderMatrix(makeTwoInstrumentDoc());

    const drumsLabel = screen.getByText('Drums');
    const guitarLabel = screen.getByText('Guitar');
    expect(drumsLabel.className).not.toMatch(/truncate/);
    expect(guitarLabel.className).not.toMatch(/truncate/);
  });
});

describe('ChartMatrix + Add instrument', () => {
  it('offers only absent instruments and adds a newly-visible Expert track', () => {
    renderMatrix(makeDrumsOnlyDoc());

    fireEvent.click(screen.getByRole('button', {name: /add instrument/i}));
    expect(screen.getByRole('button', {name: 'Guitar'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Bass'})).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {name: 'Drums'}),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Bass'}));

    // The new track exists, is shown as a row, and starts visible.
    expect(screen.getByText('Bass')).toBeInTheDocument();
    expect(screen.getByTestId('visible-tracks')).toHaveTextContent(
      'bass:expert',
    );
    expect(screen.getByRole('button', {name: 'Bass Expert'})).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows an instrument icon on each offered add-instrument option (plan 0076 item 9)', () => {
    renderMatrix(makeDrumsOnlyDoc());

    fireEvent.click(screen.getByRole('button', {name: /add instrument/i}));

    expect(document.querySelector('img[src*="guitar.png"]')).not.toBeNull();
    expect(document.querySelector('img[src*="bass.png"]')).not.toBeNull();
  });
});

describe('ChartMatrix grid placement', () => {
  // jsdom does not lay grid out, so the observable thing is the placement
  // contract itself: every item declares its own column and uncharted
  // difficulties emit nothing. Auto-placed items (an empty placeholder for an
  // uncharted difficulty) would push the spanning "Generate H · M · E" bar
  // onto a row of its own below the instrument's cells.
  it('places every item explicitly and emits no placeholder for an uncharted difficulty', () => {
    renderMatrix(makeTwoInstrumentDoc());

    const grid = screen.getByTestId('chart-matrix-grid');
    const items = Array.from(grid.children) as HTMLElement[];
    for (const item of items) {
      expect(item.style.gridColumn).not.toBe('');
    }

    // Header (1..5) + two Expert-only instruments, each contributing exactly
    // a label, one cell, and one Generate bar. No placeholders.
    expect(items).toHaveLength(5 + 2 * 3);
    expect(items.slice(0, 5).map(item => item.style.gridColumn)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]);

    // The Expert cell owns column 2, and the Generate bar covers H/M/E on the
    // SAME row rather than starting a new one.
    expect(
      screen.getByRole('button', {name: 'Guitar Expert'}).style.gridColumn,
    ).toBe('2');
    const generate = screen.getByRole('button', {
      name: 'Generate Guitar Hard, Medium, Easy difficulties',
    });
    expect(generate.closest('div')!.style.gridColumn).toBe('3 / 6');
  });

  it('places a partially-charted instrument on its true difficulty columns', () => {
    const doc = makeTwoInstrumentDoc();
    doc.parsedChart.trackData.push(emptyTrackData('guitar', 'medium'));
    renderMatrix(doc);

    // Medium keeps column 4 even though Hard is uncharted.
    expect(
      screen.getByRole('button', {name: 'Guitar Expert'}).style.gridColumn,
    ).toBe('2');
    expect(
      screen.getByRole('button', {name: 'Guitar Medium'}).style.gridColumn,
    ).toBe('4');
    expect(
      screen.queryByRole('button', {name: 'Guitar Hard'}),
    ).not.toBeInTheDocument();
  });
});

describe('ChartMatrix Generate H · M · E (no assist runner wired)', () => {
  it('renders the disabled Generate affordance with its reason when no lower difficulty is charted', () => {
    renderMatrix(makeTwoInstrumentDoc());

    const generate = screen.getByRole('button', {
      name: 'Generate Guitar Hard, Medium, Easy difficulties',
    });
    expect(generate).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getAllByText(GENERATION_NOT_WIRED_REASON).length,
    ).toBeGreaterThan(0);
  });

  it('keeps a Generate affordance for an instrument charted with only part of the lower set', () => {
    // Generation is set-shaped (it writes all three), so a Hard-only
    // instrument still has a way to ask for the set; the bar moves under the
    // cells instead of spanning the empty columns.
    const doc = makeTwoInstrumentDoc();
    doc.parsedChart.trackData.push(emptyTrackData('guitar', 'hard'));
    renderMatrix(doc);

    const generate = screen.getByRole('button', {
      name: 'Generate Guitar Hard, Medium, Easy difficulties',
    });
    // Disabled the same way the spanning bar is, so the reason stays
    // reachable by hover, by keyboard and by screen reader.
    expect(generate).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getAllByText(GENERATION_NOT_WIRED_REASON).length,
    ).toBeGreaterThan(0);
    // Under the cells, on the same three columns they occupy — the approved
    // prototype's `.gen-bar.under` span, not a full-width bar.
    expect(generate.parentElement!.style.gridColumn).toBe('3 / 6');
    expect(
      screen.getByRole('button', {name: 'Guitar Hard'}),
    ).toBeInTheDocument();
  });

  it('does not render Generate for an instrument charted with the whole lower set', () => {
    const doc = makeTwoInstrumentDoc();
    for (const difficulty of ['hard', 'medium', 'easy'] as const) {
      doc.parsedChart.trackData.push(emptyTrackData('guitar', difficulty));
    }
    renderMatrix(doc);

    expect(
      screen.queryByRole('button', {
        name: 'Generate Guitar Hard, Medium, Easy difficulties',
      }),
    ).not.toBeInTheDocument();
  });
});
