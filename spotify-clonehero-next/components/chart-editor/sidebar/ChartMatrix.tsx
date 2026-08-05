'use client';

/**
 * Chart Matrix sidebar section.
 *
 * Rows = instruments present in the chart (guitar/bass/drums — no vocals
 * row, vocals are surfaced in Chart Assist instead). Columns = X/H/M/E.
 * The ONE interaction on the whole matrix: clicking a charted cell toggles
 * that track's visibility (`SET_TRACK_VISIBILITY`) — the single user-facing
 * selection state, driving both the stacked piano roll's rows and the
 * highway panes. Filled/accent = visible, neutral = hidden. There is no
 * focus concept here: every visible track is a simultaneously editable
 * peer, not a single "selected" one.
 *
 * `capabilities.showChartMatrix` gates the whole section: `false` on pages
 * that don't edit notes (`PREVIEW`/`TEMPO`/`ADD_LYRICS`), `true` on
 * DRUM_EDIT-style full editors, which is every surface that ships the
 * matrix at all — every present instrument is always a row.
 *
 * Right-click on a row label or a cell opens the delete context menu. The
 * menu itself lives in `ChartMatrixContextMenu`; the matrix only decides
 * where it opened and on what.
 */

import {useCallback, useState, type MouseEvent} from 'react';
import {Plus} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {useChartEditorContext} from '../ChartEditorContext';
import {useExecuteCommand} from '../hooks/useEditCommands';
import {AddTrackCommand} from '../commands';
import {trackKeyId} from '../scope';
import type {TrackKey} from '../scope';
import {
  getAssistProvenance,
  selectDifficultyStale,
  SUPPORTED_TRACK_INSTRUMENTS,
  type SupportedTrackInstrument,
  type SupportedTrackKey,
} from '@/lib/chart-editor-core';
import {useOptionalAssistRunnerContext} from '@/components/assist/AssistRunnerProvider';
import {useDifficultyGeneration} from '../hooks/useDifficultyGeneration';
import ChartMatrixRow from './ChartMatrixRow';
import ChartMatrixContextMenu, {
  type MatrixMenuTarget,
} from './ChartMatrixContextMenu';
import {
  useDismissOnEscape,
  useDismissOnOutsidePointerDown,
} from '../ContextMenuPopover';
import InstrumentIcon from '../InstrumentIcon';
import SectionHeading, {SIDEBAR_SECTION_CLASS} from './SectionHeading';
import {DIFFICULTY_COLUMNS, INSTRUMENT_LABEL} from '../trackLabels';

/** `2fr`-style column layout: a fixed label column, then four equal
 *  difficulty columns (X/H/M/E). The label column is the approved
 *  prototype's 78px. */
const GRID_TEMPLATE_COLUMNS = '4.875rem repeat(4, minmax(0, 1fr))';

export default function ChartMatrix() {
  const {state, dispatch, capabilities} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();
  const runner = useOptionalAssistRunnerContext();
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const {generatingInstrument, disabledReason, start} =
    useDifficultyGeneration();
  const [menu, setMenu] = useState<MatrixMenuTarget | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  // The "Add instrument" dropdown dismisses the same way the editor's
  // right-click menus do: the next pointerdown that reaches the window, or
  // Escape. While it is open, the wrapper below stops propagation of its own
  // pointerdown, which is what keeps a click on the trigger (or on an option)
  // from counting as "outside" — without it the trigger could never toggle the
  // menu shut. The stop is scoped to the open state so that with the dropdown
  // closed the wrapper is an ordinary part of the sidebar, and a click on it
  // still dismisses whatever other menu is open.
  const closeAddMenu = useCallback(() => setAddMenuOpen(false), []);
  useDismissOnOutsidePointerDown(addMenuOpen, closeAddMenu);
  useDismissOnEscape(addMenuOpen, closeAddMenu);

  // Right-click on the row label or a cell opens the delete menu.
  // Suppressed while THIS instrument's generation is in flight —
  // same reason `ChartMatrixCell`'s `locked` blocks its click: a delete
  // mid-generation could race the command about to install/replace tracks.
  const openMenu = useCallback(
    (
      e: MouseEvent,
      instrument: SupportedTrackInstrument,
      trackKey: SupportedTrackKey | null,
      hasLowerDifficulties: boolean,
    ) => {
      e.preventDefault();
      if (generatingInstrument === instrument) return;
      setMenu({
        x: e.clientX,
        y: e.clientY,
        instrument,
        trackKey,
        hasLowerDifficulties,
      });
    },
    [generatingInstrument],
  );

  const openRowMenu = useCallback(
    (
      e: MouseEvent,
      instrument: SupportedTrackInstrument,
      hasLowerDifficulties: boolean,
    ) => openMenu(e, instrument, null, hasLowerDifficulties),
    [openMenu],
  );

  const openCellMenu = useCallback(
    (
      e: MouseEvent,
      trackKey: SupportedTrackKey,
      hasLowerDifficulties: boolean,
    ) => openMenu(e, trackKey.instrument, trackKey, hasLowerDifficulties),
    [openMenu],
  );

  const doc = state.chartDoc;
  const trackData = doc?.parsedChart.trackData ?? [];

  if (!capabilities.showChartMatrix || !doc) return null;

  const rowInstruments = SUPPORTED_TRACK_INSTRUMENTS.filter(instrument =>
    trackData.some(track => track.instrument === instrument),
  );

  if (rowInstruments.length === 0) return null;

  const missingInstruments = SUPPORTED_TRACK_INSTRUMENTS.filter(
    instrument => !rowInstruments.includes(instrument),
  );

  const provenance = getAssistProvenance(doc);

  // Visibility is the only interaction on the matrix, and it is
  // unconditional: hiding the final visible track is allowed, and the
  // highway falls back to its "no tracks visible" state.
  const toggle = (track: TrackKey) => {
    const visible = state.visibleTrackKeys.has(trackKeyId(track));
    dispatch({type: 'SET_TRACK_VISIBILITY', track, visible: !visible});
  };

  const addInstrument = (instrument: SupportedTrackInstrument) => {
    const track: TrackKey = {instrument, difficulty: 'expert'};
    executeCommand(new AddTrackCommand(track));
    dispatch({type: 'SET_TRACK_VISIBILITY', track, visible: true});
    setAddMenuOpen(false);
  };

  return (
    <div className={SIDEBAR_SECTION_CLASS}>
      <SectionHeading title="Chart Matrix" />

      <div
        data-testid="chart-matrix-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: GRID_TEMPLATE_COLUMNS,
          gap: '3px',
        }}>
        {/* Every item in this grid places itself with an explicit
         *  `grid-column` (header, row label, cells, and the spanning
         *  "Generate H · M · E" bar). Mixing auto-placed items in would let
         *  auto-placement reorder them around the explicitly-placed ones. */}
        <div style={{gridColumn: 1}} />
        {DIFFICULTY_COLUMNS.map((col, index) => (
          <div
            key={col.difficulty}
            style={{gridColumn: 2 + index}}
            className="text-center text-[11px] font-semibold text-muted-foreground">
            {col.label}
          </div>
        ))}

        {rowInstruments.map(instrument => {
          const stale = selectDifficultyStale(
            state,
            instrument,
            trackKeyId({instrument, difficulty: 'expert'}),
          );
          return (
            <ChartMatrixRow
              key={instrument}
              instrument={instrument}
              trackData={trackData}
              visibleTrackKeys={state.visibleTrackKeys}
              provenance={provenance}
              onToggle={toggle}
              stale={stale}
              generating={generatingInstrument === instrument}
              onGenerate={() => start(instrument)}
              generateDisabledReason={disabledReason}
              runner={runner}
              onRowContextMenu={openRowMenu}
              onCellContextMenu={openCellMenu}
            />
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Click a difficulty to show or hide it in the editor.
      </p>

      {missingInstruments.length > 0 && (
        <div
          className="relative"
          onPointerDown={addMenuOpen ? e => e.stopPropagation() : undefined}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={addMenuOpen}
            className="h-7 w-full justify-center gap-1.5 border-dashed text-[13px] text-muted-foreground"
            onClick={() => setAddMenuOpen(open => !open)}>
            <Plus className="h-3.5 w-3.5" /> Add instrument
          </Button>
          {addMenuOpen && (
            <div
              data-testid="add-instrument-menu"
              className="absolute left-0 right-0 z-40 mt-1 rounded-md border bg-popover p-1 shadow-md">
              {missingInstruments.map(instrument => (
                <button
                  key={instrument}
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent"
                  onClick={() => addInstrument(instrument)}>
                  <InstrumentIcon
                    instrument={instrument}
                    size={16}
                    className="h-4 w-4 shrink-0"
                  />
                  {INSTRUMENT_LABEL[instrument]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {menu && <ChartMatrixContextMenu target={menu} onClose={closeMenu} />}
    </div>
  );
}
