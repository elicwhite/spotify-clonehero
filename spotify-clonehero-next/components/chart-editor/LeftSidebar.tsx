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

  // The sidebar renders no zoom, highway-style or sheet-music control: it is
  // Chart Matrix, Chart Assist, Stems and the utility cluster. `SET_HIGHWAY_MODE` still has a dispatcher
  // (add-lyrics' waveform pinning); zoom and the sheet-music pane are
  // reducer state with no surface.

  return (
    <TooltipProvider delayDuration={300}>
      {/* 290px rail, the approved prototype's sidebar width — wide enough for
       *  the utility cluster's three columns and the matrix's label column.
       *  One element owns all of it: the rail's width and chrome, the single
       *  scroll container, and the sole inset around the sections. Padding and
       *  inter-section gap read the editor density scope's token
       *  (`app/globals.css`), with the roomy `1rem` as the no-scope fallback.
       *  Nesting a second padded/scrolling box inside would double the left
       *  inset and give the rail two scrollbars. */}
      <div className="flex flex-col w-[18.125rem] shrink-0 border-r bg-background overflow-y-auto overflow-x-hidden space-y-[var(--ed-pad-section,1rem)] p-[var(--ed-pad-section,1rem)]">
        {/* Vocal part picker — retained above the prototype's section order
         *  (functional necessity, like NoteInspector): only for multi-part
         *  vocal charts. Switching parts clears any active marker selection
         *  (selection is part-scoped via the EntityRef id format), and the
         *  editor re-derives which lyrics/phrases are visible from the new
         *  part. */}
        {showVocalPartPicker && (
          <div className="space-y-2 pb-2 border-b">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-medium">Vocal Part</span>
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
                <SelectTrigger className="h-8 w-[7rem] text-[15px]">
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

        {/* Chart Matrix — instrument/difficulty visibility grid, first in
         *  the sidebar order. Decides for
         *  itself whether it has anything to show, from
         *  `capabilities.showChartMatrix` and the loaded doc. */}
        <ChartMatrix />

        {/* Chart Assist — Tempo map / Add leading silence / Drum
         *  transcription / Lyrics cards. Decides for
         *  itself whether it has anything to show, from
         *  `capabilities.chartAssist` and the wiring below. */}
        <ChartAssist {...chartAssist} />

        {/* Note inspector — sits between Chart Assist and Stems, and is the
         *  only home for selected-note detail (type, tick, flags). Only
         *  useful when notes are selectable. */}
        {capabilities.selectable.has('note') && <NoteInspector />}

        {/* Stems mixer — one row per audio track the
         *  live AudioManager carries, plus the metronome click as the last
         *  (solo-exempt) row. Decides for itself whether it has anything to
         *  show, from `capabilities.showStemsMixer` and the loaded
         *  AudioManager. */}
        {capabilities.showStemsMixer && (
          <StemsMixer audioManager={audioManager} {...stemsMixer} />
        )}

        {/* Page-specific panels — stay last before the utility cluster. */}
        {leftPanelChildren}

        {/* Snap / Speed / Loop utility cluster — always last: snap grid,
         *  playback speed and the A/B loop controls. */}
        <UtilityCluster audioManager={audioManager} />
      </div>
    </TooltipProvider>
  );
}
