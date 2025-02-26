// Heavily inspired by https://github.com/tonygoldcrest/drum-hero Thanks!

import {NoteEvent, parseChartFile} from 'scan-chart';

type ParsedChart = ReturnType<typeof parseChartFile>;
type TimeSignature = ParsedChart['timeSignatures'][0];
type Difficulty = ParsedChart['trackData'][0]['difficulty'];

function getDrumDifficulties(chart: ParsedChart) {
  return chart.trackData
    .filter(part => part.instrument === 'drums')
    .map(part => part.difficulty);
}

export default function convertToVexFlow(
  chart: ParsedChart,
  difficulty: string,
) {
  const drumPart = chart.trackData.find(
    part => part.instrument === 'drums' && part.difficulty === difficulty,
  );
  if (!drumPart) {
    throw new Error('Unable to find difficulty');
  }
}

type Instrument =
  | 'kick'
  | 'snare'
  | 'yellowCymbal'
  | 'blueCymbal'
  | 'greenCymbal'
  | 'yellowTom'
  | 'blueTom'
  | 'greenTom';

type InstrumentMapping = {
  [key in Instrument]: string;
};

const mapping: InstrumentMapping = {
  kick: 'e/4',
  snare: 'c/5',
  yellowCymbal: 'g/5/x2',
  blueCymbal: 'f/5/x2',
  greenCymbal: 'a/5/x2',
  yellowTom: 'e/5',
  blueTom: 'd/5',
  greenTom: 'a/4',
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
    const noteGroupIndex = 0;

    const step = 1;

    this.measures.forEach(measure => {
      measure.beats.forEach(beat => {
        for (
          let currentTick = beat.startTick;
          currentTick < beat.endTick;
          currentTick += step
        ) {
          if (noteGroups[noteGroupIndex][0].tick === currentTick) {
            beat.notes.push({
              notes: tickNotes.map(note =>
                this.getNoteKey(note, currentModifierNotes),
              ),
              isRest: false,
              dotted: false,
              isTriplet: false,
              duration: '32',
              tick: currentTick,
            });

            const notes = noteGroups[noteGroupIndex].map((note) => {
            }
            noteGroupIndex += 1;
          } else if (currentTick === beat.startTick) {
            beat.notes.push({
              notes: ['b/4'],
              isTriplet: false,
              isRest: true,
              dotted: false,
              duration: '32r',
              tick: currentTick,
            });
          }
        }
      });
    });
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
      return "kick";
    case noteTypes.redDrum:
      return "snare";
    case noteTypes.yellowDrum:
      if (note.flags & noteFlags.cymbal && note.flags & noteFlags.accent) {
        // console.log("open-hat", note);
        return "open-hat";
      } else if (note.flags & noteFlags.cymbal) {
        return "hihat";
      } else if (note.flags & noteFlags.tom) {
        return "high-tom";
      } else {
        throw new Error(`Unexpected Yellow note flags ${note.flags}`);
      }
    case noteTypes.blueDrum:
      if (note.flags & noteFlags.cymbal) {
        return "ride";
      } else if (note.flags & noteFlags.tom) {
        return "mid-tom";
      } else {
        throw new Error(`Unexpected Blue note flags ${note.flags}`);
      }
    case noteTypes.greenDrum:
      if (note.flags & noteFlags.cymbal) {
        return "crash";
      } else if (note.flags & noteFlags.tom) {
        return "floor-tom";
      } else {
        throw new Error(`Unexpected Green note flags ${note.flags}`);
      }
    default:
      throw new Error(`Unexpected note type ${note.type}`);
  }
}