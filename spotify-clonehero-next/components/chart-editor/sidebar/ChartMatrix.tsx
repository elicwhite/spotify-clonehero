'use client';

/**
 * Chart Matrix sidebar section (plan 0074 Phase 3, Design C).
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
 */

import {useCallback, useState} from 'react';
import {Plus} from 'lucide-react';
import {toast} from 'sonner';

import {Button} from '@/components/ui/button';
import {useChartEditorContext} from '../ChartEditorContext';
import {useExecuteCommand} from '../hooks/useEditCommands';
import {AddTrackCommand, DeleteLowerDifficultiesCommand} from '../commands';
import {trackKeyId} from '../scope';
import type {TrackKey} from '../scope';
import {
  getAssistProvenance,
  LOWER_TRACK_DIFFICULTIES,
  selectDifficultyStale,
  SUPPORTED_TRACK_INSTRUMENTS,
  type SupportedTrackInstrument,
} from '@/lib/chart-editor-core';
import {useOptionalAssistRunnerContext} from '@/components/assist/AssistRunnerProvider';
import {useDifficultyGeneration} from '../hooks/useDifficultyGeneration';
import ChartMatrixRow from './ChartMatrixRow';
import {DIFFICULTY_COLUMNS, INSTRUMENT_LABEL} from '../trackLabels';

/** `2fr`-style column layout: a fixed label column, then four equal
 *  difficulty columns (X/H/M/E). */
const GRID_TEMPLATE_COLUMNS = '4.25rem repeat(4, minmax(0, 1fr))';

export default function ChartMatrix() {
  const {state, dispatch, capabilities} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();
  const runner = useOptionalAssistRunnerContext();
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const {generatingInstrument, disabledReasonFor, start} =
    useDifficultyGeneration();

  const doc = state.chartDoc;
  const trackData = doc?.parsedChart.trackData ?? [];

  // Deletes the generated set and drops its visibility keys, so a later
  // regeneration doesn't resurrect a pane the user never asked for.
  const deleteGenerated = useCallback(
    (instrument: SupportedTrackInstrument) => {
      executeCommand(new DeleteLowerDifficultiesCommand(instrument));
      for (const difficulty of LOWER_TRACK_DIFFICULTIES) {
        dispatch({
          type: 'SET_TRACK_VISIBILITY',
          track: {instrument, difficulty},
          visible: false,
        });
      }
      toast.success(
        `Deleted ${INSTRUMENT_LABEL[instrument]} Hard, Medium, Easy.`,
      );
    },
    [executeCommand, dispatch],
  );

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
    <div className="space-y-2 pt-4 border-t">
      <span className="text-sm font-medium">Chart Matrix</span>

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
            className="text-center text-[10px] font-semibold text-muted-foreground">
            {col.label}
          </div>
        ))}

        {rowInstruments.map(instrument => {
          const stale = selectDifficultyStale(
            state,
            instrument,
            trackKeyId({instrument, difficulty: 'expert'}),
          );
          const disabledReason = disabledReasonFor(instrument);
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
              onDelete={() => deleteGenerated(instrument)}
              runner={runner}
            />
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Click a difficulty to show or hide it in the editor.
      </p>

      {missingInstruments.length > 0 && (
        <div className="relative">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 w-full justify-center gap-1.5 border-dashed text-xs text-muted-foreground"
            onClick={() => setAddMenuOpen(open => !open)}>
            <Plus className="h-3.5 w-3.5" /> Add instrument
          </Button>
          {addMenuOpen && (
            <div className="absolute left-0 right-0 z-40 mt-1 rounded-md border bg-popover p-1 shadow-md">
              {missingInstruments.map(instrument => (
                <button
                  key={instrument}
                  type="button"
                  className="flex w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                  onClick={() => addInstrument(instrument)}>
                  {INSTRUMENT_LABEL[instrument]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
