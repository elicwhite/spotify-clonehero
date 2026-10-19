'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import SketchGrid from '@musiccharts/core/components/SketchGrid';
import {
  buildRhythmSketch,
  type SketchInput,
} from '@musiccharts/core/drum-fills/library/rhythmSketch';

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
