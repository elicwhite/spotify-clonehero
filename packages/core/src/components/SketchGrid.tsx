'use client';

import {cn} from '../utils';
import type {
  RhythmSketch,
  SketchLane,
} from '../drum-fills/library/rhythmSketch';

const LANE_LABEL: Record<SketchLane['voice'], string> = {
  crash: 'CR',
  hat: 'HH',
  tom: 'TM',
  snare: 'SN',
  kick: 'KK',
};

const LANE_COLOR: Record<SketchLane['voice'], string> = {
  crash: 'bg-green-500',
  hat: 'bg-yellow-500',
  tom: 'bg-blue-500',
  snare: 'bg-red-500',
  kick: 'bg-orange-500',
};

/**
 * Presentational sketch-grid renderer. Renders one labelled lane row per voice
 * with bar-boundary ticks, and draws nothing itself about where the cells came
 * from: the fill library builds them from a fill's taxonomy, and any other
 * caller can build them from its own data and get the same look.
 */
export default function SketchGrid({
  sketch,
  compact = false,
}: {
  sketch: RhythmSketch;
  /**
   * Drop the lane labels and thin the rows. A grid drawn at thumbnail width
   * has no room for "HH" beside it, and the lane colors already say which
   * voice a row is.
   */
  compact?: boolean;
}) {
  return (
    <div className={cn('flex flex-col', compact ? 'gap-[2px]' : 'gap-1')}>
      {sketch.lanes.map(lane => (
        <div key={lane.voice} className="flex items-center gap-1">
          {!compact && (
            <span className="w-5 shrink-0 text-[9px] font-mono text-muted-foreground">
              {LANE_LABEL[lane.voice]}
            </span>
          )}
          <div className="flex flex-1 gap-[2px]">
            {lane.cells.map((on, i) => (
              <div
                key={i}
                className={cn(
                  'flex-1 rounded-[1px]',
                  compact ? 'h-[3px]' : 'h-2',
                  on ? LANE_COLOR[lane.voice] : 'bg-muted-foreground/15',
                  // bar-boundary tick
                  i > 0 && i % sketch.cellsPerBar === 0 && 'ml-1',
                )}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
