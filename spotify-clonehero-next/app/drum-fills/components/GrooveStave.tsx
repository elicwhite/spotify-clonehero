'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {Beam, Formatter, Renderer, Stave, StaveNote, Voice} from 'vexflow';
import {
  grooveStaveCells,
  type GrooveStaveData,
  type StaveVoice,
} from '@/lib/drum-fills/library/grooveStave';

/** Voice → VexFlow key (cymbals use the /x2 X-notehead glyph). */
const VOICE_KEY: Record<StaveVoice, string> = {
  kick: 'e/4',
  snare: 'c/5',
  hat: 'g/5/x2',
  tom: 'd/5',
  crash: 'a/5/x2',
};

/** Notehead fill colours, matching the kit colours used elsewhere. */
const VOICE_FILL: Record<StaveVoice, string> = {
  kick: '#f97316',
  snare: '#ef4444',
  hat: '#eab308',
  tom: '#3b82f6',
  crash: '#22c55e',
};

// The staff itself is ~40px; leave headroom above for crash ledger noteheads
// and ample room below for the (drum) down-stems and beams so nothing clips.
const STAVE_TOP = 28;
const STAVE_HEIGHT = 150;

function draw(el: HTMLDivElement, data: GrooveStaveData, width: number) {
  el.innerHTML = '';
  if (data.cellsPerBar === 0 || width < 40) return;

  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(width, STAVE_HEIGHT);
  const ctx = renderer.getContext();

  const stave = new Stave(0, STAVE_TOP, width - 2, {});
  stave.setContext(ctx).draw();

  const duration = data.cellsPerBar === 8 ? '8' : '16';
  const notes = data.cells.map(voices => {
    if (voices.length === 0) {
      return new StaveNote({keys: ['b/4'], duration: `${duration}r`});
    }
    const note = new StaveNote({
      keys: voices.map(v => VOICE_KEY[v]),
      duration,
      stem_direction: -1,
    });
    voices.forEach((v, i) => note.setKeyStyle(i, {fillStyle: VOICE_FILL[v]}));
    return note;
  });

  const voice = new Voice({num_beats: 4, beat_value: 4})
    .setStrict(false)
    .addTickables(notes);
  const beams = Beam.generateBeams(notes, {
    flat_beams: true,
    stem_direction: -1,
  });
  new Formatter().joinVoices([voice]).format([voice], Math.max(40, width - 24));
  voice.draw(ctx, stave);
  beams.forEach(b => b.setContext(ctx).draw());
}

/**
 * A small single-bar VexFlow stave of a groove, rendered from its canonical
 * fingerprint. Renders only once scrolled into view (the grid can hold hundreds
 * of cards) and re-renders when its width changes.
 */
export default function GrooveStave({fingerprint}: {fingerprint: string}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === 'undefined',
  );

  const data = useMemo(() => grooveStaveCells(fingerprint), [fingerprint]);

  useEffect(() => {
    const el = containerRef.current;
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

  useEffect(() => {
    const host = svgRef.current;
    if (!visible || !host) return;
    let frame = 0;
    const render = () => draw(host, data, host.clientWidth);
    render();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(render);
    });
    ro.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [visible, data]);

  if (data.cellsPerBar === 0) {
    return (
      <div className="rounded-md border bg-muted/40 p-2 text-[10px] text-muted-foreground">
        No groove preview
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="rounded-md border bg-white"
      style={{minHeight: STAVE_HEIGHT}}
      aria-hidden>
      <div ref={svgRef} className="w-full" />
    </div>
  );
}
