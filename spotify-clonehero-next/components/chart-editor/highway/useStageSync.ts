'use client';

/**
 * Push the chart-wide state the stage owns: the karaoke lyrics overlay, drawn
 * once across the whole highway strip, and the tempo map every highway's
 * `SceneOverlays` / `InteractionManager` converts ticks against.
 *
 * Both are properties of the song, not of a track, so they live here rather
 * than in `useHighwaySync` (which stays per lane). One-way data flow, same as
 * every other renderer push: editor state → stage, never back.
 */

import {useEffect} from 'react';
import type {HighwayStage} from '@/lib/preview/highway';
import type {ChartDocument} from '@/lib/chart-edit';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';

export interface StageSyncInputs {
  stage: HighwayStage | null;
  chartDoc: ChartDocument | null;
  timedTempos: TimedTempo[];
  resolution: number;
  /**
   * Vocal part the karaoke line reads. The active part on a vocals scope
   * (`/add-lyrics`), the default part everywhere else.
   */
  partName: string;
}

export function useStageSync({
  stage,
  chartDoc,
  timedTempos,
  resolution,
  partName,
}: StageSyncInputs): void {
  // -----------------------------------------------------------------------
  // Timing data (tempos + resolution). The stage retains it and applies it to
  // highways mounted later, so a highway added mid-session is never stale.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!stage || timedTempos.length === 0) return;
    stage.setTimingData(timedTempos, resolution);
  }, [stage, timedTempos, resolution]);

  // -----------------------------------------------------------------------
  // Karaoke lyrics — re-push on every chartDoc change so the overlay tracks
  // lyric/phrase edits (drag, rename, add, remove). The stage lazy-creates
  // the overlay if the original chart had no lyrics but some exist now.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!stage || !chartDoc) return;
    const vocals = chartDoc.parsedChart.vocalTracks?.parts?.[partName];
    const lyrics = vocals?.notePhrases.flatMap(p => p.lyrics) ?? [];
    const phrases =
      vocals?.notePhrases.map(p => ({
        msTime: p.msTime,
        msLength: p.msLength,
      })) ?? [];
    stage.setLyricsData(lyrics, phrases);
  }, [stage, chartDoc, partName]);
}
