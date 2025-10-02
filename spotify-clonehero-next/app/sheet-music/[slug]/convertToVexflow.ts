// Heavily inspired by https://github.com/tonygoldcrest/drum-hero Thanks!

import {
  NoteEvent,
  parseChartFile,
  noteTypes,
  noteFlags,
} from '@eliwhite/scan-chart';
import {tickToMs} from './chartUtils';

type ParsedChart = ReturnType<typeof parseChartFile>;
type TimeSignature = ParsedChart['timeSignatures'][0];
// type Difficulty = ParsedChart['trackData'][0]['difficulty'];

export default function convertToVexFlow(
  chart: ParsedChart,
  track: ParsedChart['trackData'][0],
): Measure[] {
  return new Parser(chart, track).getMeasures();
}

export type DrumNoteInstrument =
  | 'kick'
  | 'snare'
  | 'high-tom'
  | 'mid-tom'
  | 'floor-tom'
  | 'hihat'
  | 'crash'
  | 'ride';

type InstrumentMapping = {
  [key in DrumNoteInstrument]: string;
};

const mapping: InstrumentMapping = {
  kick: 'e/4',
  snare: 'c/5',
  hihat: 'g/5/x2',
  ride: 'f/5/x2',
  crash: 'a/5/x2',
  'high-tom': 'e/5',
  'mid-tom': 'd/5',
  'floor-tom': 'a/4',
};

export interface Measure {
  timeSig: TimeSignature;
  sigChange: boolean;
  hasClef: boolean;
  notes: Note[];
  beats: Beat[];
  startTick: number;
  endTick: number;
  durationTicks?: number;
  startMs: number;
  endMs: number;
}

export interface Beat {
  notes: Note[];
  startTick: number;
  endTick: number;
}

export interface Note {
  notes: string[];
  dotted: boolean;
  duration: string;
  isTriplet: boolean;
  isRest: boolean;
  tick: number;
  ms: number;
  durationTicks?: number;
}

export interface Duration {
  duration?: string;
  isTriplet?: boolean;
  dotted?: boolean;
}

class Parser {
  endOfTrackTicks: number;
  durationMap: {[key: number]: Duration};
  chart: ParsedChart;
  drumPart: ParsedChart['trackData'][0];
  measures: Measure[] = [];

  constructor(chart: ParsedChart, drumPart: ParsedChart['trackData'][0]) {
    this.chart = chart;
    this.drumPart = drumPart;

    this.endOfTrackTicks =
      drumPart.noteEventGroups[drumPart.noteEventGroups.length - 1][0].tick ||
      0;

    this.durationMap = this.#constructDurationMap();

    this.createMeasures();
    this.fillBeats();
    this.extendNoteDuration();
    this.processCompositeDuration();
    this.flattenMeasures();
  }

  getMeasures() {
    return this.measures;
  }

  createMeasures() {
    const ppq = this.chart.resolution;
    const endOfTrackTicks = this.endOfTrackTicks;

    let startTick = 0;

    this.chart.timeSignatures.forEach((timeSig, index) => {
      const pulsesPerDivision = ppq / (timeSig.denominator / 4);
      const totalTimeSigTicks =
        (this.chart.timeSignatures[index + 1]?.tick ?? endOfTrackTicks) -
        timeSig.tick;

      const numberOfMeasures = Math.ceil(
        totalTimeSigTicks / pulsesPerDivision / timeSig.numerator,
      );

      for (let measure = 0; measure < numberOfMeasures; measure += 1) {
        const endTick = startTick + timeSig.numerator * pulsesPerDivision;

        this.measures.push({
          timeSig: timeSig,
          hasClef: index === 0 && measure === 0,
          sigChange: measure === 0,
          notes: [],
          beats: this.getBeats(timeSig, startTick, endTick),
          startTick,
          endTick,
          startMs: tickToMs(this.chart, startTick),
          endMs: tickToMs(this.chart, endTick),
        });

        startTick += timeSig.numerator * pulsesPerDivision;
      }
    });
  }

  getBeats(
    timeSignature: TimeSignature,
    measureStartTick: number,
    measureEndTick: number,
  ): Beat[] {
    const numberOfBeats = timeSignature.numerator;
    const measureDuration = measureEndTick - measureStartTick;
    const beatDuration = measureDuration / numberOfBeats;

    return new Array(numberOfBeats).fill(null).map((_, index) => ({
      startTick: measureStartTick + index * beatDuration,
      endTick: measureStartTick + (index + 1) * beatDuration,
      notes: [],
    }));
  }

  fillBeats() {
    const noteGroups = this.drumPart.noteEventGroups;
    let noteGroupIndex = 0;

    const step = 1;

    this.measures.forEach(measure => {
      measure.beats.forEach(beat => {
        for (
          let currentTick = beat.startTick;
          currentTick < beat.endTick;
          currentTick += step
        ) {
          if (
            noteGroups[noteGroupIndex] != null &&
            noteGroups[noteGroupIndex][0].tick === currentTick
          ) {
            beat.notes.push({
              notes: noteGroups[noteGroupIndex].map(
                note => mapping[convertNoteToString(note)],
              ),
              isRest: false,
              dotted: false,
              isTriplet: false,
              duration: '32',
              tick: currentTick,
              ms: tickToMs(this.chart, currentTick),
            });

            noteGroupIndex += 1;
          } else if (currentTick === beat.startTick) {
            beat.notes.push({
              notes: ['b/4'],
              isTriplet: false,
              isRest: true,
              dotted: false,
              duration: '32r',
              tick: currentTick,
              ms: tickToMs(this.chart, currentTick),
            });
          }
        }
      });
    });
  }

  flattenMeasures() {
    this.measures.forEach(measure => {
      measure.notes = this.collapseQRests(
        measure.beats.map(beat => beat.notes).flat(),
      );
    });
  }

  collapseQRests(notes: Note[]) {
    const result: Note[] = [];
    let consecutiveRests: Note[] = [];

    notes.forEach(note => {
      if (note.duration === 'qr' && consecutiveRests.length < 4) {
        consecutiveRests.push(note);
      } else {
        if (consecutiveRests.length > 0) {
          result.push(this.getCollapsedRest(consecutiveRests));
          consecutiveRests = [];
        }

        result.push(note);
      }
    });

    if (consecutiveRests.length > 0) {
      result.push(this.getCollapsedRest(consecutiveRests));
    }

    return result;
  }

  getCollapsedRest(notes: Note[]) {
    let duration: string;
    let dotted = false;
    switch (notes.length) {
      case 2:
        duration = 'hr';
        break;
      case 3:
        duration = 'hrd';
        dotted = true;
        break;
      case 4:
        duration = 'wr';
        break;
      default:
        duration = 'qr';
    }

    return {
      notes: ['b/4'],
      isRest: true,
      dotted,
      isTriplet: false,
      duration,
      tick: 0,
      ms: 0,
    };
  }

  extendNoteDuration() {
    this.measures.forEach(measure => {
      measure.beats.forEach(beat => {
        beat.notes.forEach((note, index) => {
          const noteDuration =
            (beat.notes[index + 1]?.tick ?? beat.endTick) - note.tick;

          note.durationTicks = noteDuration;

          if (!this.durationMap[noteDuration]) {
            note.duration = '';
            return;
          }

          const {duration, dotted, isTriplet} = this.durationMap[noteDuration];

          note.duration = duration
            ? `${duration}${note.isRest ? 'r' : ''}`
            : '';

          if (dotted) {
            note.dotted = true;
          }
          if (isTriplet) {
            note.isTriplet = true;
          }
        });
      });
    });
  }

  processCompositeDuration() {
    const availableDurations = Object.keys(this.durationMap).map(key =>
      Number(key),
    );

    this.measures.forEach(measure => {
      measure.beats.forEach(beat => {
        beat.notes = beat.notes
          .map(note => {
            if (note.duration) {
              return note;
            }

            const atomicDurations = this.getSubsets(
              availableDurations,
              note.durationTicks ?? 0,
            );

            if (atomicDurations.length === 0) {
              return this.getClosestDuration(availableDurations, note);
            }

            return atomicDurations
              .sort((a, b) => a.length - b.length)[0]
              .sort((a, b) => b - a)
              .map((durationTicks, index) => {
                const {duration, dotted, isTriplet} =
                  this.durationMap[durationTicks];

                const isRest = note.isRest || index !== 0;
                const newNote: Note = {
                  isTriplet: isTriplet ?? false,
                  dotted: dotted ?? false,
                  durationTicks,
                  isRest,
                  tick: 0,
                  ms: 0,
                  duration: `${duration}${isRest ? 'r' : ''}`,
                  notes: isRest ? ['b/4'] : note.notes,
                };

                return newNote;
              });
          })
          .flat();
      });
    });
  }

  getClosestDuration(availableDurations: number[], note: Note) {
    const ppq = this.chart.resolution;

    let durationDiff = Infinity;
    let closestDurationKey = ppq / 16;
    availableDurations.forEach(duration => {
      const diff = Math.abs(duration - (note.durationTicks ?? 0));
      if (diff < durationDiff) {
        closestDurationKey = duration;
        durationDiff = diff;
      }
    });

    const {duration, isTriplet, dotted} = this.durationMap[closestDurationKey];

    return [
      {
        isTriplet: isTriplet ?? false,
        dotted: dotted ?? false,
        durationTicks: note.durationTicks,
        isRest: note.isRest,
        tick: 0,
        ms: 0,
        duration: `${duration}${note.isRest ? 'r' : ''}`,
        notes: note.isRest ? ['b/4'] : note.notes,
      },
    ];
  }

  getSubsets(array: number[], sum: number) {
    const result: number[][] = [];

    function fork(i = 0, s = 0, t: number[] = []) {
      if (s === sum) {
        result.push(t);
        return;
      }
      if (i === array.length) {
        return;
      }
      if (s + array[i] <= sum) {
        fork(i + 1, s + array[i], t.concat(array[i]));
      }
      fork(i + 1, s, t);
    }

    fork();

    return result;
  }

  #constructDurationMap() {
    const ppq = this.chart.resolution;

    return {
      [ppq]: {duration: 'q'},
      [ppq / 2]: {duration: '8'},
      [ppq / 3]: {duration: '8', isTriplet: true},
      [ppq / 2 + ppq / 4]: {duration: '8d', dotted: true},
      [ppq / 4]: {duration: '16'},
      [ppq / 4 + ppq / 8]: {duration: '16d', dotted: true},
      [ppq / 6]: {duration: '16', isTriplet: true},
      [ppq / 8]: {duration: '32'},
      [ppq / 8 + ppq / 16]: {duration: '32d', dotted: true},
      [ppq / 12]: {duration: '32', isTriplet: true},
      [ppq / 16]: {duration: '64'},
      [ppq / 16 + ppq / 32]: {duration: '64d', dotted: true},
      [ppq / 24]: {duration: '64', isTriplet: true},
    };
  }
}

function convertNoteToString(note: NoteEvent): DrumNoteInstrument {
  switch (note.type) {
    case noteTypes.kick:
      return 'kick';
    case noteTypes.redDrum:
      return 'snare';
    case noteTypes.yellowDrum:
      if (note.flags & noteFlags.cymbal && note.flags & noteFlags.accent) {
        // Could be open-hat or a harder hit
        return 'hihat';
      } else if (note.flags & noteFlags.cymbal) {
        return 'hihat';
      } else if (note.flags & noteFlags.tom) {
        return 'high-tom';
      } else {
        throw new Error(`Unexpected Yellow note flags ${note.flags}`);
      }
    case noteTypes.blueDrum:
      if (note.flags & noteFlags.cymbal) {
        return 'ride';
      } else if (note.flags & noteFlags.tom) {
        return 'mid-tom';
      } else {
        throw new Error(`Unexpected Blue note flags ${note.flags}`);
      }
    case noteTypes.greenDrum:
      if (note.flags & noteFlags.cymbal) {
        return 'crash';
      } else if (note.flags & noteFlags.tom) {
        return 'floor-tom';
      } else {
        throw new Error(`Unexpected Green note flags ${note.flags}`);
      }
    default:
      throw new Error(`Unexpected note type ${note.type}`);
  }
}
