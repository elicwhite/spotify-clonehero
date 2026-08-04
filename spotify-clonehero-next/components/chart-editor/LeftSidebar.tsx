'use client';

import {type ReactNode} from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {TooltipProvider} from '@/components/ui/tooltip';
import {useChartEditorContext} from './ChartEditorContext';
import NoteInspector from './NoteInspector';
import ChartMatrix from './sidebar/ChartMatrix';
import ChartAssist, {type ChartAssistProps} from './sidebar/ChartAssist';
import StemsMixer, {type StemsMixerHostProps} from './sidebar/StemsMixer';
import UtilityCluster from './sidebar/UtilityCluster';
import type {AudioManager} from '@/lib/preview/audioManager';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LeftSidebarProps {
  audioManager: AudioManager;
  leftPanelChildren?: ReactNode | undefined;
  /** Host wiring for the Chart Assist section, passed through untouched.
   *  Each field is documented on `ChartAssistProps`. */
  chartAssist?: ChartAssistProps | undefined;
  /** Host wiring for the Stems mixer section, passed through untouched.
   *  Each field is documented on `StemsMixerHostProps`. */
  stemsMixer?: StemsMixerHostProps | undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LeftSidebar({
  audioManager,
  leftPanelChildren,
  chartAssist,
  stemsMixer,
}: LeftSidebarProps) {
  const {state, dispatch, capabilities} = useChartEditorContext();

  // Vocal-part picker. Only renders when:
  //   - the page exposes the picker (add-lyrics suppresses it — the aligner
  //     only writes to the primary vocals track)
  //   - the active scope is vocals (else there's nothing to pick)
  //   - the chart actually has more than one part (single-part charts hide it)
  // Part names follow scan-chart's NormalizedVocalTrack.parts shape.
  const vocalParts =
    state.activeScope.kind === 'vocals'
      ? Object.keys(state.chartDoc?.parsedChart.vocalTracks?.parts ?? {})
      : [];
  const showVocalPartPicker =
    capabilities.showVocalPartPicker &&
    state.activeScope.kind === 'vocals' &&
    vocalParts.length > 1;

  // The sidebar renders no zoom, highway-style or sheet-music control: the
  // approved sidebar (plan 0074 Phase 7) is Chart Matrix, Chart Assist,
  // Stems and the utility cluster. `SET_HIGHWAY_MODE` still has a dispatcher
  // (add-lyrics' waveform pinning); zoom and the sheet-music pane are
  // reducer state with no surface.

  return (
    <TooltipProvider delayDuration={300}>
      {/* 290px rail, the approved prototype's sidebar width — wide enough for
       *  the utility cluster's three columns and the matrix's label column. */}
      <div className="flex flex-col w-[18.125rem] shrink-0 border-r bg-background overflow-y-auto overflow-x-hidden">
        {/* Scrollable sidebar body. Padding and inter-section gap read the
         *  editor density scope's token (`app/globals.css`, plan 0074 Phase 7
         *  task 7c), with the roomy `1rem` as the no-scope fallback. */}
        <div className="space-y-[var(--ed-pad-section,1rem)] overflow-y-auto flex-1 p-[var(--ed-pad-section,1rem)]">
          {/* Vocal part picker — retained above the prototype's section order
           *  (functional necessity, like NoteInspector): only for multi-part
           *  vocal charts. Switching parts clears any active marker selection
           *  (selection is part-scoped via the EntityRef id format), and the
           *  editor re-derives which lyrics/phrases are visible from the new
           *  part. */}
          {showVocalPartPicker && (
            <div className="space-y-2 pb-2 border-b">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Vocal Part</span>
                <Select
                  value={
                    state.activeScope.kind === 'vocals'
                      ? state.activeScope.part
                      : 'vocals'
                  }
                  onValueChange={value => {
                    dispatch({
                      type: 'SET_ACTIVE_SCOPE',
                      scope: {kind: 'vocals', part: value},
                    });
                    // Clear any cross-part selections that wouldn't survive
                    // the part switch — selection ids carry the part.
                    for (const k of [
                      'lyric',
                      'phrase-start',
                      'phrase-end',
                    ] as const) {
                      dispatch({
                        type: 'SET_SELECTION',
                        kind: k,
                        ids: new Set(),
                      });
                    }
                  }}>
                  <SelectTrigger className="h-8 w-[7rem] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {vocalParts.map(part => (
                      <SelectItem key={part} value={part}>
                        {part}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Chart Matrix — instrument/difficulty visibility grid (plan 0074
           *  Phase 3), first per the approved sidebar order. Decides for
           *  itself whether it has anything to show, from
           *  `capabilities.showChartMatrix` and the loaded doc. */}
          <ChartMatrix />

          {/* Chart Assist — Tempo map / Add leading silence / Drum
           *  transcription / Lyrics cards (plan 0074 Phase 2). Decides for
           *  itself whether it has anything to show, from
           *  `capabilities.chartAssist` and the wiring below. */}
          <ChartAssist {...chartAssist} />

          {/* Note inspector — placed between Chart Assist and Stems (plan 0074
           *  Phase 7): a deliberate addition over the approved prototype,
           *  which has no equivalent panel — without it, selected-note detail
           *  (type, tick, flags) would have nowhere to go. Only useful when
           *  notes are selectable. */}
          {capabilities.selectable.has('note') && <NoteInspector />}

          {/* Stems mixer (plan 0074 Phase 5) — one row per audio track the
           *  live AudioManager carries, plus the metronome click as the last
           *  (solo-exempt) row. Decides for itself whether it has anything to
           *  show, from `capabilities.showStemsMixer` and the loaded
           *  AudioManager. */}
          {capabilities.showStemsMixer && (
            <StemsMixer audioManager={audioManager} {...stemsMixer} />
          )}

          {/* Page-specific panels — stay last before the utility cluster. */}
          {leftPanelChildren}

          {/* Snap / Speed / Loop utility cluster (plan 0074 Phase 7) — always
           *  last: snap grid, playback speed, A/B loop, and the compact tool
           *  row (cursor + add-note, undo/redo). Replaces the old separately-
           *  headed Grid/Speed/Zoom/Tools/History blocks. */}
          <UtilityCluster audioManager={audioManager} />
        </div>
      </div>
    </TooltipProvider>
  );
}
