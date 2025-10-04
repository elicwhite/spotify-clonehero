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
import {PracticeModeConfig} from '@/lib/preview/audioManager';

export interface RenderData {
  stave: Stave;
  measure: Measure;
  timePositionMap: Array<{
    ms: number;
    x: number;
    y: number;
    flag: 'measure-start' | 'measure-end' | 'note';
  }>;
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
  return measure.notes.every(note => note.isRest);
}

export function renderMusic(
  elementRef: React.RefObject<HTMLDivElement | null>,
  measures: Measure[],
  sections: {tick: number; name: string; msTime: number; msLength: number}[],
  zoom: number,
  lyrics: {tick: number; text: string; msTime: number}[] = [],
  showBarNumbers: boolean = true,
  enableColors: boolean = false,
  practiceModeConfig?: PracticeModeConfig | null,
): RenderData[] {
  if (!elementRef.current) {
    return [];
  }

  const renderer = new Renderer(elementRef.current, Renderer.Backends.SVG);
  const context = renderer.getContext();

  const width =
    elementRef.current?.parentElement?.offsetWidth ?? window.innerWidth;

  // Calculate responsive values based on available width
  const margin = 30;

  const lineHeight = showBarNumbers ? 180 : 130;

  const stavePerRow = Math.min(
    MAX_STAVES_PER_ROW,
    Math.max(
      MIN_STAVES_PER_ROW,
      Math.floor((width / zoom - margin) / MIN_STAVE_WIDTH),
    ),
  );

  // We have to subtract 1 from the width because if we are exactly the same size
  // Then the chart will only resize larger, and won't let the parent size shrink
  // when the window is resized smaller.

  // Calculate the actual stave width
  const staveWidth = Math.min(
    MAX_STAVE_WIDTH,
    Math.floor(width / stavePerRow) - 1,
  );

  renderer.resize(
    // This doesn't include zoom because the width is scaled already
    width - 1, //staveWidth * stavePerRow + 10,
    // The height is scaled so that it doesn't crop the height of the sheet
    (Math.ceil(measures.length / stavePerRow) * lineHeight + 50) * zoom,
  );

  context.scale(zoom, zoom);

  // Create a map of measure start times to section names for quick lookup
  const sectionMap = new Map<number, string>();
  sections.forEach(section => {
    // Find the measure that contains this section's start time, or the closest measure after it
    let measureIndex = measures.findIndex(
      measure =>
        section.msTime >= measure.startMs && section.msTime < measure.endMs,
    );

    // If section starts before any measure, use the first measure
    if (measureIndex === -1 && section.msTime < measures[0]?.startMs) {
      measureIndex = 0;
    }

    // If section starts after the last measure ends, find the closest measure
    if (measureIndex === -1) {
      measureIndex = measures.findIndex(
        measure => measure.startMs >= section.msTime,
      );
      if (measureIndex === -1) {
        measureIndex = measures.length - 1; // Use last measure if section is after all measures
      }
    }

    if (measureIndex !== -1 && !sectionMap.has(measureIndex)) {
      sectionMap.set(measureIndex, section.name);
    }
  });

  // Create a map of measure start times to lyrics for quick lookup
  const lyricsMap = new Map<
    number,
    {text: string; position: number; msTime: number}[]
  >();
  lyrics.forEach(lyric => {
    // Find the measure that contains this lyric's start time
    let measureIndex = measures.findIndex(
      measure =>
        lyric.msTime >= measure.startMs && lyric.msTime < measure.endMs,
    );

    // If lyric starts before any measure, use the first measure
    if (measureIndex === -1 && lyric.msTime < measures[0]?.startMs) {
      measureIndex = 0;
    }

    // If lyric starts after the last measure ends, find the closest measure
    if (measureIndex === -1) {
      measureIndex = measures.findIndex(
        measure => measure.startMs >= lyric.msTime,
      );
      if (measureIndex === -1) {
        measureIndex = measures.length - 1; // Use last measure if lyric is after all measures
      }
    }

    if (measureIndex !== -1) {
      const measure = measures[measureIndex];
      // Calculate position within the measure (0.0 to 1.0)
      const measureDuration = measure.endMs - measure.startMs;
      const lyricOffset = lyric.msTime - measure.startMs;
      const position = Math.max(0, Math.min(1, lyricOffset / measureDuration));

      if (!lyricsMap.has(measureIndex)) {
        lyricsMap.set(measureIndex, []);
      }
      lyricsMap.get(measureIndex)!.push({
        text: lyric.text,
        position: position,
        msTime: lyric.msTime,
      });
    }
  });

  // Process lyrics to combine overlapping ones
  const processedLyricsMap = new Map<
    number,
    {text: string; position: number}[]
  >();
  lyricsMap.forEach((measureLyrics, measureIndex) => {
    // Sort lyrics by position within the measure
    const sortedLyrics = measureLyrics.sort((a, b) => a.position - b.position);

    const processed: {text: string; position: number}[] = [];

    // Create a temporary canvas context to measure text width
    const canvas = document.createElement('canvas');
    const tempContext = canvas.getContext('2d');
    if (tempContext) {
      tempContext.font = '12px Arial'; // Match the font used for rendering
    }

    for (let i = 0; i < sortedLyrics.length; i++) {
      const currentLyric = sortedLyrics[i];
      let combinedText = currentLyric.text;
      let combinedPosition = currentLyric.position;

      // Calculate text widths and check for actual overlaps
      while (i + 1 < sortedLyrics.length) {
        const nextLyric = sortedLyrics[i + 1];

        // Measure current combined text width
        const currentTextWidth =
          tempContext?.measureText(combinedText).width ||
          combinedText.length * 8;
        const currentPixelWidth = currentTextWidth;

        // Calculate current text end position in pixels
        // Estimate content width (typically about 70-80% of stave width after clefs, margins, etc.)
        const estimatedContentWidth = staveWidth * 0.75;
        const currentEndX =
          combinedPosition * estimatedContentWidth + currentPixelWidth / 2;

        // Calculate next text start position in pixels
        const nextTextWidth =
          tempContext?.measureText(nextLyric.text).width ||
          nextLyric.text.length * 8;
        const nextStartX =
          nextLyric.position * estimatedContentWidth - nextTextWidth / 2;

        // Add padding between text elements (10 pixels)
        const padding = 10;

        // Check if texts would overlap or be too close
        if (currentEndX + padding > nextStartX) {
          // Combine the lyrics
          i++; // Move to next lyric
          combinedText += ' ' + nextLyric.text;
          // Use the average position for combined lyrics
          combinedPosition = (currentLyric.position + nextLyric.position) / 2;
        } else {
          // No overlap, break out of the while loop
          break;
        }
      }

      processed.push({
        text: combinedText,
        position: combinedPosition,
      });
    }

    processedLyricsMap.set(measureIndex, processed);
  });

  // Build time->position map for this measure
  const timePositionMap: Array<{
    ms: number;
    x: number;
    y: number;
    flag: 'measure-start' | 'measure-end' | 'note';
  }> = [];

  return measures.map((measure, index) => {
    const stave = renderMeasure(
      context,
      measure,
      index,
      ((index % stavePerRow) * staveWidth) / zoom,
      Math.floor(index / stavePerRow) * lineHeight,
      staveWidth / zoom,
      zoom,
      index === measures.length - 1,
      showBarNumbers,
      enableColors,
      timePositionMap,
      sectionMap.get(index), // Pass section name if this measure starts a new section
      processedLyricsMap.get(index), // Pass processed lyrics if this measure contains lyrics
      index > 0 ? measures[index - 1] : undefined, // Pass previous measure for repeat detection
      practiceModeConfig, // Pass practice mode configuration
    );

    return {
      measure,
      stave,
      timePositionMap,
    };
  });
}

export function createConsolidatedTimePositionMap(
  renderData: RenderData[],
): Array<{
  ms: number;
  x: number;
  y: number;
  flag: 'measure-start' | 'measure-end' | 'note';
}> {
  const consolidatedMap: Array<{
    ms: number;
    x: number;
    y: number;
    flag: 'measure-start' | 'measure-end' | 'note';
  }> = [];

  renderData.forEach(renderItem => {
    // Add all time position points from this measure
    consolidatedMap.push(...renderItem.timePositionMap);
  });

  return consolidatedMap;
}

export function findPositionForTime(
  timePositionMap: Array<{
    ms: number;
    x: number;
    y: number;
    flag: 'measure-start' | 'measure-end' | 'note';
  }>,
  currentMs: number,
): {x: number; y: number} | null {
  if (timePositionMap.length === 0) return null;

  // Binary search to find the two points that bracket the current time
  let left = 0;
  let right = timePositionMap.length - 1;
  let beforePoint: {ms: number; x: number; y: number} | null = null;
  let afterPoint: {ms: number; x: number; y: number} | null = null;

  // Handle edge cases first
  if (currentMs <= timePositionMap[0].ms) {
    return {x: timePositionMap[0].x, y: timePositionMap[0].y};
  }

  if (currentMs >= timePositionMap[right].ms) {
    return {x: timePositionMap[right].x, y: timePositionMap[right].y};
  }

  // Binary search to find the insertion point
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const midTime = timePositionMap[mid].ms;

    if (midTime === currentMs) {
      // Exact match found
      return {x: timePositionMap[mid].x, y: timePositionMap[mid].y};
    } else if (midTime < currentMs) {
      // Current time is after mid, so mid could be our "before" point
      beforePoint = timePositionMap[mid];
      left = mid + 1;
    } else {
      // Current time is before mid, so mid could be our "after" point
      afterPoint = timePositionMap[mid];
      right = mid - 1;
    }
  }

  // At this point, we have found the two points that bracket currentMs
  // beforePoint is the largest time <= currentMs
  // afterPoint is the smallest time > currentMs

  if (!beforePoint || !afterPoint) {
    // This shouldn't happen given our edge case handling, but safety first
    return {x: timePositionMap[0].x, y: timePositionMap[0].y};
  }

  // Interpolate between the two points
  const timeRatio =
    (currentMs - beforePoint.ms) / (afterPoint.ms - beforePoint.ms);
  const x = beforePoint.x + timeRatio * (afterPoint.x - beforePoint.x);
  const y = beforePoint.y + timeRatio * (afterPoint.y - beforePoint.y);

  return {x, y};
}

export function getTotalDuration(renderData: RenderData[]): number {
  if (renderData.length === 0) return 0;

  const lastMeasure = renderData[renderData.length - 1].measure;
  return lastMeasure.endMs;
}

function renderMeasure(
  context: RenderContext,
  measure: Measure,
  index: number,
  xOffset: number,
  yOffset: number,
  staveWidth: number,
  zoom: number,
  endMeasure: boolean,
  showBarNumbers: boolean,
  enableColors: boolean,
  timePositionMap: Array<{
    ms: number;
    x: number;
    y: number;
    flag: 'measure-start' | 'measure-end' | 'note';
  }>,
  sectionName?: string,
  lyrics?: {text: string; position: number}[],
  previousMeasure?: Measure,
  practiceModeConfig?: PracticeModeConfig | null,
) {
  const stave = new Stave(xOffset, yOffset, staveWidth);

  // Check if this measure should be muted for practice mode
  let shouldMute = false;
  if (practiceModeConfig != null && practiceModeConfig.endTimeMs > 0) {
    const isInPracticeRange =
      measure.startMs >= practiceModeConfig.startMeasureMs - 1 &&
      measure.endMs <= practiceModeConfig.endMeasureMs + 1;
    shouldMute = !isInPracticeRange;
  }

  const inactive_measure_color = 'rgba(0, 0, 0, 0.3)';
  const fill_color = shouldMute ? inactive_measure_color : undefined;

  context.fillStyle = fill_color ?? '';
  context.strokeStyle = fill_color ?? '';

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
    stave.setText(`${index + 1}`, ModifierPosition.ABOVE, {
      justification: TextJustification.LEFT,
    });
  }

  // Render section name above the staff in bold
  if (sectionName) {
    context.setFont('Arial', 14, 'bold');

    // Position it above the staff with some offset
    const sectionX = xOffset + 5;
    const sectionY = yOffset + 15;

    context.fillText(sectionName, sectionX, sectionY);
  }

  // Render lyrics below the staff
  if (lyrics && lyrics.length > 0) {
    lyrics.forEach(lyric => {
      // Get the actual content area of the stave (excluding clefs, time signatures, etc.)
      const staveStartX = stave.getNoteStartX();
      const staveEndX = stave.getNoteEndX();
      const contentWidth = staveEndX - staveStartX;

      // Calculate the actual x position within the content area based on the lyric's position (0.0 to 1.0)
      const lyricX = staveStartX + lyric.position * contentWidth;

      // Set font and measure text for centering
      context.setFont('Arial', 12, 'normal');
      const textWidth = context.measureText(lyric.text).width;

      // Center the text at the calculated position
      const centeredX = lyricX - textWidth / 2;

      context.fillText(lyric.text, centeredX, yOffset + stave.getHeight() + 40);
    });
  }

  stave.setContext(context).draw();

  timePositionMap.push({
    ms: measure.startMs,
    x: stave.getTieStartX() * zoom,
    y: stave.getY() * zoom,
    flag: 'measure-start',
  });

  // Check if this measure is a repeat of the previous measure (excluding rest-only measures)
  const isRepeat =
    previousMeasure &&
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

    timePositionMap.push({
      ms: measure.endMs,
      x: stave.getTieEndX() * zoom,
      y: stave.getY() * zoom,
      flag: 'measure-end',
    });

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

    // @ts-ignore Store ms in the stave note for later use
    staveNote.ms = note.ms;

    if (enableColors) {
      staveNote.keys.forEach((n, idx) => {
        const suffix = shouldMute ? '4D' : '';
        staveNote.setKeyStyle(idx, {fillStyle: NOTE_COLOR_MAP[n] + suffix});
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

  notes.forEach(note => {
    if (!note.isRest()) {
      timePositionMap.push({
        // @ts-ignore Use ms from the note object stored above
        ms: note.ms,
        x: note.getNoteHeadBeginX() * zoom,
        y: stave.getY() * zoom,
        flag: 'note',
      });
    }
  });

  timePositionMap.push({
    ms: measure.endMs,
    x: stave.getTieEndX() * zoom,
    y: stave.getY() * zoom,
    flag: 'measure-end',
  });

  beams.forEach(b => {
    b.setContext(context).draw();
  });

  drawableTuplets.forEach(tuplet => {
    tuplet.setContext(context).draw();
  });

  return stave;
}
