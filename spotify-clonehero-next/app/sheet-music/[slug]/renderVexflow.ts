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
  RepeatNote,
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

// Helper function to check if two measures have identical notes
function measuresAreEqual(measure1: Measure, measure2: Measure): boolean {
  if (measure1.notes.length !== measure2.notes.length) {
    return false;
  }
  
  return measure1.notes.every((note, index) => {
    const note2 = measure2.notes[index];
    return (
      note.duration === note2.duration &&
      note.dotted === note2.dotted &&
      note.isTriplet === note2.isTriplet &&
      JSON.stringify(note.notes) === JSON.stringify(note2.notes)
    );
  });
}

// Helper function to check if a measure contains only rests
function measureIsOnlyRests(measure: Measure): boolean {
  return measure.notes.every(note => 
    note.isRest
  );
}

export function renderMusic(
  elementRef: React.RefObject<HTMLDivElement>,
  measures: Measure[],
  sections: {tick: number; name: string; msTime: number; msLength: number}[],
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

  // Create a map of measure start times to section names for quick lookup
  const sectionMap = new Map<number, string>();
  console.log('Processing sections:', sections.length, sections);
  sections.forEach(section => {
    // Find the measure that contains this section's start time, or the closest measure after it
    let measureIndex = measures.findIndex(measure => 
      section.msTime >= measure.startMs && section.msTime < measure.endMs
    );
    
    // If section starts before any measure, use the first measure
    if (measureIndex === -1 && section.msTime < measures[0]?.startMs) {
      measureIndex = 0;
    }
    
    // If section starts after the last measure ends, find the closest measure
    if (measureIndex === -1) {
      measureIndex = measures.findIndex(measure => measure.startMs >= section.msTime);
      if (measureIndex === -1) {
        measureIndex = measures.length - 1; // Use last measure if section is after all measures
      }
    }
    
    if (measureIndex !== -1 && !sectionMap.has(measureIndex)) {
      console.log(`Adding section "${section.name}" at measure ${measureIndex} (${section.msTime}ms)`);
      sectionMap.set(measureIndex, section.name);
    }
  });
  console.log('Section map:', Array.from(sectionMap.entries()));

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
      sectionMap.get(index), // Pass section name if this measure starts a new section
      index > 0 ? measures[index - 1] : undefined, // Pass previous measure for repeat detection
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
  sectionName?: string,
  previousMeasure?: Measure,
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

  // if (showBarNumbers) {
  //   stave.setText(`${index}`, ModifierPosition.ABOVE, {
  //     justification: TextJustification.LEFT,
  //   });
  // }

  if (sectionName) {
    stave.setText(sectionName, ModifierPosition.ABOVE, {
      justification: TextJustification.LEFT,
      shift_y: 10,
      shift_x: 5,
    });
    
  }

  stave.setContext(context).draw();// context.restore();

  // Check if this measure is a repeat of the previous measure (excluding rest-only measures)
  const isRepeat = previousMeasure && 
    measuresAreEqual(measure, previousMeasure) && 
    !measureIsOnlyRests(measure) &&
    !measureIsOnlyRests(previousMeasure);

  if (isRepeat) {
    // Render repeat symbol instead of notes using VexFlow's RepeatNote
    const repeatSymbol = new RepeatNote('1');

    const voice = new Voice({
      num_beats: measure.timeSig.numerator,
      beat_value: measure.timeSig.denominator,
    })
      .setStrict(false)
      .addTickables([repeatSymbol]);

    new Formatter().joinVoices([voice]).format([voice], staveWidth - 40);
    voice.draw(context, stave);
    
    return stave;
  }

  // Original note rendering logic
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
