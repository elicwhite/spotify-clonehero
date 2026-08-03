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
 * that don't edit notes (`PREVIEW`/`TEMPO`/`ADD_LYRICS`), `'all'` on
 * DRUM_EDIT-style full editors, or a single instrument on pages pinned to
 * one instrument (`/guitar-edit`, `/bass-edit`, `/drum-edit`), which also
 * hides "+ Add instrument" — there is no second instrument to add there.
 */

import {useState} from 'react';
import {Plus} from 'lucide-react';

import {Button} from '@/components/ui/button';
import {useChartEditorContext} from '../ChartEditorContext';
import {useExecuteCommand} from '../hooks/useEditCommands';
import {AddTrackCommand} from '../commands';
import {trackKeyId} from '../scope';
import type {TrackKey} from '../scope';
import {
  getAssistProvenance,
  SUPPORTED_TRACK_INSTRUMENTS,
  type SupportedTrackInstrument,
} from '@/lib/chart-editor-core';
import ChartMatrixRow from './ChartMatrixRow';
import {DIFFICULTY_COLUMNS, INSTRUMENT_LABEL} from '../trackLabels';

/** `2fr`-style column layout: a fixed label column, then four equal
 *  difficulty columns (X/H/M/E). */
const GRID_TEMPLATE_COLUMNS = '4.25rem repeat(4, minmax(0, 1fr))';

export default function ChartMatrix() {
  const {state, dispatch, capabilities} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const variant = capabilities.showChartMatrix;
  const doc = state.chartDoc;
  const trackData = doc?.parsedChart.trackData ?? [];

  if (!variant || !doc) return null;

  const rowInstruments = (
    variant === 'all' ? SUPPORTED_TRACK_INSTRUMENTS : [variant]
  ).filter(instrument =>
    trackData.some(track => track.instrument === instrument),
  );

  if (rowInstruments.length === 0) return null;

  const missingInstruments =
    variant === 'all'
      ? SUPPORTED_TRACK_INSTRUMENTS.filter(
          instrument => !rowInstruments.includes(instrument),
        )
      : [];

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

        {rowInstruments.map(instrument => (
          <ChartMatrixRow
            key={instrument}
            instrument={instrument}
            trackData={trackData}
            visibleTrackKeys={state.visibleTrackKeys}
            provenance={provenance}
            onToggle={toggle}
          />
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Click a difficulty to show or hide it in the editor.
      </p>

      {variant === 'all' && missingInstruments.length > 0 && (
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
