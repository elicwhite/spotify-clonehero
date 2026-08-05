/**
 * @jest-environment jsdom
 */
/**
 * Chart Matrix right-click context menu (plan 0077 item 6, OWNER OVERRIDE:
 * per-difficulty deletion). Covers what the plan's "Tests" line asks for:
 * the menu opening with the right items per surface (row label vs. cell,
 * with/without lower difficulties charted), each command applying and
 * undoing atomically, and the provenance/at-least-one-visible invariants
 * holding across a delete.
 */

import '@testing-library/jest-dom';
import path from 'node:path';
import fs from 'node:fs';
import {useEffect} from 'react';
import {render, screen, fireEvent, within} from '@testing-library/react';
import {createEmptyChart, noteTypes} from '@eliwhite/scan-chart';
import type {ChartDocument} from '@/lib/chart-edit';
import {addDrumNote} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {TooltipProvider} from '@/components/ui/tooltip';

import {
  ChartEditorProvider,
  useChartEditorContext,
} from '../ChartEditorContext';
import {useUndoRedo} from '../hooks/useEditCommands';
import {DEFAULT_DRUMS_EXPERT_SCOPE} from '../scope';
import ChartMatrix from '../sidebar/ChartMatrix';
import {GenerateDifficultiesCommand} from '../commands';
import {getAssistProvenance} from '@/lib/chart-editor-core';
import {computeTrackStamp} from '@/lib/chart-editor-core/content-stamps';

/** Drums Expert (2 notes) + Guitar Expert (1 note); no lower difficulties
 *  charted on either — the "no generated set" starting point most cases
 *  build from. */
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

/** Same doc, plus a generated Hard/Medium/Easy set for drums (provenance
 *  recorded against the drums Expert's stamp). */
function docWithGeneratedDrumLowers(): ChartDocument {
  const doc = makeTwoInstrumentDoc();
  const cmd = new GenerateDifficultiesCommand(
    'drums',
    {
      hard: {
        notes: [{tick: 0, type: noteTypes.kick, length: 0, flags: 0}],
        starPowerSections: [],
        rejectedStarPowerSections: [],
        soloSections: [],
        flexLanes: [],
      },
      medium: {
        notes: [{tick: 0, type: noteTypes.kick, length: 0, flags: 0}],
        starPowerSections: [],
        rejectedStarPowerSections: [],
        soloSections: [],
        flexLanes: [],
      },
      easy: {
        notes: [{tick: 0, type: noteTypes.kick, length: 0, flags: 0}],
        starPowerSections: [],
        rejectedStarPowerSections: [],
        soloSections: [],
        flexLanes: [],
      },
    },
    computeTrackStamp(doc.parsedChart.trackData[0]),
  );
  return cmd.execute(doc);
}

function Harness({doc}: {doc: ChartDocument}) {
  const {dispatch, state} = useChartEditorContext();
  const {undo} = useUndoRedo();
  useEffect(() => {
    dispatch({type: 'SET_CHART_DOC', chartDoc: doc});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div>
      <div data-testid="visible-tracks">
        {Array.from(state.visibleTrackKeys).sort().join(',')}
      </div>
      <div data-testid="drum-tracks">
        {(state.chartDoc?.parsedChart.trackData ?? [])
          .filter(t => t.instrument === 'drums')
          .map(t => t.difficulty)
          .sort()
          .join(',')}
      </div>
      <div data-testid="drums-provenance">
        {getAssistProvenance(state.chartDoc)?.difficulties?.drums
          ? 'has-record'
          : 'no-record'}
      </div>
      <button type="button" onClick={undo}>
        Undo
      </button>
      <ChartMatrix />
    </div>
  );
}

function renderMatrix(doc: ChartDocument) {
  return render(
    <TooltipProvider>
      <ChartEditorProvider activeScope={DEFAULT_DRUMS_EXPERT_SCOPE}>
        <Harness doc={doc} />
      </ChartEditorProvider>
    </TooltipProvider>,
  );
}

function openCellMenu(name: string) {
  fireEvent.contextMenu(screen.getByRole('button', {name}));
  return screen.getByTestId('chart-matrix-context-menu');
}

function openRowMenu(instrumentLabel: string) {
  fireEvent.contextMenu(screen.getByText(instrumentLabel));
  return screen.getByTestId('chart-matrix-context-menu');
}

describe('Chart Matrix context menu — items per surface', () => {
  it('a cell with no lower difficulties offers Delete difficulty and Delete instrument only', () => {
    renderMatrix(makeTwoInstrumentDoc());
    const menu = openCellMenu('Drums Expert');
    expect(
      within(menu).getByRole('button', {name: 'Delete difficulty'}),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole('button', {name: 'Delete instrument'}),
    ).toBeInTheDocument();
    expect(
      within(menu).queryByRole('button', {
        name: 'Delete all lower difficulties',
      }),
    ).not.toBeInTheDocument();
  });

  it('a cell with lower difficulties charted also offers Delete all lower difficulties', () => {
    renderMatrix(docWithGeneratedDrumLowers());
    const menu = openCellMenu('Drums Expert');
    expect(
      within(menu).getByRole('button', {name: 'Delete difficulty'}),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole('button', {
        name: 'Delete all lower difficulties',
      }),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole('button', {name: 'Delete instrument'}),
    ).toBeInTheDocument();
  });

  it('the row label never offers Delete difficulty, and offers lower-difficulties only when charted', () => {
    renderMatrix(makeTwoInstrumentDoc());
    const menu = openRowMenu('Drums');
    expect(
      within(menu).queryByRole('button', {name: 'Delete difficulty'}),
    ).not.toBeInTheDocument();
    expect(
      within(menu).getByRole('button', {name: 'Delete instrument'}),
    ).toBeInTheDocument();
    expect(
      within(menu).queryByRole('button', {
        name: 'Delete all lower difficulties',
      }),
    ).not.toBeInTheDocument();
  });

  it('the row label offers Delete all lower difficulties once lowers are charted', () => {
    renderMatrix(docWithGeneratedDrumLowers());
    const menu = openRowMenu('Drums');
    expect(
      within(menu).getByRole('button', {
        name: 'Delete all lower difficulties',
      }),
    ).toBeInTheDocument();
  });

  it('Escape closes the menu without deleting anything', () => {
    renderMatrix(makeTwoInstrumentDoc());
    openCellMenu('Drums Expert');
    fireEvent.keyDown(window, {key: 'Escape'});
    expect(
      screen.queryByTestId('chart-matrix-context-menu'),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('drum-tracks')).toHaveTextContent('expert');
  });
});

describe('Chart Matrix context menu — compact density', () => {
  /** The row height class every menu item carries. */
  const ROW_HEIGHT_CLASS = 'h-[var(--ed-control-h-sm,1.75rem)]';

  /** `1.5rem` / `24px` to px. */
  function toPx(length: string): number {
    const n = Number.parseFloat(length);
    return length.endsWith('rem') ? n * 16 : n;
  }

  /** What `app/globals.css` gives `--ed-control-h-sm` in the compact scope. */
  function compactControlHeightSm(): string {
    const css = fs.readFileSync(
      path.join(__dirname, '../../../app/globals.css'),
      'utf8',
    );
    const scope = css.match(
      /:root\[data-density='compact'\]\s*\{([^}]*)\}/,
    )?.[1];
    const value = scope?.match(/--ed-control-h-sm:\s*([^;]+);/)?.[1];
    if (!value) throw new Error('no compact value for --ed-control-h-sm');
    return value.trim();
  }

  it('sizes menu rows from the editor small-control token, not a roomy literal', () => {
    renderMatrix(makeTwoInstrumentDoc());
    const item = within(openCellMenu('Drums Expert')).getByRole('button', {
      name: 'Delete instrument',
    });
    expect(item).toHaveClass(ROW_HEIGHT_CLASS);
    expect(item).toHaveClass('px-2');
  });

  it('keeps rows at a usable hit target both inside and outside the density scope', () => {
    // Below ~22px a row stops being comfortably clickable. Both numbers the
    // rendered class can resolve to are pinned: the value the compact scope
    // gives the token, and the fallback the class carries for an unscoped
    // page.
    expect(toPx(compactControlHeightSm())).toBeGreaterThanOrEqual(22);
    expect(toPx('1.75rem')).toBeGreaterThanOrEqual(22);
  });

  it('drops the popover to the editor type scale', () => {
    renderMatrix(makeTwoInstrumentDoc());
    const menu = openCellMenu('Drums Expert');
    expect(menu).toHaveClass('text-[11.5px]');
    expect(menu).not.toHaveClass('text-sm');
  });

  it('puts the confirm step on the same small control scale as the rows', () => {
    renderMatrix(makeTwoInstrumentDoc());
    const menu = openCellMenu('Drums Expert');
    fireEvent.click(
      within(menu).getByRole('button', {name: 'Delete difficulty'}),
    );
    const confirm = screen.getByTestId('chart-matrix-context-menu');
    for (const name of ['Cancel', 'Delete']) {
      const button = within(confirm).getByRole('button', {name});
      expect(button).toHaveClass(ROW_HEIGHT_CLASS);
      expect(button).toHaveClass('text-[11.5px]');
    }
  });

  it('does not resize the popover between the item list and the confirm step', () => {
    renderMatrix(makeTwoInstrumentDoc());
    const menu = openCellMenu('Drums Expert');
    const listWidth = menu.style.minWidth;
    fireEvent.click(
      within(menu).getByRole('button', {name: 'Delete difficulty'}),
    );
    expect(screen.getByTestId('chart-matrix-context-menu').style.minWidth).toBe(
      listWidth,
    );
  });
});

describe('Chart Matrix context menu — confirm step', () => {
  it('picking a destructive item shows an inline confirm instead of deleting immediately', () => {
    renderMatrix(makeTwoInstrumentDoc());
    const menu = openCellMenu('Drums Expert');
    fireEvent.click(
      within(menu).getByRole('button', {name: 'Delete difficulty'}),
    );

    expect(screen.getByText('Delete Drums · Expert?')).toBeInTheDocument();
    // Nothing removed yet.
    expect(screen.getByTestId('drum-tracks')).toHaveTextContent('expert');
  });

  it('Cancel returns to the item list without deleting', () => {
    renderMatrix(makeTwoInstrumentDoc());
    const menu = openCellMenu('Drums Expert');
    fireEvent.click(
      within(menu).getByRole('button', {name: 'Delete difficulty'}),
    );
    fireEvent.click(screen.getByRole('button', {name: 'Cancel'}));

    expect(screen.getByTestId('chart-matrix-context-menu')).toHaveTextContent(
      'Delete difficulty',
    );
    expect(screen.getByTestId('drum-tracks')).toHaveTextContent('expert');
  });
});

describe('Chart Matrix context menu — commands apply and undo atomically', () => {
  it('Delete difficulty removes exactly that track; undo restores it', () => {
    renderMatrix(docWithGeneratedDrumLowers());
    const menu = openCellMenu('Drums Hard');
    fireEvent.click(
      within(menu).getByRole('button', {name: 'Delete difficulty'}),
    );
    fireEvent.click(screen.getByRole('button', {name: 'Delete'}));

    expect(screen.getByTestId('drum-tracks')).toHaveTextContent(
      'easy,expert,medium',
    );
    expect(
      screen.queryByTestId('chart-matrix-context-menu'),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Undo'}));
    expect(screen.getByTestId('drum-tracks')).toHaveTextContent(
      'easy,expert,hard,medium',
    );
  });

  it('Delete all lower difficulties removes the set and its provenance record; undo restores both', () => {
    renderMatrix(docWithGeneratedDrumLowers());
    expect(screen.getByTestId('drums-provenance')).toHaveTextContent(
      'has-record',
    );

    const menu = openRowMenu('Drums');
    fireEvent.click(
      within(menu).getByRole('button', {
        name: 'Delete all lower difficulties',
      }),
    );
    fireEvent.click(screen.getByRole('button', {name: 'Delete'}));

    expect(screen.getByTestId('drum-tracks')).toHaveTextContent('expert');
    expect(screen.getByTestId('drums-provenance')).toHaveTextContent(
      'no-record',
    );

    fireEvent.click(screen.getByRole('button', {name: 'Undo'}));
    expect(screen.getByTestId('drum-tracks')).toHaveTextContent(
      'easy,expert,hard,medium',
    );
    expect(screen.getByTestId('drums-provenance')).toHaveTextContent(
      'has-record',
    );
  });

  it('Delete instrument removes every difficulty of the row and its provenance record; undo restores all of it', () => {
    renderMatrix(docWithGeneratedDrumLowers());

    const menu = openRowMenu('Drums');
    fireEvent.click(
      within(menu).getByRole('button', {name: 'Delete instrument'}),
    );
    fireEvent.click(screen.getByRole('button', {name: 'Delete'}));

    expect(screen.getByTestId('drum-tracks')).toHaveTextContent('');
    expect(screen.getByTestId('drums-provenance')).toHaveTextContent(
      'no-record',
    );
    // The row itself is gone from the matrix.
    expect(screen.queryByText('Drums')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Undo'}));
    expect(screen.getByTestId('drum-tracks')).toHaveTextContent(
      'easy,expert,hard,medium',
    );
    expect(screen.getByTestId('drums-provenance')).toHaveTextContent(
      'has-record',
    );
  });

  it('deleting Expert of a generated set drops the provenance record even though the lowers survive', () => {
    renderMatrix(docWithGeneratedDrumLowers());

    const menu = openCellMenu('Drums Expert');
    fireEvent.click(
      within(menu).getByRole('button', {name: 'Delete difficulty'}),
    );
    fireEvent.click(screen.getByRole('button', {name: 'Delete'}));

    expect(screen.getByTestId('drum-tracks')).toHaveTextContent(
      'easy,hard,medium',
    );
    expect(screen.getByTestId('drums-provenance')).toHaveTextContent(
      'no-record',
    );
  });
});

describe('Chart Matrix context menu — at-least-one-visible invariant', () => {
  it('deleting the only visible instrument falls back to another remaining track, never leaving the editor with zero visible tracks', () => {
    // A fresh SET_CHART_DOC load starts with only the "preferred" track
    // visible (guitar Expert outranks drums Expert) — hide it and show
    // only drums Expert, the one about to be deleted wholesale.
    renderMatrix(makeTwoInstrumentDoc());
    fireEvent.click(screen.getByRole('button', {name: 'Guitar Expert'})); // hide guitar
    fireEvent.click(screen.getByRole('button', {name: 'Drums Expert'})); // show drums
    expect(screen.getByTestId('visible-tracks')).toHaveTextContent(
      'drums:expert',
    );

    const menu = openRowMenu('Drums');
    fireEvent.click(
      within(menu).getByRole('button', {name: 'Delete instrument'}),
    );
    fireEvent.click(screen.getByRole('button', {name: 'Delete'}));

    // Drums is gone; guitar Expert — the only track left in the doc — is
    // the fallback, so the editor never drops to zero visible tracks.
    expect(screen.getByTestId('visible-tracks')).toHaveTextContent(
      'guitar:expert',
    );
  });

  it('leaves an intentionally empty visible set alone', () => {
    // Hiding every row is a legitimate user state, so a delete made from
    // that state must not unhide an unrelated row.
    renderMatrix(makeTwoInstrumentDoc());
    fireEvent.click(screen.getByRole('button', {name: 'Guitar Expert'}));
    expect(screen.getByTestId('visible-tracks')).toHaveTextContent('');

    const menu = openRowMenu('Drums');
    fireEvent.click(
      within(menu).getByRole('button', {name: 'Delete instrument'}),
    );
    fireEvent.click(screen.getByRole('button', {name: 'Delete'}));

    expect(screen.getByTestId('visible-tracks')).toHaveTextContent('');
  });

  it('undo puts the deleted track back on screen instead of leaving the fallback showing', () => {
    renderMatrix(makeTwoInstrumentDoc());
    fireEvent.click(screen.getByRole('button', {name: 'Guitar Expert'})); // hide guitar
    fireEvent.click(screen.getByRole('button', {name: 'Drums Expert'})); // show drums
    expect(screen.getByTestId('visible-tracks')).toHaveTextContent(
      'drums:expert',
    );

    const menu = openRowMenu('Drums');
    fireEvent.click(
      within(menu).getByRole('button', {name: 'Delete instrument'}),
    );
    fireEvent.click(screen.getByRole('button', {name: 'Delete'}));
    expect(screen.getByTestId('visible-tracks')).toHaveTextContent(
      'guitar:expert',
    );

    fireEvent.click(screen.getByRole('button', {name: 'Undo'}));

    expect(screen.getByTestId('drum-tracks')).toHaveTextContent('expert');
    expect(screen.getByTestId('visible-tracks')).toHaveTextContent(
      'drums:expert',
    );
  });

  it('does not force a fallback when another visible track already survives the delete', () => {
    renderMatrix(makeTwoInstrumentDoc());
    fireEvent.click(screen.getByRole('button', {name: 'Drums Expert'})); // both now visible
    expect(screen.getByTestId('visible-tracks')).toHaveTextContent(
      'drums:expert,guitar:expert',
    );

    const menu = openRowMenu('Drums');
    fireEvent.click(
      within(menu).getByRole('button', {name: 'Delete instrument'}),
    );
    fireEvent.click(screen.getByRole('button', {name: 'Delete'}));

    expect(screen.getByTestId('visible-tracks')).toHaveTextContent(
      'guitar:expert',
    );
  });
});
