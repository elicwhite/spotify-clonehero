import {useMemo} from 'react';
import type {NoteMarker} from './renderVexflow';

/** Per-note hit feedback for the drum-fills practice overlay. */
export interface NoteFeedback {
  judgment: 'perfect' | 'good' | 'miss';
  /** Signed timing error (hit − target), ms. Positive = late. Null on miss. */
  deltaMs: number | null;
}

const JUDGMENT_STYLE: Record<
  NoteFeedback['judgment'],
  {dot: string; ring: string; text: string}
> = {
  perfect: {
    dot: '#16a34a', // green-600
    ring: 'rgba(22,163,74,0.35)',
    text: '#15803d',
  },
  good: {
    dot: '#f59e0b', // amber-500
    ring: 'rgba(245,158,11,0.35)',
    text: '#b45309',
  },
  miss: {
    dot: '#dc2626', // red-600
    ring: 'rgba(220,38,38,0.30)',
    text: '#b91c1c',
  },
};

function timingLabel(deltaMs: number): string {
  const rounded = Math.round(deltaMs);
  if (rounded === 0) return '0ms';
  // Positive delta = the hit landed after the note = late.
  return rounded > 0 ? `+${rounded}ms late` : `${rounded}ms early`;
}

/**
 * Absolutely-positioned markers drawn over the rendered stave: a colored dot at
 * each notehead (green = perfect, amber = good, red = miss) with a small signed
 * early/late label for non-miss hits. Positions come from the render path's
 * per-notehead `NoteMarker` map; judgments come from the live scorer keyed by
 * the same fill-note id, so this never mutates the VexFlow styling and is fully
 * drum-fills-specific (the shared /sheet-music page passes no feedback).
 */
export function NoteFeedbackOverlay({
  markers,
  feedback,
}: {
  markers: NoteMarker[];
  feedback: Map<string, NoteFeedback>;
}) {
  // One marker per id (a notehead can be re-listed across split durations);
  // keep the first occurrence, which is the sounding head.
  const placed = useMemo(() => {
    const seen = new Set<string>();
    const out: {marker: NoteMarker; fb: NoteFeedback}[] = [];
    for (const marker of markers) {
      if (seen.has(marker.noteId)) continue;
      const fb = feedback.get(marker.noteId);
      if (!fb) continue;
      seen.add(marker.noteId);
      out.push({marker, fb});
    }
    return out;
  }, [markers, feedback]);

  if (placed.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[2]">
      {placed.map(({marker, fb}) => {
        const style = JUDGMENT_STYLE[fb.judgment];
        return (
          <div
            key={marker.noteId}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{left: marker.x, top: marker.y}}>
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor: style.dot,
                boxShadow: `0 0 0 3px ${style.ring}`,
              }}
            />
            {fb.judgment !== 'miss' && fb.deltaMs != null && (
              <div
                className="absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap text-[9px] font-medium leading-none"
                style={{color: style.text}}>
                {timingLabel(fb.deltaMs)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
