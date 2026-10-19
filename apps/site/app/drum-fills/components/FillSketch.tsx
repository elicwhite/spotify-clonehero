'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {cn} from '@/lib/utils';
import {
  buildRhythmSketch,
  type RhythmSketch,
  type SketchInput,
  type SketchLane,
} from '@/lib/drum-fills/library/rhythmSketch';

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
 * A compact, taxonomy-derived rhythm preview for a fill card. It renders only
 * when scrolled into view (the library may hold thousands of cards). This is a
 * stylized sketch, not a transcription — the real note-accurate sheet music
 * lives in the Practice view where the chart is loaded.
 */
export default function FillSketch({input}: {input: SketchInput}) {
  const ref = useRef<HTMLDivElement>(null);
  // Without IntersectionObserver (tests, very old browsers) render immediately.
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === 'undefined',
  );

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      {rootMargin: '200px'},
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const sketch = useMemo(
    () => (visible ? buildRhythmSketch(input) : null),
    [visible, input],
  );

  return (
    <div
      ref={ref}
      className="rounded-md border bg-muted/40 p-2"
      style={{minHeight: 64}}
      aria-hidden>
      {sketch && <SketchGrid sketch={sketch} />}
    </div>
  );
}

/**
 * Presentational sketch-grid renderer shared by fill sketches (taxonomy-derived)
 * and groove sketches (fingerprint-derived). Renders one labelled lane row per
 * voice with bar-boundary ticks.
 */
export function SketchGrid({sketch}: {sketch: RhythmSketch}) {
  return (
    <div className="flex flex-col gap-1">
      {sketch.lanes.map(lane => (
        <div key={lane.voice} className="flex items-center gap-1">
          <span className="w-5 shrink-0 text-[9px] font-mono text-muted-foreground">
            {LANE_LABEL[lane.voice]}
          </span>
          <div className="flex flex-1 gap-[2px]">
            {lane.cells.map((on, i) => (
              <div
                key={i}
                className={cn(
                  'h-2 flex-1 rounded-[1px]',
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
