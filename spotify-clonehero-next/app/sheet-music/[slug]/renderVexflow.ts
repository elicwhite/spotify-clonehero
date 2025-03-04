// Heavily inspired by https://github.com/tonygoldcrest/drum-hero Thanks!

import React from 'react';
import {
  RenderContext,
  Renderer,
  Stave,
  StaveNote,
  TextJustification,
  Formatter,
  ModifierPosition,
  Beam,
  Dot,
  Barline,
  Tuplet,
  Voice,
} from 'vexflow';
import {Measure} from './convertToVexflow';

export interface RenderData {
  stave: Stave;
  measure: Measure;
}

const MIN_STAVE_WIDTH = 250;
const MAX_STAVE_WIDTH = 600;
const MAX_STAVES_PER_ROW = 4;
const MIN_STAVES_PER_ROW = 1;

const NOTE_COLOR_MAP: {[key: string]: string} = {
  'e/4': '#ff793f', // orange
  'f/4': '#ff793f', // orange
  'c/5': '#e74c3c', // red
  'g/5/x2': '#ffb142', // yellow
  'f/5/x2': '#2980b9', // blue
  'a/5/x2': '#27ae60', // green
  'e/5': '#ffb142', // yellow
  'd/5': '#2980b9', // blue
  'a/4': '#27ae60', // green
};

export function renderMusic(
  elementRef: React.RefObject<HTMLDivElement>,
  measures: Measure[],
  showBarNumbers: boolean = true,
  enableColors: boolean = false,
): RenderData[] {
  if (!elementRef.current) {
    return [];
  }

  const width =
    elementRef.current?.parentElement?.offsetWidth ?? window.innerWidth;

  // Calculate responsive values based on available width
  const margin = 30;

  const stavePerRow = Math.min(
    MAX_STAVES_PER_ROW,
    Math.max(
      MIN_STAVES_PER_ROW,
      Math.floor((width - margin) / MIN_STAVE_WIDTH),
    ),
  );

  // Calculate the actual stave width
  const staveWidth = Math.min(
    MAX_STAVE_WIDTH,
    Math.floor((width - margin) / stavePerRow),
  );

  const renderer = new Renderer(elementRef.current, Renderer.Backends.SVG);

  const context = renderer.getContext();
  const lineHeight = showBarNumbers ? 180 : 130;

  renderer.resize(
    staveWidth * stavePerRow + 10,
    Math.ceil(measures.length / stavePerRow) * lineHeight + 50,
  );

  return measures.map((measure, index) => ({
    measure,
    stave: renderMeasure(
      context,
      measure,
      index,
      (index % stavePerRow) * staveWidth,
      Math.floor(index / stavePerRow) * lineHeight,
      staveWidth,
      index === measures.length - 1,
      showBarNumbers,
      enableColors,
    ),
  }));
}

function renderMeasure(
  context: RenderContext,
  measure: Measure,
  index: number,
  xOffset: number,
  yOffset: number,
  staveWidth: number,
  endMeasure: boolean,
  showBarNumbers: boolean,
  enableColors: boolean,
) {
  const stave = new Stave(xOffset, yOffset, staveWidth);

  if (endMeasure) {
    stave.setEndBarType(Barline.type.END);
  }
  if (measure.hasClef) {
    stave.addClef('percussion');
  }
  if (measure.sigChange) {
    stave.addTimeSignature(
      `${measure.timeSig.numerator}/${measure.timeSig.denominator}`,
    );
  }

  if (showBarNumbers) {
    stave.setText(`${index}`, ModifierPosition.ABOVE, {
      justification: TextJustification.LEFT,
    });
  }

  stave.setContext(context).draw();

  const tuplets: StaveNote[][] = [];
  let currentTuplet: StaveNote[] | null = null;

  const notes = measure.notes.map(note => {
    const staveNote = new StaveNote({
      keys: note.notes,
      duration: note.duration,
      align_center: note.duration === 'wr',
    });

    if (enableColors) {
      staveNote.keys.forEach((n, idx) => {
        staveNote.setKeyStyle(idx, {fillStyle: NOTE_COLOR_MAP[n]});
      });
    }

    if (
      note.isTriplet &&
      (!currentTuplet || (currentTuplet && currentTuplet.length === 3))
    ) {
      currentTuplet = [staveNote];
      tuplets.push(currentTuplet);
    } else if (note.isTriplet && currentTuplet) {
      currentTuplet.push(staveNote);
    } else if (!note.isTriplet && currentTuplet) {
      currentTuplet = null;
    }

    if (note.dotted) {
      Dot.buildAndAttach([staveNote], {
        all: true,
      });
    }
    return staveNote;
  });

  const voice = new Voice({
    num_beats: measure.timeSig.numerator,
    beat_value: measure.timeSig.denominator,
  })
    .setStrict(false)
    .addTickables(notes);

  const drawableTuplets = tuplets.map(tupletNotes => new Tuplet(tupletNotes));

  const beams = Beam.generateBeams(notes, {
    flat_beams: true,
    stem_direction: -1,
  });

  new Formatter().joinVoices([voice]).format([voice], staveWidth - 40);

  voice.draw(context, stave);

  beams.forEach(b => {
    b.setContext(context).draw();
  });

  drawableTuplets.forEach(tuplet => {
    tuplet.setContext(context).draw();
  });

  return stave;
}
