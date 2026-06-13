'use client';

import {useMemo} from 'react';
import {buildGrooveSketch} from '@/lib/drum-fills/library/rhythmSketch';
import {SketchGrid} from './FillSketch';

/**
 * A faithful single-bar rhythm preview of a groove, built from its canonical
 * groove fingerprint (`slot:voiceMask|...`). Unlike a fill's `FillSketch` (a
 * stylized taxonomy approximation), this renders the groove's actual voice
 * pattern. Used on groove-cluster cards.
 */
export default function GrooveSketch({fingerprint}: {fingerprint: string}) {
  const sketch = useMemo(() => buildGrooveSketch(fingerprint), [fingerprint]);

  if (sketch.lanes.length === 0) {
    return (
      <div className="rounded-md border bg-muted/40 p-2 text-[10px] text-muted-foreground">
        No groove preview
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-muted/40 p-2" aria-hidden>
      <SketchGrid sketch={sketch} />
    </div>
  );
}
